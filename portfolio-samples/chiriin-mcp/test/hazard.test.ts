import { describe, expect, it } from 'vitest';
import {
  classifyPixel,
  evaluateLayerTile,
  HazardService,
  resolveLayerIds,
  toHex,
} from '../src/api/hazard.js';
import { ChiriinError } from '../src/errors.js';
import {
  DEPTH_LEGEND,
  DURATION_LEGEND,
  depthGuideJa,
  getLayer,
  HAZARD_LAYERS,
  type HazardLayer,
  tileUrl,
} from '../src/hazard-layers.js';
import { HttpClient } from '../src/http-client.js';
import { type DecodedImage, decodePng } from '../src/png.js';
import type { TilePosition } from '../src/tiles.js';
import { fakeClock, recordedBytes, recordedFetch } from './helpers/recorded.js';

const layer = (id: string): HazardLayer => {
  const l = getLayer(id);
  if (!l) throw new Error(id);
  return l;
};

/** Synthetic 32x32 image filled with `fill`, with optional painted pixels. */
function image(
  fill: [number, number, number, number],
  paint: [number, number, [number, number, number, number]][] = [],
) {
  const data = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) data.set(fill, i * 4);
  for (const [x, y, rgba] of paint) data.set(rgba, (y * 32 + x) * 4);
  return { width: 32, height: 32, data } satisfies DecodedImage;
}
const at = (px: number, py: number): TilePosition => ({ z: 17, x: 0, y: 0, px, py });
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

describe('legend definitions', () => {
  it('keeps every legend colour unambiguous within a layer', () => {
    for (const l of HAZARD_LAYERS) {
      for (const a of l.legend) {
        for (const b of l.legend) {
          if (a === b || a.rgb.join() === b.rgb.join()) continue;
          const d = Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]);
          expect(d, `${l.id}: ${a.labelJa} vs ${b.labelJa}`).toBeGreaterThan(14);
        }
      }
    }
  });

  it('has unique ids and tile paths', () => {
    expect(new Set(HAZARD_LAYERS.map((l) => l.id)).size).toBe(HAZARD_LAYERS.length);
    expect(new Set(HAZARD_LAYERS.map((l) => l.path)).size).toBe(HAZARD_LAYERS.length);
    expect(tileUrl(layer('flood_max'), 17, 1, 2)).toBe(
      'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/17/1/2.png',
    );
  });

  it('describes depth in storeys', () => {
    expect(depthGuideJa(0.5)).toContain('床下');
    expect(depthGuideJa(3)).toContain('1階の床上');
    expect(depthGuideJa(5)).toContain('2階の床上');
    expect(depthGuideJa(null)).toContain('5階以上');
    expect(depthGuideJa(undefined)).toBeUndefined();
  });
});

describe('classifyPixel', () => {
  it('matches exact and near-exact legend colours', () => {
    expect(classifyPixel([255, 183, 183, 255], DEPTH_LEGEND)).toMatchObject({
      kind: 'match',
      entry: { labelJa: '3m以上5m未満' },
    });
    expect(classifyPixel([253, 185, 181, 255], DEPTH_LEGEND)).toMatchObject({
      kind: 'match',
      entry: { labelJa: '3m以上5m未満' },
    });
    expect(classifyPixel([180, 0, 104, 255], DURATION_LEGEND)).toMatchObject({
      kind: 'match',
      entry: { min: 336 },
    });
  });

  it('treats faint anti-aliasing as transparent and other colours as unknown', () => {
    expect(classifyPixel([255, 255, 0, 1], DEPTH_LEGEND)).toEqual({ kind: 'transparent' });
    expect(classifyPixel([0, 0, 132, 255], DEPTH_LEGEND)).toEqual({ kind: 'unknown', hex: '#000084' });
    expect(toHex(255, 0, 16)).toBe('#ff0010');
  });
});

