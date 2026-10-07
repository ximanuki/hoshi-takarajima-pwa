import { TtlLruCache } from '../cache.js';
import { ChiriinError, toChiriinError } from '../errors.js';
import { assertInJapan } from '../geo.js';
import {
  getLayer,
  HAZARD_LAYER_IDS,
  HAZARD_LAYERS,
  type HazardGroup,
  type HazardLayer,
  type LegendEntry,
  tileUrl,
} from '../hazard-layers.js';
import type { HttpClient } from '../http-client.js';
import { type DecodedImage, decodePng, pixelAt } from '../png.js';
import { latLonToTile, metersPerPixel, type TilePosition } from '../tiles.js';

export type HazardStatus = 'in_zone' | 'not_in_zone' | 'unknown_color' | 'error';

export interface HazardClass {
  labelJa: string;
  labelEn: string;
  min?: number;
  max?: number | null;
  unit?: 'm' | 'h';
  level: number;
}

export interface HazardLayerResult {
  id: string;
  group: HazardGroup;
  nameJa: string;
  nameEn: string;
  status: HazardStatus;
  hazardClass?: HazardClass;
  /** Colour of the sampled pixel (#rrggbb). */
  color?: string;
  /** A zone exists within this distance although the point itself is outside it. */
  nearbyWithinM?: number;
  noteJa?: string;
  error?: string;
  tileUrl: string;
}

export type PixelClass =
  | { kind: 'transparent' }
  | { kind: 'match'; entry: LegendEntry }
  | { kind: 'unknown'; hex: string };

/** Pixels with lower alpha are anti-aliasing fringes and treated as empty. */
const MIN_ALPHA = 128;
/**
 * Max RGB distance for a legend match. Neighbouring legend colours are ≥16 apart
 * (e.g. 0.3m未満 vs 0.5m未満), so 7 keeps classes unambiguous.
 */
const COLOR_TOLERANCE = 7;
const ZOOM = 17;

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function classifyPixel(
  rgba: readonly [number, number, number, number],
  legend: readonly LegendEntry[],
): PixelClass {
  const [r, g, b, a] = rgba;
  if (a < MIN_ALPHA) return { kind: 'transparent' };
  let best: LegendEntry | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of legend) {
    const d = Math.hypot(entry.rgb[0] - r, entry.rgb[1] - g, entry.rgb[2] - b);
    if (d < bestDistance) {
      bestDistance = d;
      best = entry;
    }
  }
  if (best && bestDistance <= COLOR_TOLERANCE) return { kind: 'match', entry: best };
  return { kind: 'unknown', hex: toHex(r, g, b) };
}

function toClass(layer: HazardLayer, entry: LegendEntry): HazardClass {
  const c: HazardClass = { labelJa: entry.labelJa, labelEn: entry.labelEn, level: entry.level };
  if (entry.min !== undefined) c.min = entry.min;
  if (entry.max !== undefined) c.max = entry.max;
  if (layer.unit) c.unit = layer.unit;
  return c;
}

/** Most frequent legend entry among the pixels in a square of the given radius (excluding the centre). */
function neighbourhood(
  image: DecodedImage,
  pos: TilePosition,
  radius: number,
  legend: readonly LegendEntry[],
): { entry: LegendEntry; distancePx: number } | undefined {
  const counts = new Map<LegendEntry, { n: number; nearest: number }>();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = pos.px + dx;
      const y = pos.py + dy;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const c = classifyPixel(pixelAt(image, x, y), legend);
      if (c.kind !== 'match') continue;
      const dist = Math.hypot(dx, dy);
      const prev = counts.get(c.entry);
      counts.set(c.entry, { n: (prev?.n ?? 0) + 1, nearest: Math.min(prev?.nearest ?? dist, dist) });
    }
  }
  let best: { entry: LegendEntry; distancePx: number; n: number } | undefined;
  for (const [entry, { n, nearest }] of counts) {
    if (!best || n > best.n || (n === best.n && entry.level > best.entry.level)) {
      best = { entry, distancePx: nearest, n };
    }
  }
  return best && { entry: best.entry, distancePx: best.distancePx };
}

/**
 * Decides the status of one layer at one point from its tile (null = HTTP 404,
 * which the portal returns for tiles without any coloured pixel).
 */
