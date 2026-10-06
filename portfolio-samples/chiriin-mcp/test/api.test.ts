import { describe, expect, it } from 'vitest';
import { ElevationService, elevationUrl, parseElevationResponse } from '../src/api/elevation.js';
import {
  GeocodeService,
  geocodeUrl,
  normalizeQuery,
  parseGeocodeResponse,
  rankCandidates,
} from '../src/api/geocode.js';
import {
  distanceUrl,
  geoidUrl,
  SurveyCalcService,
  toPlaneUrl,
  unwrapSurveyResponse,
} from '../src/api/surveycalc.js';
import { ChiriinError } from '../src/errors.js';
import { HttpClient } from '../src/http-client.js';
import { describeLocation, resolveLocation } from '../src/location.js';
import { fakeClock, recordedFetch } from './helpers/recorded.js';

const http = (requested: string[] = []) =>
  new HttpClient({ fetch: recordedFetch(requested), clock: fakeClock() });

async function caught(promise: Promise<unknown>): Promise<ChiriinError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ChiriinError) return e;
    throw e;
  }
  throw new Error('expected a ChiriinError');
}

describe('geocoding (地理院地図 住所検索)', () => {
  it('builds the request URL from a normalised query', () => {
    expect(normalizeQuery('  東京都　千代田区 ')).toBe('東京都 千代田区');
    expect(normalizeQuery('永田町１－７－１')).toBe('永田町1-7-1');
    expect(geocodeUrl('東京都')).toBe(
      'https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E6%9D%B1%E4%BA%AC%E9%83%BD',
    );
  });

  it('parses a recorded address match', async () => {
    const [hit, ...rest] = await new GeocodeService(http()).search('東京都千代田区永田町1-7-1');
    expect(rest).toEqual([]);
    expect(hit).toEqual({
      title: '東京都千代田区永田町一丁目７番',
      lat: 35.677414,
      lon: 139.744385,
      municipalityCode: null,
      prefecture: '東京都',
    });
  });

  it('puts the candidate whose name contains the query first (富士山頂 → 富士山頂郵便局)', async () => {
    const results = await new GeocodeService(http()).search('富士山頂');
    expect(results[0]).toMatchObject({ title: '富士山頂郵便局', municipalityCode: '22207' });
    expect(results).toHaveLength(5);
  });

  it('ranks exact > contains > original order, stably', () => {
    const c = (title: string) => ({ title, lat: 35, lon: 139, municipalityCode: null, prefecture: null });
    const ranked = rankCandidates('東京駅', [
      c('北海道札幌市東区'),
      c('東京駅前郵便局'),
      c('東京駅'),
      c('岩手県花巻市東'),
    ]);
    expect(ranked.map((x) => x.title)).toEqual([
      '東京駅',
      '東京駅前郵便局',
      '北海道札幌市東区',
      '岩手県花巻市東',
    ]);
  });

  it('returns an empty list when nothing matches and validates input', async () => {
    const service = new GeocodeService(http());
    await expect(service.search('あいうえおかきくけこ')).resolves.toEqual([]);
    expect((await caught(service.search('   '))).code).toBe('INVALID_INPUT');
  });

  it('skips malformed features and rejects non-array payloads', () => {
    expect(
      parseGeocodeResponse([
        { geometry: { coordinates: [139.7, 35.6] }, properties: { title: 'OK', addressCode: '1101' } },
        { geometry: { coordinates: ['x', 35.6] }, properties: { title: 'bad' } },
        null,
      ]),
    ).toEqual([{ title: 'OK', lat: 35.6, lon: 139.7, municipalityCode: '01101', prefecture: null }]);
    expect(() => parseGeocodeResponse({ error: 'x' })).toThrow(ChiriinError);
  });

  it('caches results so repeated lookups do not hit the API again', async () => {
    const requested: string[] = [];
    const service = new GeocodeService(http(requested));
    await service.search('東京都千代田区永田町1-7-1');
    await service.search(' 東京都千代田区永田町1-7-1 ');
    expect(requested).toHaveLength(1);
  });
});

describe('elevation (標高API)', () => {
  it('returns the elevation and the data source (富士山 summit, 1 m laser DEM)', async () => {
    const r = await new ElevationService(http()).get(35.3606, 138.7274);
    expect(r).toEqual({
      elevationM: 3770.6,
      source: '1m（レーザ）',
      sourceDescriptionJa: '航空レーザ測量による1mメッシュ標高（最も高精度）',
      resolutionM: 0.1,
    });
  });

  it('explains "-----" (no data, e.g. at sea) in both languages', async () => {
    const error = await caught(new ElevationService(http()).get(34.0, 141.5));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.messageJa).toContain('標高データがありません');
    expect(error.messageEn).toContain('No elevation data');
  });

  it('handles unknown sources and string values defensively', () => {
    expect(parseElevationResponse({ elevation: '12.5', hsrc: '2m（新方式）' }, 1, 2)).toMatchObject({
      elevationM: 12.5,
      resolutionM: 1,
      sourceDescriptionJa: 'データソース: 2m（新方式）',
    });
    expect(() => parseElevationResponse({ elevation: 'abc' }, 1, 2)).toThrow(/elevation API/);
    expect(elevationUrl(35.1, 139.123456789)).toBe(
      'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=139.12345679&lat=35.1&outtype=JSON',
    );
  });
});

