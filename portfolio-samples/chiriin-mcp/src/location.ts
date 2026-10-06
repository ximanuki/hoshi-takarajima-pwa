import { z } from 'zod';
import type { GeocodeCandidate, GeocodeService } from './api/geocode.js';
import { ChiriinError } from './errors.js';
import { assertInJapan, prefectureOf } from './geo.js';

/** Shared input fields: either an address/place name or a latitude/longitude pair. */
export const locationInputShape = {
  address: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      '住所または地名（例: "東京都江東区東陽4-11-28"）。lat/lon を指定する場合は省略。Address or place name.',
    ),
  lat: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe('緯度（世界測地系 JGD2011、10進度。例: 35.6812）。Latitude in decimal degrees.'),
  lon: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe('経度（10進度。例: 139.7671）。Longitude in decimal degrees.'),
};

export const locationSchema = z.object(locationInputShape);
export type LocationInput = z.infer<typeof locationSchema>;

export interface ResolvedLocation {
  lat: number;
  lon: number;
  source: 'coordinates' | 'address';
  /** For address input: the query, the matched candidate and how many candidates there were. */
  query?: string;
  matchedTitle?: string;
  candidateCount?: number;
  prefecture?: string;
}

export const resolvedLocationOutput = z.object({
  lat: z.number(),
  lon: z.number(),
  source: z.enum(['coordinates', 'address']),
  query: z.string().optional(),
  matchedTitle: z.string().optional(),
  candidateCount: z.number().int().optional(),
  prefecture: z.string().optional(),
});

export async function resolveLocation(
  input: LocationInput,
  geocoder: GeocodeService,
  label = '地点',
): Promise<ResolvedLocation> {
  const hasLat = input.lat !== undefined;
  const hasLon = input.lon !== undefined;
  if (hasLat !== hasLon) {
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `${label}の lat と lon は両方指定してください`,
      en: 'Specify both lat and lon (or use address instead)',
    });
  }
  if (input.lat !== undefined && input.lon !== undefined) {
    assertInJapan(input.lat, input.lon, label);
    return { lat: input.lat, lon: input.lon, source: 'coordinates' };
  }
  const address = input.address?.trim();
  if (!address) {
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `${label}として address（住所・地名）か lat/lon（緯度・経度）のどちらかを指定してください`,
      en: 'Specify either address or lat/lon',
    });
  }
  const candidates = await geocoder.search(address);
  const best: GeocodeCandidate | undefined = candidates[0];
  if (!best) {
    throw new ChiriinError({
      code: 'NOT_FOUND',
      ja: `「${address}」に一致する住所・地名が見つかりませんでした`,
      en: `No address or place name matched "${address}"`,
      hint: '都道府県名から書く、番地を省いて町丁目までにする、表記ゆれ（丁目/番/号）を変えるなどを試してください。',
    });
  }
  assertInJapan(best.lat, best.lon, label);
  const resolved: ResolvedLocation = {
    lat: best.lat,
    lon: best.lon,
    source: 'address',
    query: address,
    matchedTitle: best.title,
    candidateCount: candidates.length,
  };
  const prefecture = best.prefecture ?? prefectureOf(address);
  if (prefecture) resolved.prefecture = prefecture;
  return resolved;
}

/** One-line Japanese description of how the location was obtained. */
export function describeLocation(loc: ResolvedLocation): string {
  const coords = `緯度 ${loc.lat.toFixed(6)}, 経度 ${loc.lon.toFixed(6)}`;
  if (loc.source === 'coordinates') return coords;
  const others =
    (loc.candidateCount ?? 1) > 1
      ? `（候補 ${loc.candidateCount} 件の先頭。違う場所なら geocode_address で候補を確認し lat/lon を指定）`
      : '';
  return `「${loc.query}」→ ${loc.matchedTitle}（${coords}）${others}`;
}