export function evaluateLayerTile(
  layer: HazardLayer,
  image: DecodedImage | null,
  pos: TilePosition,
  lat: number,
): Omit<HazardLayerResult, 'tileUrl'> {
  const base = { id: layer.id, group: layer.group, nameJa: layer.nameJa, nameEn: layer.nameEn };
  if (!image) return { ...base, status: 'not_in_zone' };

  const mpp = metersPerPixel(lat, pos.z);
  const centre = pixelAt(image, pos.px, pos.py);
  const centreClass = classifyPixel(centre, layer.legend);
  const color = toHex(centre[0], centre[1], centre[2]);

  if (centreClass.kind === 'match') {
    return { ...base, status: 'in_zone', hazardClass: toClass(layer, centreClass.entry), color };
  }

  // Circle-hatched layers draw ~16 px rings, so a point at a ring's centre is ~8 px from the nearest stroke.
  const radius = layer.pattern ? 9 : 3;
  const near = neighbourhood(image, pos, radius, layer.legend);

  if (near && (layer.pattern || centreClass.kind === 'unknown')) {
    // Patterned layers have gaps between the drawn shapes; unknown colours are usually boundary lines.
    return {
      ...base,
      status: 'in_zone',
      hazardClass: toClass(layer, near.entry),
      color: toHex(...near.entry.rgb),
      noteJa: layer.pattern
        ? `模様の隙間に当たったため、周辺約${Math.ceil(radius * mpp)}m以内の表示から判定しました。`
        : '区域の境界線上の地点です。隣接する区域の表示から判定しました。',
    };
  }
  if (near) {
    return {
      ...base,
      status: 'not_in_zone',
      nearbyWithinM: Math.max(1, Math.ceil(near.distancePx * mpp)),
      noteJa: `地点は区域外ですが、約${Math.max(1, Math.ceil(near.distancePx * mpp))}m以内に「${near.entry.labelJa}」の区域があります。`,
    };
  }
  if (centreClass.kind === 'unknown') {
    return {
      ...base,
      status: 'unknown_color',
      color: centreClass.hex,
      noteJa: `凡例にない色（${centreClass.hex}）が表示されています。重ねるハザードマップで確認してください。`,
    };
  }
  return { ...base, status: 'not_in_zone' };
}

export function resolveLayerIds(ids: readonly string[] | undefined): HazardLayer[] {
  if (!ids || ids.length === 0) return [...HAZARD_LAYERS];
  const unknown = ids.filter((id) => !getLayer(id));
  if (unknown.length > 0) {
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `不明なレイヤーID: ${unknown.join(', ')}`,
      en: `Unknown layer id(s): ${unknown.join(', ')}`,
      hint: `指定できるID: ${HAZARD_LAYER_IDS.join(', ')}`,
    });
  }
  return [...new Set(ids)].map((id) => getLayer(id) as HazardLayer);
}

/** 重ねるハザードマップ (open-data raster tiles) point lookup. */
export class HazardService {
  constructor(
    private readonly http: HttpClient,
    private readonly tiles = new TtlLruCache<DecodedImage | null>(96, 6 * 60 * 60 * 1000),
  ) {}

  private loadTile(url: string): Promise<DecodedImage | null> {
    return this.tiles.getOrLoad(url, async () => {
      const response = await this.http.get(url, { allowNotFound: true, accept: 'image/png' });
      return response ? decodePng(response.body) : null;
    });
  }

  async evaluate(lat: number, lon: number, layerIds?: readonly string[]): Promise<HazardLayerResult[]> {
    assertInJapan(lat, lon);
    const layers = resolveLayerIds(layerIds);
    return Promise.all(
      layers.map(async (layer) => {
        const pos = latLonToTile(lat, lon, Math.min(ZOOM, layer.maxZoom));
        const url = tileUrl(layer, pos.z, pos.x, pos.y);
        try {
          const image = await this.loadTile(url);
          return { ...evaluateLayerTile(layer, image, pos, lat), tileUrl: url };
        } catch (error) {
          const e = toChiriinError(error);
          return {
            id: layer.id,
            group: layer.group,
            nameJa: layer.nameJa,
            nameEn: layer.nameEn,
            status: 'error' as const,
            error: `${e.messageJa} / ${e.messageEn}`,
            tileUrl: url,
          };
        }
      }),
    );
  }
}
