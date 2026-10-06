/**
 * 平面直角座標系（平成14年国土交通省告示第9号）の系と適用区域。
 * Used to suggest the zone when the caller only knows the address.
 */
export interface ZoneInfo {
  zone: number;
  roman: string;
  originLat: number;
  originLon: number;
  areaJa: string;
}

const dms = (d: number, m: number) => d + m / 60;

export const ZONES: readonly ZoneInfo[] = [
  {
    zone: 1,
    roman: 'I',
    originLat: 33,
    originLon: dms(129, 30),
    areaJa:
      '長崎県、鹿児島県のうち北緯27度〜32度・東経128度18分〜130度の島々（甑島・トカラ列島・奄美群島など。奄美群島は東経130度13分まで）',
  },
  {
    zone: 2,
    roman: 'II',
    originLat: 33,
    originLon: 131,
    areaJa: '福岡県、佐賀県、熊本県、大分県、宮崎県、鹿児島県（I系の区域を除く）',
  },
  { zone: 3, roman: 'III', originLat: 36, originLon: dms(132, 10), areaJa: '山口県、島根県、広島県' },
  { zone: 4, roman: 'IV', originLat: 33, originLon: dms(133, 30), areaJa: '香川県、愛媛県、徳島県、高知県' },
  { zone: 5, roman: 'V', originLat: 36, originLon: dms(134, 20), areaJa: '兵庫県、鳥取県、岡山県' },
  {
    zone: 6,
    roman: 'VI',
    originLat: 36,
    originLon: 136,
    areaJa: '京都府、大阪府、福井県、滋賀県、三重県、奈良県、和歌山県',
  },
  { zone: 7, roman: 'VII', originLat: 36, originLon: dms(137, 10), areaJa: '石川県、富山県、岐阜県、愛知県' },
  {
    zone: 8,
    roman: 'VIII',
    originLat: 36,
    originLon: dms(138, 30),
    areaJa: '新潟県、長野県、山梨県、静岡県',
  },
  {
    zone: 9,
    roman: 'IX',
    originLat: 36,
    originLon: dms(139, 50),
    areaJa:
      '東京都（XIV・XVIII・XIX系の区域を除く）、福島県、栃木県、茨城県、埼玉県、千葉県、群馬県、神奈川県',
  },
  {
    zone: 10,
    roman: 'X',
    originLat: 40,
    originLon: dms(140, 50),
    areaJa: '青森県、秋田県、山形県、岩手県、宮城県',
  },
  {
    zone: 11,
    roman: 'XI',
    originLat: 44,
    originLon: dms(140, 15),
    areaJa:
      '北海道のうち小樽市、函館市、伊達市、北斗市、後志・渡島・檜山の各振興局管内、胆振のうち豊浦町・壮瞥町・洞爺湖町',
  },
  {
    zone: 12,
    roman: 'XII',
    originLat: 44,
    originLon: dms(142, 15),
    areaJa: '北海道（XI系・XIII系の区域を除く）',
  },
  {
    zone: 13,
    roman: 'XIII',
    originLat: 44,
    originLon: dms(144, 15),
    areaJa:
      '北海道のうち北見市、帯広市、釧路市、網走市、根室市、十勝・釧路・根室の各振興局管内、オホーツクの一部',
  },
  {
    zone: 14,
    roman: 'XIV',
    originLat: 26,
    originLon: 142,
    areaJa: '東京都のうち北緯28度以南・東経140度30分〜143度（小笠原諸島）',
  },
  {
    zone: 15,
    roman: 'XV',
    originLat: 26,
    originLon: 127.5,
    areaJa: '沖縄県のうち東経126度〜130度（沖縄本島など）',
  },
  { zone: 16, roman: 'XVI', originLat: 26, originLon: 124, areaJa: '沖縄県のうち東経126度以西（先島諸島）' },
  { zone: 17, roman: 'XVII', originLat: 26, originLon: 131, areaJa: '沖縄県のうち東経130度以東（大東諸島）' },
  {
    zone: 18,
    roman: 'XVIII',
    originLat: 20,
    originLon: 136,
    areaJa: '東京都のうち北緯28度以南・東経140度30分以西（沖ノ鳥島）',
  },
  {
    zone: 19,
    roman: 'XIX',
    originLat: 26,
    originLon: 154,
    areaJa: '東京都のうち北緯28度以南・東経143度以東（南鳥島）',
  },
];

const SINGLE_ZONE: Record<string, number> = {
  長崎県: 1,
  福岡県: 2,
  佐賀県: 2,
  熊本県: 2,
  大分県: 2,
  宮崎県: 2,
  山口県: 3,
  島根県: 3,
  広島県: 3,
  香川県: 4,
  愛媛県: 4,
  徳島県: 4,
  高知県: 4,
  兵庫県: 5,
  鳥取県: 5,
  岡山県: 5,
  京都府: 6,
  大阪府: 6,
  福井県: 6,
  滋賀県: 6,
  三重県: 6,
  奈良県: 6,
  和歌山県: 6,
  石川県: 7,
  富山県: 7,
  岐阜県: 7,
  愛知県: 7,
  新潟県: 8,
  長野県: 8,
  山梨県: 8,
  静岡県: 8,
  福島県: 9,
  栃木県: 9,
  茨城県: 9,
  埼玉県: 9,
  千葉県: 9,
  群馬県: 9,
  神奈川県: 9,
  青森県: 10,
  秋田県: 10,
  山形県: 10,
  岩手県: 10,
  宮城県: 10,
};

export interface ZoneSuggestion {
  zone: number;
  /** "exact": determined by prefecture alone; "by_position": prefecture + coordinates rule. */
  basis: 'exact' | 'by_position';
}

/**
 * Suggests the zone for a prefecture (and position, for prefectures split by
 * longitude/latitude). Returns undefined for 北海道, where the zone depends on the
 * municipality.
 */
export function suggestZone(
  prefecture: string | undefined,
  lat: number,
  lon: number,
): ZoneSuggestion | undefined {
  if (!prefecture) return undefined;
  const single = SINGLE_ZONE[prefecture];
  if (single !== undefined) return { zone: single, basis: 'exact' };
  switch (prefecture) {
    case '東京都':
      if (lat >= 28) return { zone: 9, basis: 'by_position' };
      if (lon < 140.5) return { zone: 18, basis: 'by_position' };
      return { zone: lon < 143 ? 14 : 19, basis: 'by_position' };
    case '沖縄県':
      if (lon < 126) return { zone: 16, basis: 'by_position' };
      return { zone: lon <= 130 ? 15 : 17, basis: 'by_position' };
    case '鹿児島県': {
      // I系: islands within 27°N–32°N and 128°18′E–130°00′E (奄美群島 up to 130°13′E).
      const inBox = lat >= 27 && lat < 32 && lon >= dms(128, 18);
      const westEnough = lon <= 130 || (lat < 28.6 && lon <= dms(130, 13));
      return { zone: inBox && westEnough ? 1 : 2, basis: 'by_position' };
    }
    default:
      return undefined;
  }
}

export function zoneInfo(zone: number): ZoneInfo | undefined {
  return ZONES.find((z) => z.zone === zone);
}

export function zoneTableText(): string {
  return ZONES.map((z) => `${z.zone}（${z.roman}系）: ${z.areaJa}`).join('\n');
}