describe('survey calculation (測量計算サイト)', () => {
  const survey = () => new SurveyCalcService(http());

  it('computes geodesic distance and azimuths (つくば → 東京)', async () => {
    await expect(survey().distance(36.10377477, 140.08785502, 35.65502847, 139.74475044)).resolves.toEqual({
      distanceM: 58643.804,
      azimuthFromStartDeg: 211.992527777778,
      azimuthFromEndDeg: 31.7914388888889,
    });
  });

  it('converts to and from plane rectangular coordinates (zone IX)', async () => {
    await expect(survey().toPlane(36.103774791, 140.087855041, 9)).resolves.toEqual({
      zone: 9,
      // the input is sent with 8 decimals (≈1 mm), hence the 0.3 mm difference from the 9-decimal example
      x: 11543.688,
      y: 22916.2433,
      gridConvergenceDeg: -0.149977778,
      scaleFactor: 0.99990647,
    });
    const back = await survey().fromPlane(11543.6883, 22916.2436, 9);
    expect(back.lat).toBeCloseTo(36.103774791, 7);
    expect(back.lon).toBeCloseTo(140.087855041, 7);
  });

  it('returns the geoid height and the island reference-surface correction (八丈島)', async () => {
    await expect(survey().geoid(36.103774791, 140.087855041)).resolves.toEqual({
      geoidHeightM: 40.2826,
      referenceCorrectionM: 0,
      totalM: 40.2826,
    });
    await expect(survey().geoid(33.1, 139.79)).resolves.toEqual({
      geoidHeightM: 43.6072,
      referenceCorrectionM: 0.387,
      totalM: 43.9942,
    });
  });

  it('translates GSI error payloads into bilingual errors', () => {
    try {
      unwrapSurveyResponse({
        ExportData: { ErrMsg: '100:緯度の値が適当でありません。100:経度の値が適当でありません。' },
      });
      expect.unreachable();
    } catch (e) {
      const err = e as ChiriinError;
      expect(err.code).toBe('INVALID_INPUT');
      expect(err.messageJa).toBe(
        '測量計算サイトが入力を受け付けませんでした: 緯度の値が適当でありません。 経度の値が適当でありません。',
      );
      expect(err.messageEn).toContain('GSI survey calculation rejected the input');
    }
    expect(() => unwrapSurveyResponse('nope')).toThrow(/Unexpected response format/);
  });

  it('validates zone and ranges locally without calling the API', async () => {
    const requested: string[] = [];
    const s = new SurveyCalcService(http(requested));
    expect((await caught(s.toPlane(36, 140, 20))).code).toBe('INVALID_INPUT');
    expect((await caught(s.fromPlane(5_000_000, 0, 9))).code).toBe('OUT_OF_RANGE');
    expect((await caught(s.distance(36, 140, 50, 140))).messageJa).toContain('到着点');
    expect(requested).toEqual([]);
  });

  it('builds URLs with fixed precision', () => {
    expect(distanceUrl(1, 2, 3, 4)).toContain('bl2st_calc.pl?outputType=json&ellipsoid=GRS80&latitude1=1');
    expect(toPlaneUrl(36.1234567891, 140, 9)).toContain('latitude=36.12345679');
    expect(geoidUrl(33.1, 139.79)).toBe(
      'https://vldb.gsi.go.jp/sokuchi/surveycalc/geoid/calcgh/cgi/geoidcalc.pl?outputType=json&latitude=33.1&longitude=139.79',
    );
  });
});

describe('resolveLocation', () => {
  const geocoder = () => new GeocodeService(http());

  it('passes coordinates through after validation', async () => {
    await expect(resolveLocation({ lat: 35, lon: 139 }, geocoder())).resolves.toEqual({
      lat: 35,
      lon: 139,
      source: 'coordinates',
    });
  });

  it('geocodes addresses and reports the match and prefecture', async () => {
    const loc = await resolveLocation({ address: '茨城県つくば市北郷1' }, geocoder());
    expect(loc).toMatchObject({
      source: 'address',
      matchedTitle: '茨城県つくば市北郷１番地',
      prefecture: '茨城県',
    });
    expect(describeLocation(loc)).toMatch(
      /^「茨城県つくば市北郷1」→ 茨城県つくば市北郷１番地（緯度 36\.\d+, 経度 140\.\d+）$/,
    );
  });

  it('mentions when the first of several candidates was used', async () => {
    const loc = await resolveLocation({ address: '富士山頂' }, geocoder());
    expect(describeLocation(loc)).toContain('候補 5 件の先頭');
  });

  it('rejects incomplete or missing input in both languages', async () => {
    expect((await caught(resolveLocation({ lat: 35 }, geocoder()))).messageEn).toContain('both lat and lon');
    expect((await caught(resolveLocation({}, geocoder()))).messageJa).toContain('address');
    const notFound = await caught(resolveLocation({ address: 'あいうえおかきくけこ' }, geocoder()));
    expect(notFound.code).toBe('NOT_FOUND');
    expect(notFound.hint).toContain('都道府県名から');
  });
});
