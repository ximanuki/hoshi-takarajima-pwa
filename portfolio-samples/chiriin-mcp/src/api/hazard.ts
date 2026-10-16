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
import { latLonToTile, metersPerPixel, TILE_SIZE, type TilePosition } from '../tiles.js';

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

/**
 * Adjacent tiles keyed by `"dx,dy"` (each -1, 0 or 1). `null` is a tile the portal returned 404 for
 * (no coloured pixel), `'failed'` a tile that was needed but could not be loaded, and a missing key a
 * tile that was not needed.
 */
export type NeighbourTiles = ReadonlyMap<string, DecodedImage | null | 'failed'>;

/** Most frequent legend entry among the pixels in a square of the given radius (excluding the centre).
 * Pixels past the tile edge are read from the adjacent tile when it is available. */
function neighbourhood(
  image: DecodedImage | null,
  pos: TilePosition,
  radius: number,
  legend: readonly LegendEntry[],
  neighbours?: NeighbourTiles,
): { entry: LegendEntry; distancePx: number } | undefined {
  const size = image?.width ?? TILE_SIZE;
  const tileAt = (ox: number, oy: number): DecodedImage | null | undefined => {
    if (ox === 0 && oy === 0) return image;
    const t = neighbours?.get(`${ox},${oy}`);
    return t === 'failed' ? undefined : t;
  };
  const counts = new Map<LegendEntry, { n: number; nearest: number }>();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const gx = pos.px + dx;
      const gy = pos.py + dy;
      const ox = Math.floor(gx / size);
      const oy = Math.floor(gy / size);
      if (Math.abs(ox) > 1 || Math.abs(oy) > 1) continue;
      const tile = tileAt(ox, oy);
      if (!tile) continue;
      const c = classifyPixel(pixelAt(tile, gx - ox * size, gy - oy * size), legend);
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
  neighbours?: NeighbourTiles,
): Omit<HazardLayerResult, 'tileUrl'> {
  const base = { id: layer.id, group: layer.group, nameJa: layer.nameJa, nameEn: layer.nameEn };
  const mpp = metersPerPixel(lat, pos.z);
  const radius = neighbourhoodRadius(layer);
  // A needed adjacent tile that failed to load must not turn into a false "not in zone".
  const missing = [...(neighbours?.values() ?? [])].includes('failed');
  const notInZone = (): Omit<HazardLayerResult, 'tileUrl'> =>
    missing
      ? {
          ...base,
          status: 'error',
          error:
            '地点がタイルの境目の近くにあり、隣のタイルを取得できなかったため判定できません。時間をおいて再度お試しください。 / ' +
            'The point is near a tile edge and an adjacent tile could not be loaded, so the layer could not be judged. Please try again later.',
        }
      : { ...base, status: 'not_in_zone' };

  if (!image) {
    // The point's own tile is empty, but near a tile edge the zone can start across the seam.
    const near = neighbourhood(null, pos, radius, layer.legend, neighbours);
    if (!near) return notInZone();
    if (layer.pattern) return patternGapResult(base, layer, near.entry, radius, mpp);
    return nearbyResult(base, near, mpp);
  }

  const centre = pixelAt(image, pos.px, pos.py);
  const centreClass = classifyPixel(centre, layer.legend);
  const color = toHex(centre[0], centre[1], centre[2]);

  if (centreClass.kind === 'match') {
    return { ...base, status: 'in_zone', hazardClass: toClass(layer, centreClass.entry), color };
  }

  const near = neighbourhood(image, pos, radius, layer.legend, neighbours);

  if (near && layer.pattern) {
    // Patterned layers have gaps between the drawn shapes.
    return patternGapResult(base, layer, near.entry, radius, mpp);
  }
  if (near && centreClass.kind === 'unknown') {
    // Unknown colours are usually boundary lines.
    return {
      ...base,
      status: 'in_zone',
      hazardClass: toClass(layer, near.entry),
      color: toHex(...near.entry.rgb),
      noteJa: '区域の境界線上の地点です。隣接する区域の表示から判定しました。',
    };
  }
  if (near) return nearbyResult(base, near, mpp);
  if (centreClass.kind === 'unknown') {
    return {
      ...base,
      status: 'unknown_color',
      color: centreClass.hex,
      noteJa: `凡例にない色（${centreClass.hex}）が表示されています。重ねるハザードマップで確認してください。`,
    };
  }
  return notInZone();
}

