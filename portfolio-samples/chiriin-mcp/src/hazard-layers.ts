/**
 * Layers of 重ねるハザードマップ (GSI Hazard Map Portal) that are published as open
 * data raster tiles, with their legend colours.
 *
 * Source of URLs, zoom ranges and legend images:
 *   https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html
 * The RGB values below were read pixel-exactly from the official legend images
 * (shinsui_legend3.png, naisui_legend.png, shinsui_legend_l2_keizoku.png,
 * kaokutoukai_*.png, keikai_*.png) and cross-checked against live tiles (2026-10).
 */
export type HazardGroup = 'flood' | 'inland_flood' | 'storm_surge' | 'tsunami' | 'landslide';
export type LayerKind = 'depth' | 'duration' | 'zone';

export interface LegendEntry {
  rgb: readonly [number, number, number];
  labelJa: string;
  labelEn: string;
  /** Lower bound (depth in m, duration in hours). */
  min?: number;
  /** Upper bound; null = open-ended. */
  max?: number | null;
  /** 1 (low) .. 5 (high); used only for ordering and the 要注意 flag. */
  level: number;
}

export interface HazardLayer {
  id: string;
  group: HazardGroup;
  nameJa: string;
  nameEn: string;
  /** Path segment under https://disaportaldata.gsi.go.jp/raster/ */
  path: string;
  maxZoom: number;
  kind: LayerKind;
  unit?: 'm' | 'h';
  /** Rendered with a hatch/circle pattern, so gaps must be tolerated when sampling. */
  pattern: boolean;
  legend: readonly LegendEntry[];
  /** データ作成者 as stated by the portal. */
  sourceJa: string;
  noteJa?: string;
}

const depthLevel = (max: number | null): number => {
  if (max === null || max > 10) return 5;
  if (max > 5) return 4;
  if (max > 3) return 3;
  if (max > 0.5) return 2;
  return 1;
};

const depth = (
  rgb: readonly [number, number, number],
  labelJa: string,
  labelEn: string,
  min: number,
  max: number | null,
): LegendEntry => ({ rgb, labelJa, labelEn, min, max, level: depthLevel(max) });

/** 浸水深の凡例（洪水・高潮・津波で共通）。細分凡例の色（0.3m未満 / 0.5〜1m）を含む。 */
export const DEPTH_LEGEND: readonly LegendEntry[] = [
  depth([255, 255, 179], '0.3m未満', 'under 0.3 m', 0, 0.3),
  depth([247, 245, 169], '0.5m未満', 'under 0.5 m', 0, 0.5),
  depth([248, 225, 166], '0.5m以上1m未満', '0.5–1 m', 0.5, 1),
  depth([255, 216, 192], '0.5m以上3m未満', '0.5–3 m', 0.5, 3),
  depth([255, 183, 183], '3m以上5m未満', '3–5 m', 3, 5),
  depth([255, 145, 145], '5m以上10m未満', '5–10 m', 5, 10),
  depth([242, 133, 201], '10m以上20m未満', '10–20 m', 10, 20),
  depth([220, 122, 220], '20m以上', '20 m or more', 20, null),
];

/** 内水（雨水出水）: same colours, but depths below 0.1 m are not drawn. */
export const INLAND_DEPTH_LEGEND: readonly LegendEntry[] = [
  depth([255, 255, 179], '0.1m以上0.3m未満', '0.1–0.3 m', 0.1, 0.3),
  depth([247, 245, 169], '0.1m以上0.5m未満', '0.1–0.5 m', 0.1, 0.5),
  ...DEPTH_LEGEND.slice(2),
];

export const DURATION_LEGEND: readonly LegendEntry[] = [
  { rgb: [160, 210, 255], labelJa: '12時間未満', labelEn: 'under 12 hours', min: 0, max: 12, level: 1 },
  {
    rgb: [0, 65, 255],
    labelJa: '12時間以上1日未満',
    labelEn: '12 hours – 1 day',
    min: 12,
    max: 24,
    level: 1,
  },
  { rgb: [250, 245, 0], labelJa: '1日以上3日未満', labelEn: '1–3 days', min: 24, max: 72, level: 2 },
  {
    rgb: [255, 153, 0],
    labelJa: '3日以上1週間未満',
    labelEn: '3 days – 1 week',
    min: 72,
    max: 168,
    level: 3,
  },
  { rgb: [255, 40, 0], labelJa: '1週間以上2週間未満', labelEn: '1–2 weeks', min: 168, max: 336, level: 4 },
  {
    rgb: [180, 0, 104],
    labelJa: '2週間以上（地域により4週間以上を含む）',
    labelEn: '2 weeks or more (may include 4+ weeks in some areas)',
    min: 336,
    max: null,
    level: 5,
  },
  { rgb: [96, 0, 96], labelJa: '4週間以上', labelEn: '4 weeks or more', min: 672, max: null, level: 5 },
];

