import { TtlLruCache } from '../cache.js';
import { ChiriinError } from '../errors.js';
import { prefectureOf } from '../geo.js';
import type { HttpClient } from '../http-client.js';

export const GEOCODE_ENDPOINT = 'https://msearch.gsi.go.jp/address-search/AddressSearch';

export interface GeocodeCandidate {
  title: string;
  lat: number;
  lon: number;
  /** 全国地方公共団体コード（5桁、チェックデジットなし）。付かない候補もある。 */
  municipalityCode: string | null;
  prefecture: string | null;
}

export function geocodeUrl(query: string): string {
  return `${GEOCODE_ENDPOINT}?q=${encodeURIComponent(query)}`;
}

export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function parseGeocodeResponse(json: unknown): GeocodeCandidate[] {
  if (!Array.isArray(json)) {
    throw new ChiriinError({
      code: 'UPSTREAM_BAD_RESPONSE',
      ja: '住所検索の応答形式が想定と異なります',
      en: 'Unexpected response format from the address search',
    });
  }
  const out: GeocodeCandidate[] = [];
  for (const feature of json) {
    if (typeof feature !== 'object' || feature === null) continue;
    const f = feature as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const coords = f.geometry?.coordinates;
    const title = f.properties?.title;
    if (!Array.isArray(coords) || typeof title !== 'string') continue;
    const [lon, lat] = coords as unknown[];
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      continue;
    }
    const code = f.properties?.addressCode;
    out.push({
      title,
      lat,
      lon,
      municipalityCode: typeof code === 'string' && /^\d{4,5}$/.test(code) ? code.padStart(5, '0') : null,
      prefecture: prefectureOf(title) ?? null,
    });
  }
  return out;
}

/**
 * Stable re-ranking for place/facility names: GSI returns partial matches first
 * (e.g. "東京駅" also matches every "東" district), so candidates whose title equals
 * or contains the query are moved to the front. Address queries are unaffected
 * because GSI rewrites their numbers (1-7-1 → 一丁目７番).
 */
export function rankCandidates(query: string, candidates: GeocodeCandidate[]): GeocodeCandidate[] {
  const q = normalizeQuery(query).replace(/\s/g, '');
  const score = (c: GeocodeCandidate): number => {
    const t = normalizeQuery(c.title).replace(/\s/g, '');
    if (t === q) return 2;
    return t.includes(q) ? 1 : 0;
  };
  return candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

/**
 * 住所・地名 → 座標。地理院地図の住所検索（msearch.gsi.go.jp）を利用する。
 * Note: this endpoint powers GSI Maps' search box; GSI does not publish a formal
 * specification or SLA for third-party use.
 */
export class GeocodeService {
  constructor(
    private readonly http: HttpClient,
    private readonly cache = new TtlLruCache<GeocodeCandidate[]>(256, 60 * 60 * 1000),
  ) {}

  async search(query: string): Promise<GeocodeCandidate[]> {
    const q = normalizeQuery(query);
    if (q.length === 0) {
      throw new ChiriinError({
        code: 'INVALID_INPUT',
        ja: '住所・地名が空です',
        en: 'The address/place-name query is empty',
      });
    }
    return this.cache.getOrLoad(q, async () =>
      rankCandidates(q, parseGeocodeResponse(await this.http.getJson(geocodeUrl(q)))),
    );
  }
}
