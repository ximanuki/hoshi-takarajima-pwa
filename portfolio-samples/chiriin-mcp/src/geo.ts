import { ChiriinError } from './errors.js';

/**
 * Generous bounding box of Japan's territory (沖ノ鳥島 20.42°N, 南鳥島 153.98°E,
 * 与那国島 122.93°E, 択捉島 45.5°N). GSI data only covers Japan.
 */
export const JAPAN_BOUNDS = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 } as const;

export function assertInJapan(lat: number, lon: number, label = '地点'): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ChiriinError({
      code: 'INVALID_INPUT',
      ja: `${label}の緯度・経度が数値ではありません`,
      en: `The latitude/longitude of the ${label === '地点' ? 'point' : label} is not a finite number`,
    });
  }
  const b = JAPAN_BOUNDS;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) {
    throw new ChiriinError({
      code: 'OUT_OF_RANGE',
      ja: `${label}（緯度 ${lat}, 経度 ${lon}）は日本の範囲外です。国土地理院のデータは日本国内のみ対象です`,
      en: `(${lat}, ${lon}) is outside Japan; GSI data covers Japan only`,
      hint: `緯度 ${b.minLat}〜${b.maxLat}、経度 ${b.minLon}〜${b.maxLon} の範囲で指定してください。緯度と経度を取り違えていないかも確認してください。`,
    });
  }
}

/** Decimal degrees with at most 8 decimals (≈1 mm) and never in exponent notation. */
export function formatDegrees(value: number): string {
  return Number(value.toFixed(8)).toString();
}

export function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 地理院地図 (GSI Maps) URL centred on the point. */
export function gsiMapUrl(lat: number, lon: number, zoom = 16): string {
  return `https://maps.gsi.go.jp/#${zoom}/${roundTo(lat, 6)}/${roundTo(lon, 6)}/`;
}

/** 重ねるハザードマップ URL centred on the point (format taken from the site's own share links). */
export function hazardMapUrl(lat: number, lon: number, zoom = 16): string {
  return `https://disaportal.gsi.go.jp/maps/?ll=${roundTo(lat, 6)},${roundTo(lon, 6)}&z=${zoom}&base=pale`;
}

/** Decimal degrees -> 度分秒 string, e.g. 35°40'58.1". */
export function toDms(deg: number): string {
  const sign = deg < 0 ? '-' : '';
  let abs = Math.abs(deg);
  let d = Math.floor(abs);
  abs = (abs - d) * 60;
  let m = Math.floor(abs);
  let s = roundTo((abs - m) * 60, 2);
  if (s >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${sign}${d}°${String(m).padStart(2, '0')}'${s.toFixed(2).padStart(5, '0')}"`;
}

export const PREFECTURES = [
  '北海道',
  '青森県',
  '岩手県',
  '宮城県',
  '秋田県',
  '山形県',
  '福島県',
  '茨城県',
  '栃木県',
  '群馬県',
  '埼玉県',
  '千葉県',
  '東京都',
  '神奈川県',
  '新潟県',
  '富山県',
  '石川県',
  '福井県',
  '山梨県',
  '長野県',
  '岐阜県',
  '静岡県',
  '愛知県',
  '三重県',
  '滋賀県',
  '京都府',
  '大阪府',
  '兵庫県',
  '奈良県',
  '和歌山県',
  '鳥取県',
  '島根県',
  '岡山県',
  '広島県',
  '山口県',
  '徳島県',
  '香川県',
  '愛媛県',
  '高知県',
  '福岡県',
  '佐賀県',
  '長崎県',
  '熊本県',
  '大分県',
  '宮崎県',
  '鹿児島県',
  '沖縄県',
] as const;

export type Prefecture = (typeof PREFECTURES)[number];

export function prefectureOf(text: string): Prefecture | undefined {
  const t = text.trim();
  return PREFECTURES.find((p) => t.startsWith(p));
}

/** Today's date in Japan (YYYY-MM-DD), used in attribution lines. */
export function todayInJapan(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}
