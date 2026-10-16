import { TtlLruCache } from '../cache.js';
import { ChiriinError } from '../errors.js';
import { assertInJapan, formatDegrees } from '../geo.js';
import type { HttpClient } from '../http-client.js';

export const ELEVATION_ENDPOINT = 'https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php';

export interface ElevationResult {
  elevationM: number;
  /** hsrc as returned by GSI, e.g. "1m（レーザ）". */
  source: string;
  sourceDescriptionJa: string;
  /** Number of decimals GSI reports for this source (0.1 m or 1 m). */
  resolutionM: number;
}

/** Explanations from https://maps.gsi.go.jp/development/elevation_s.html */
const SOURCES: Record<string, { ja: string; resolutionM: number }> = {
  '1m（レーザ）': { ja: '航空レーザ測量による1mメッシュ標高（最も高精度）', resolutionM: 0.1 },
  '5m（レーザ）': { ja: '航空レーザ測量による5mメッシュ標高', resolutionM: 0.1 },
  '5m（写真測量）': { ja: '写真測量（地上画素寸法20cm）による5mメッシュ標高', resolutionM: 0.1 },
  '5m（写真測量5C）': { ja: '写真測量（地上画素寸法40cm）による5mメッシュ標高', resolutionM: 0.1 },
  '10m': { ja: '等高線から作成した10mメッシュ標高（精度は相対的に低い）', resolutionM: 1 },
};

export function elevationUrl(lat: number, lon: number): string {
  return `${ELEVATION_ENDPOINT}?lon=${formatDegrees(lon)}&lat=${formatDegrees(lat)}&outtype=JSON`;
}

export function parseElevationResponse(json: unknown, lat: number, lon: number): ElevationResult {
  const body = (typeof json === 'object' && json !== null ? json : {}) as {
    elevation?: unknown;
    hsrc?: unknown;
  };
  if (body.elevation === '-----' || body.elevation === undefined) {
    throw new ChiriinError({
      code: 'NOT_FOUND',
      ja: `緯度 ${lat}, 経度 ${lon} の標高データがありません（海上や国外、データ未整備の地点）`,
      en: `No elevation data at (${lat}, ${lon}) — the point may be at sea, outside Japan, or not covered`,
      hint: '陸上の地点を指定しているか、緯度と経度を取り違えていないか確認してください。',
    });
  }
  const elevation = typeof body.elevation === 'number' ? body.elevation : Number(body.elevation);
  if (!Number.isFinite(elevation)) {
    throw new ChiriinError({
      code: 'UPSTREAM_BAD_RESPONSE',
      ja: '標高APIの応答を解釈できませんでした',
      en: 'Could not interpret the elevation API response',
    });
  }
  const source = typeof body.hsrc === 'string' ? body.hsrc : '不明';
  const known = SOURCES[source];
  return {
    elevationM: elevation,
    source,
    sourceDescriptionJa: known?.ja ?? `データソース: ${source}`,
    resolutionM: known?.resolutionM ?? 1,
  };
}

/** 標高API（国土地理院）: the most accurate DEM available at the point is used by GSI. */
export class ElevationService {
  constructor(
    private readonly http: HttpClient,
    private readonly cache = new TtlLruCache<ElevationResult>(512, 24 * 60 * 60 * 1000),
  ) {}

  async get(lat: number, lon: number): Promise<ElevationResult> {
    assertInJapan(lat, lon);
    const url = elevationUrl(lat, lon);
    return this.cache.getOrLoad(url, async () =>
      parseElevationResponse(await this.http.getJson(url), lat, lon),
    );
  }
}