describe('evaluateLayerTile', () => {
  const flood = layer('flood_max');

  it('treats a missing tile (HTTP 404) as outside every zone', () => {
    expect(evaluateLayerTile(flood, null, at(5, 5), 35)).toMatchObject({ status: 'not_in_zone' });
  });

  it('reads the depth class at the point', () => {
    const r = evaluateLayerTile(flood, image([255, 216, 192, 255]), at(10, 10), 35);
    expect(r).toMatchObject({
      status: 'in_zone',
      color: '#ffd8c0',
      hazardClass: { labelJa: '0.5m以上3m未満', min: 0.5, max: 3, unit: 'm', level: 2 },
    });
  });

  it('reports a nearby zone without claiming the point is inside it', () => {
    const img = image(CLEAR, [[12, 10, [255, 145, 145, 255]]]);
    const r = evaluateLayerTile(flood, img, at(10, 10), 35);
    expect(r.status).toBe('not_in_zone');
    expect(r.nearbyWithinM).toBe(2);
    expect(r.noteJa).toContain('5m以上10m未満');
  });

  it('resolves a boundary-line pixel from its neighbours', () => {
    const img = image([235, 211, 91, 255], [[10, 10, [0, 0, 132, 255]]]);
    const r = evaluateLayerTile(layer('debris_flow'), img, at(10, 10), 35);
    expect(r).toMatchObject({ status: 'in_zone', hazardClass: { labelJa: '土砂災害警戒区域（指定予定）' } });
    expect(r.noteJa).toContain('境界線上');
  });

  it('flags colours that are not in the legend', () => {
    const r = evaluateLayerTile(flood, image([0, 128, 0, 255]), at(10, 10), 35);
    expect(r).toMatchObject({ status: 'unknown_color', color: '#008000' });
  });

  it('looks through the gaps of circle-hatched layers (recorded tile, centre of a ring)', () => {
    const tile = decodePng(recordedBytes('tile-01_flood_l2_kaokutoukai_hanran_data-17-113769-52153.png'));
    const overflow = layer('house_collapse_overflow');
    const inside = evaluateLayerTile(overflow, tile, { z: 17, x: 113769, y: 52153, px: 152, py: 7 }, 34.47);
    expect(inside.status).toBe('in_zone');
    expect(inside.noteJa).toContain('模様の隙間');
    // The recorded sample point itself is ~50 px away from the hatched area.
    const outside = evaluateLayerTile(overflow, tile, { z: 17, x: 113769, y: 52153, px: 66, py: 132 }, 34.47);
    expect(outside).toMatchObject({ status: 'not_in_zone' });
    expect(outside.nearbyWithinM).toBeUndefined();
  });
});

describe('resolveLayerIds', () => {
  it('defaults to all layers, de-duplicates, and rejects unknown ids with the valid list', () => {
    expect(resolveLayerIds(undefined)).toHaveLength(HAZARD_LAYERS.length);
    expect(resolveLayerIds(['tsunami', 'tsunami']).map((l) => l.id)).toEqual(['tsunami']);
    try {
      resolveLayerIds(['volcano']);
      expect.unreachable();
    } catch (e) {
      expect((e as ChiriinError).code).toBe('INVALID_INPUT');
      expect((e as ChiriinError).hint).toContain('flood_max');
    }
  });
});

describe('HazardService with recorded tiles', () => {
  const service = () => new HazardService(new HttpClient({ fetch: recordedFetch(), clock: fakeClock() }));

  it('江東区東陽 (zero-metre area): deep river flooding, storm surge and long inundation', async () => {
    const results = await service().evaluate(35.672993, 139.81636);
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId.flood_max).toMatchObject({ status: 'in_zone', hazardClass: { labelJa: '3m以上5m未満' } });
    expect(byId.flood_planned).toMatchObject({
      status: 'in_zone',
      hazardClass: { labelJa: '0.5m以上3m未満' },
    });
    expect(byId.storm_surge).toMatchObject({ status: 'in_zone', hazardClass: { labelJa: '3m以上5m未満' } });
    expect(byId.flood_duration).toMatchObject({ status: 'in_zone', hazardClass: { min: 336 } });
    for (const id of ['inland_flood', 'tsunami', 'debris_flow', 'steep_slope', 'landslide']) {
      expect(byId[id]?.status, id).toBe('not_in_zone');
    }
  });

  it('熱海市伊豆山: sediment-disaster zones, including a special warning zone', async () => {
    const results = await service().evaluate(35.110623, 139.085562, [
      'debris_flow',
      'steep_slope',
      'landslide',
    ]);
    expect(results.map((r) => [r.id, r.status, r.hazardClass?.labelJa])).toEqual([
      ['debris_flow', 'in_zone', '土砂災害警戒区域（指定済）'],
      ['steep_slope', 'in_zone', '土砂災害特別警戒区域（指定済）'],
      ['landslide', 'not_in_zone', undefined],
    ]);
  });

  it('decodes palette tiles (広島市, planned-scale flood tile is indexed colour)', async () => {
    const results = await service().evaluate(34.4669, 132.4766, [
      'flood_max',
      'flood_planned',
      'flood_duration',
    ]);
    expect(results.map((r) => [r.id, r.status, r.hazardClass?.labelJa])).toEqual([
      ['flood_max', 'in_zone', '5m以上10m未満'],
      ['flood_planned', 'not_in_zone', undefined],
      ['flood_duration', 'in_zone', '12時間以上1日未満'],
    ]);
  });

  it('turns per-layer failures into error entries instead of failing the whole lookup', async () => {
    const svc = new HazardService(
      new HttpClient({
        fetch: async () => new Response('not a png', { status: 200 }),
        clock: fakeClock(),
        retries: 0,
      }),
    );
    const [r] = await svc.evaluate(35.1, 139.08, ['tsunami']);
    expect(r).toMatchObject({ id: 'tsunami', status: 'error' });
    expect(r?.error).toContain('Invalid PNG');
  });

  it('validates coordinates before any request', async () => {
    const requested: string[] = [];
    const svc = new HazardService(new HttpClient({ fetch: recordedFetch(requested), clock: fakeClock() }));
    await expect(svc.evaluate(0, 0)).rejects.toBeInstanceOf(ChiriinError);
    expect(requested).toEqual([]);
  });
});
