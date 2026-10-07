import { describe, expect, it } from 'vitest';
import { ChiriinError } from '../src/errors.js';
import {
  assertInJapan,
  formatDegrees,
  gsiMapUrl,
  hazardMapUrl,
  prefectureOf,
  toDms,
  todayInJapan,
} from '../src/geo.js';
import { latLonToTile, metersPerPixel, tilePixelToLatLon } from '../src/tiles.js';
import { suggestZone, ZONES, zoneTableText } from '../src/zones.js';

describe('tile math', () => {
  it('matches the tile URLs requested by the hazard portal (江東区東陽, z17)', () => {
    expect(latLonToTile(35.6699, 139.8174, 17)).toEqual({ z: 17, x: 116441, y: 51618, px: 246, py: 90 });
  });

  it('round-trips through pixel centres', () => {
    const pos = latLonToTile(34.4669, 132.4766, 17);
    const back = tilePixelToLatLon(pos);
    expect(back.lat).toBeCloseTo(34.4669, 4);
    expect(back.lon).toBeCloseTo(132.4766, 4);
    expect(latLonToTile(back.lat, back.lon, 17)).toEqual(pos);
  });

  it('reports ~1 m pixels at z17 in central Japan', () => {
    expect(metersPerPixel(35.68, 17)).toBeGreaterThan(0.9);
    expect(metersPerPixel(35.68, 17)).toBeLessThan(1.0);
  });
});

describe('geo helpers', () => {
  it('accepts points in Japan and rejects swapped coordinates with a hint', () => {
    expect(() => assertInJapan(35.68, 139.76)).not.toThrow();
    expect(() => assertInJapan(20.42, 136.08)).not.toThrow(); // 沖ノ鳥島
    try {
      assertInJapan(139.76, 35.68);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChiriinError);
      const err = e as ChiriinError;
      expect(err.code).toBe('OUT_OF_RANGE');
      expect(err.messageEn).toContain('outside Japan');
      expect(err.hint).toContain('取り違えて');
    }
  });

  it('formats coordinates, links and DMS', () => {
    expect(formatDegrees(35.123456789123)).toBe('35.12345679');
    expect(formatDegrees(1e-9)).toBe('0');
    expect(gsiMapUrl(35.6812362, 139.7671248)).toBe('https://maps.gsi.go.jp/#16/35.681236/139.767125/');
    expect(hazardMapUrl(35.6812362, 139.7671248)).toBe(
      'https://disaportal.gsi.go.jp/maps/?ll=35.681236,139.767125&z=16&base=pale',
    );
    expect(toDms(36.10377479)).toBe(`36°06'13.59"`);
    expect(toDms(-0.5)).toBe(`-0°30'00.00"`);
    expect(toDms(35.99999999)).toBe(`36°00'00.00"`);
  });

  it('extracts prefectures and formats the date in JST', () => {
    expect(prefectureOf('東京都江東区東陽四丁目')).toBe('東京都');
    expect(prefectureOf('京都府京都市')).toBe('京都府');
    expect(prefectureOf('富士山頂郵便局')).toBeUndefined();
    expect(todayInJapan(new Date('2026-10-06T16:00:00Z'))).toBe('2026-10-07');
  });
});

describe('plane rectangular zone suggestion', () => {
  it('has all 19 zones', () => {
    expect(ZONES.map((z) => z.zone)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(zoneTableText().split('\n')).toHaveLength(19);
  });

  it.each([
    ['茨城県', 36.1, 140.1, 9, 'exact'],
    ['大阪府', 34.7, 135.5, 6, 'exact'],
    ['福岡県', 33.6, 130.4, 2, 'exact'],
    ['東京都', 35.68, 139.76, 9, 'by_position'], // 23区
    ['東京都', 33.1, 139.79, 9, 'by_position'], // 八丈島 (north of 28°N)
    ['東京都', 27.09, 142.19, 14, 'by_position'], // 父島
    ['東京都', 20.42, 136.08, 18, 'by_position'], // 沖ノ鳥島
    ['東京都', 24.29, 153.98, 19, 'by_position'], // 南鳥島
    ['沖縄県', 26.21, 127.68, 15, 'by_position'], // 那覇
    ['沖縄県', 24.34, 124.16, 16, 'by_position'], // 石垣
    ['沖縄県', 25.85, 131.24, 17, 'by_position'], // 南大東島
    ['鹿児島県', 31.59, 130.56, 2, 'by_position'], // 鹿児島市
    ['鹿児島県', 28.38, 129.49, 1, 'by_position'], // 奄美大島
    ['鹿児島県', 31.81, 129.86, 1, 'by_position'], // 甑島
    ['鹿児島県', 28.32, 130.0, 1, 'by_position'], // 喜界島
    ['鹿児島県', 30.73, 131.0, 2, 'by_position'], // 種子島
  ] as const)('%s (%f, %f) → zone %i', (pref, lat, lon, zone, basis) => {
    expect(suggestZone(pref, lat, lon)).toEqual({ zone, basis });
  });

  it('refuses to guess for 北海道 or unknown prefectures', () => {
    expect(suggestZone('北海道', 43.06, 141.35)).toBeUndefined();
    expect(suggestZone(undefined, 35, 135)).toBeUndefined();
  });
});