const zone = (rgb: readonly [number, number, number], labelJa: string, labelEn: string, level: number) => ({
  rgb,
  labelJa,
  labelEn,
  level,
});

const sedimentLegend = (
  special: readonly [number, number, number],
  specialPlanned: readonly [number, number, number],
  warning: readonly [number, number, number],
  warningPlanned: readonly [number, number, number],
): readonly LegendEntry[] => [
  zone(special, '土砂災害特別警戒区域（指定済）', 'Special warning zone (designated)', 5),
  zone(specialPlanned, '土砂災害特別警戒区域（指定予定）', 'Special warning zone (to be designated)', 5),
  zone(warning, '土砂災害警戒区域（指定済）', 'Warning zone (designated)', 3),
  zone(warningPlanned, '土砂災害警戒区域（指定予定）', 'Warning zone (to be designated)', 3),
];

const FLOOD_SOURCE = '国土交通省各地方整備局等・都道府県';
const SEDIMENT_SOURCE = '国土数値情報（令和7年度土砂災害警戒区域）をもとに国土地理院が加工';
const PARTIAL_NOTE = '都道府県管理河川などは一部の地域のみ配信されています。';

export const HAZARD_LAYERS: readonly HazardLayer[] = [
  {
    id: 'flood_max',
    group: 'flood',
    nameJa: '洪水浸水想定区域（想定最大規模）',
    nameEn: 'River flood inundation (maximum assumed rainfall)',
    path: '01_flood_l2_shinsuishin_data',
    maxZoom: 17,
    kind: 'depth',
    unit: 'm',
    pattern: false,
    legend: DEPTH_LEGEND,
    sourceJa: FLOOD_SOURCE,
    noteJa: PARTIAL_NOTE,
  },
  {
    id: 'flood_planned',
    group: 'flood',
    nameJa: '洪水浸水想定区域（計画規模）',
    nameEn: 'River flood inundation (planned-scale rainfall)',
    path: '01_flood_l1_shinsuishin_newlegend_data',
    maxZoom: 17,
    kind: 'depth',
    unit: 'm',
    pattern: false,
    legend: DEPTH_LEGEND,
    sourceJa: FLOOD_SOURCE,
    noteJa: PARTIAL_NOTE,
  },
  {
    id: 'flood_duration',
    group: 'flood',
    nameJa: '浸水継続時間（想定最大規模）',
    nameEn: 'Flood inundation duration (maximum assumed rainfall)',
    path: '01_flood_l2_keizoku_data',
    maxZoom: 17,
    kind: 'duration',
    unit: 'h',
    pattern: false,
    legend: DURATION_LEGEND,
    sourceJa: FLOOD_SOURCE,
    noteJa: PARTIAL_NOTE,
  },
  {
    id: 'house_collapse_overflow',
    group: 'flood',
    nameJa: '家屋倒壊等氾濫想定区域（氾濫流）',
    nameEn: 'House-collapse flood zone (overflow current)',
    path: '01_flood_l2_kaokutoukai_hanran_data',
    maxZoom: 17,
    kind: 'zone',
    pattern: true,
    legend: [
      zone([255, 0, 0], '家屋倒壊等氾濫想定区域（氾濫流）', 'House-collapse zone (overflow current)', 4),
    ],
    sourceJa: FLOOD_SOURCE,
    noteJa: '円形の模様で描かれているため、周辺数メートルを含めて判定しています。',
  },
  {
    id: 'house_collapse_erosion',
    group: 'flood',
    nameJa: '家屋倒壊等氾濫想定区域（河岸侵食）',
    nameEn: 'House-collapse flood zone (bank erosion)',
    path: '01_flood_l2_kaokutoukai_kagan_data',
    maxZoom: 17,
    kind: 'zone',
    pattern: false,
    legend: [
      zone([255, 127, 127], '家屋倒壊等氾濫想定区域（河岸侵食）', 'House-collapse zone (bank erosion)', 4),
      zone([255, 0, 0], '家屋倒壊等氾濫想定区域（河岸侵食）', 'House-collapse zone (bank erosion)', 4),
    ],
    sourceJa: FLOOD_SOURCE,
  },
  {
    id: 'inland_flood',
    group: 'inland_flood',
    nameJa: '内水（雨水出水）浸水想定区域',
    nameEn: 'Inland (stormwater) flooding',
    path: '02_naisui_data',
    maxZoom: 17,
    kind: 'depth',
    unit: 'm',
    pattern: false,
    legend: INLAND_DEPTH_LEGEND,
    sourceJa: '市町村（流域下水道、一部事務組合を含む）',
    noteJa: 'オープンデータ化を許可した一部の市町村のみ配信されています。',
  },
  {
    id: 'storm_surge',
    group: 'storm_surge',
    nameJa: '高潮浸水想定区域',
    nameEn: 'Storm surge inundation',
    path: '03_hightide_l2_shinsuishin_data',
    maxZoom: 17,
    kind: 'depth',
    unit: 'm',
    pattern: false,
    legend: DEPTH_LEGEND,
    sourceJa: '都道府県',
    noteJa: '作成済みの一部の都道府県のみ配信されています。',
  },
  {
    id: 'tsunami',
    group: 'tsunami',
    nameJa: '津波浸水想定',
    nameEn: 'Tsunami inundation',
    path: '04_tsunami_newlegend_data',
    maxZoom: 17,
    kind: 'depth',
    unit: 'm',
    pattern: false,
    legend: DEPTH_LEGEND,
    sourceJa: '都道府県',
    noteJa: '許諾を得た都道府県のデータのみ配信されています。',
  },
  {
    id: 'debris_flow',
    group: 'landslide',
    nameJa: '土砂災害警戒区域（土石流）',
    nameEn: 'Sediment disaster warning zone (debris flow)',
    path: '05_dosekiryukeikaikuiki',
    maxZoom: 17,
    kind: 'zone',
    pattern: false,
    legend: sedimentLegend([165, 0, 33], [183, 51, 77], [230, 200, 50], [235, 211, 91]),
    sourceJa: SEDIMENT_SOURCE,
  },
  {
    id: 'steep_slope',
    group: 'landslide',
    nameJa: '土砂災害警戒区域（急傾斜地の崩壊）',
    nameEn: 'Sediment disaster warning zone (steep slope failure)',
    path: '05_kyukeishakeikaikuiki',
    maxZoom: 17,
    kind: 'zone',
    pattern: false,
    legend: sedimentLegend([250, 40, 0], [251, 83, 51], [250, 230, 0], [251, 235, 51]),
    sourceJa: SEDIMENT_SOURCE,
  },
  {
    id: 'landslide',
    group: 'landslide',
    nameJa: '土砂災害警戒区域（地すべり）',
    nameEn: 'Sediment disaster warning zone (landslide)',
    path: '05_jisuberikeikaikuiki',
    maxZoom: 17,
    kind: 'zone',
    pattern: false,
    legend: sedimentLegend([180, 0, 40], [195, 51, 83], [255, 153, 0], [255, 173, 51]),
    sourceJa: SEDIMENT_SOURCE,
  },
];

export const HAZARD_LAYER_IDS = HAZARD_LAYERS.map((l) => l.id) as [string, ...string[]];

export function getLayer(id: string): HazardLayer | undefined {
  return HAZARD_LAYERS.find((l) => l.id === id);
}

export function tileUrl(layer: HazardLayer, z: number, x: number, y: number): string {
  return `https://disaportaldata.gsi.go.jp/raster/${layer.path}/${z}/${x}/${y}.png`;
}

/** Rough building-floor guide for a depth class (assumes ~3 m per storey). */
export function depthGuideJa(max: number | null | undefined): string | undefined {
  if (max === undefined) return undefined;
  if (max === null || max > 20) return '目安: 5階以上まで浸水';
  if (max > 10) return '目安: 4〜5階程度まで浸水';
  if (max > 5) return '目安: 2階の天井〜3階程度まで浸水';
  if (max > 3) return '目安: 2階の床上まで浸水';
  if (max > 0.5) return '目安: 1階の床上浸水（1階の天井付近まで）';
  return '目安: 床下浸水程度（大人の膝くらいまで）';
}