type LayerBase = Pick<HazardLayerResult, 'id' | 'group' | 'nameJa' | 'nameEn'>;

/** Circle-hatched layers draw ~16 px rings, so a point at a ring's centre is ~8 px from the nearest stroke. */
export function neighbourhoodRadius(layer: HazardLayer): number {
  return layer.pattern ? 9 : 3;
}

function patternGapResult(
  base: LayerBase,
  layer: HazardLayer,
  entry: LegendEntry,
  radius: number,
  mpp: number,
): Omit<HazardLayerResult, 'tileUrl'> {
  return {
    ...base,
    status: 'in_zone',
    hazardClass: toClass(layer, entry),
    color: toHex(...entry.rgb),
    noteJa: `模様の隙間に当たったため、周辺約${Math.ceil(radius * mpp)}m以内の表示から判定しました。`,
  };
}

function nearbyResult(
  base: LayerBase,
  near: { entry: LegendEntry; distancePx: number },
  mpp: number,
): Omit<HazardLayerResult, 'tileUrl'> {
  const m = Math.max(1, Math.ceil(near.distancePx * mpp));
  return {
    ...base,
    status: 'not_in_zone',
    nearbyWithinM: m,
    noteJa: `地点は区域外ですが、約${m}m以内に「${near.entry.labelJa}」の区域があります。`,
  };
}

/** Offsets of the adjacent tiles a lookup at `pos` with this radius reaches into. */
export function neighbourOffsets(pos: TilePosition, radius: number, size = TILE_SIZE): [number, number][] {
  const xs = [0, ...(pos.px - radius < 0 ? [-1] : []), ...(pos.px + radius >= size ? [1] : [])];
  const ys = [0, ...(pos.py - radius < 0 ? [-1] : []), ...(pos.py + radius >= size ? [1] : [])];
  return xs
    .flatMap((ox) => ys.map((oy): [number, number] => [ox, oy]))
    .filter(([ox, oy]) => ox !== 0 || oy !== 0);
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

  /** Adjacent tiles needed when the point sits near a tile edge. A tile that fails to load is marked
   * `'failed'` so the layer cannot silently come out as "not in zone". */
  private async loadNeighbours(layer: HazardLayer, pos: TilePosition): Promise<NeighbourTiles> {
    const map = new Map<string, DecodedImage | null | 'failed'>();
    await Promise.all(
      neighbourOffsets(pos, neighbourhoodRadius(layer)).map(async ([ox, oy]) => {
        try {
          map.set(`${ox},${oy}`, await this.loadTile(tileUrl(layer, pos.z, pos.x + ox, pos.y + oy)));
        } catch {
          // Still judge from what did load: a stroke found elsewhere settles it; otherwise the layer
          // reports an error rather than a false "not in zone".
          map.set(`${ox},${oy}`, 'failed');
        }
      }),
    );
    return map;
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
          // Only patterned layers, and only when the point itself is not coloured, need the adjacent tiles:
          // that is where a gap in the pattern can hide a zone that continues across the tile edge.
          const coloured =
            image && classifyPixel(pixelAt(image, pos.px, pos.py), layer.legend).kind === 'match';
          const neighbours = layer.pattern && !coloured ? await this.loadNeighbours(layer, pos) : undefined;
          return { ...evaluateLayerTile(layer, image, pos, lat, neighbours), tileUrl: url };
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
