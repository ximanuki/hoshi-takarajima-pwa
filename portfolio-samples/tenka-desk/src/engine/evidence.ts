/**
 * Evidence from public statistics (公表統計) for the 申入書.
 *
 * The statistics are snapshots shipped with the app (public/stats/*.json); the
 * engine never fetches them. Figures published by the source are quoted as they
 * are; rates of change the source does not publish (e.g. the year-on-year change
 * of a CGPI category) are computed here and labelled 「本ツールで計算」.
 * Every item carries its source and credit line.
 */

import { type IsoDate, toWareki, toWarekiFiscalYear, toWarekiMonth } from './dates.ts';
import { changeBp } from './money.ts';
import { formatRatioPct, withCommas } from './text.ts';
import type { Category } from './types.ts';

/* ---------- dataset types and parsers ---------- */

export interface IndexSeries {
  code: string;
  name: string;
  unit: string;
  values: number[];
}

export interface IndexDataset {
  id: string;
  title: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  periods: string[];
  series: IndexSeries[];
  notes: string[];
  credit: string;
}

export interface MinimumWageValue {
  fiscalYear: number;
  yen: number;
  effectiveDate: IsoDate | null;
  increaseYen: number | null;
  increasePct: number | null;
}

export interface MinimumWageDataset {
  title: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  national: MinimumWageValue[];
  prefectures: { code: string; name: string; fullName: string; values: MinimumWageValue[] }[];
  notes: string[];
  credit: string;
}

export interface ShuntoDataset {
  title: string;
  publisher: string;
  url: string;
  retrievedAt: string;
  series: { year: number; settlementYen: number; ratePct: number }[];
  notes: string[];
  credit: string;
}

export interface StatsBundle {
  cgpi?: IndexDataset;
  sppi?: IndexDataset;
  minimumWage?: MinimumWageDataset;
  shunto?: ShuntoDataset;
}

type Obj = Record<string, unknown>;

function obj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new TypeError(`${what}: object expected`);
  return v as Obj;
}
function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new TypeError(`${what}: array expected`);
  return v;
}
function s(o: Obj, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new TypeError(`${k}: string expected`);
  return v;
}
function n(o: Obj, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${k}: number expected`);
  return v;
}
function nOrNull(o: Obj, k: string): number | null {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** cgpi.json / sppi.json */
export function parseIndexDataset(json: unknown): IndexDataset {
  const o = obj(json, 'index dataset');
  const periods = arr(o['periods'], 'periods').map((p) => {
    if (typeof p !== 'string' || !/^\d{4}-\d{2}$/.test(p)) throw new TypeError(`bad period ${String(p)}`);
    return p;
  });
  const series = arr(o['series'], 'series').map((x) => {
    const so = obj(x, 'series');
    const values = arr(so['values'], 'values').map((v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('series value must be a number');
      return v;
    });
    if (values.length !== periods.length)
      throw new TypeError(`series ${s(so, 'code')}: values and periods differ in length`);
    return { code: s(so, 'code'), name: s(so, 'name_ja'), unit: s(so, 'unit_ja'), values };
  });
  return {
    id: s(o, 'id'),
    title: s(o, 'title_ja'),
    publisher: s(o, 'publisher_ja'),
    url: s(o, 'source_page_url'),
    retrievedAt: s(o, 'retrieved_at_utc'),
    periods,
    series,
    notes: strings(o['notes_ja']),
    credit: s(o, 'credit_ja'),
  };
}

function mwValue(x: unknown): MinimumWageValue {
  const o = obj(x, 'minimum wage value');
  const eff = o['effective_date'];
  return {
    fiscalYear: n(o, 'fiscal_year'),
    yen: n(o, 'yen'),
    effectiveDate: typeof eff === 'string' ? eff : null,
    increaseYen: nOrNull(o, 'increase_yen_official'),
    increasePct: nOrNull(o, 'increase_rate_pct_official'),
  };
}

/** minimum-wage.json */
export function parseMinimumWage(json: unknown): MinimumWageDataset {
  const o = obj(json, 'minimum wage');
  const byPref = obj(o['by_prefecture'], 'by_prefecture');
  return {
    title: s(o, 'title_ja'),
    publisher: s(o, 'publisher_ja'),
    url: s(o, 'source_page_url'),
    retrievedAt: s(o, 'retrieved_at_utc'),
    national: arr(o['national_weighted_average'], 'national').map(mwValue),
    prefectures: arr(byPref['prefectures'], 'prefectures').map((x) => {
      const p = obj(x, 'prefecture');
      return {
        code: s(p, 'code'),
        name: s(p, 'name_ja'),
        fullName: s(p, 'name_ja_full'),
        values: arr(p['values'], 'values').map(mwValue),
      };
    }),
    notes: strings(o['notes_ja']),
    credit: s(o, 'credit_ja'),
  };
}

/** shunto.json */
export function parseShunto(json: unknown): ShuntoDataset {
  const o = obj(json, 'shunto');
  return {
    title: s(o, 'title_ja'),
    publisher: s(o, 'publisher_ja'),
    url: s(o, 'source_page_url'),
    retrievedAt: s(o, 'retrieved_at_utc'),
    series: arr(o['series'], 'series').map((x) => {
      const r = obj(x, 'shunto row');
      return { year: n(r, 'year'), settlementYen: n(r, 'settlement_yen'), ratePct: n(r, 'rate_pct') };
    }),
    notes: strings(o['notes_ja']),
    credit: s(o, 'credit_ja'),
  };
}

/* ---------- evidence items ---------- */

export type EvidenceTopic = 'material' | 'energy' | 'logistics' | 'labor' | 'general';

export const EVIDENCE_TOPIC_JA: Record<EvidenceTopic, string> = {
  material: '原材料価格',
  energy: 'エネルギー価格',
  logistics: '物流費',
  labor: '人件費',
  general: '物価全般',
};

export interface ChartSeries {
  label: string;
  unit: string;
  points: { period: string; value: number }[];
}

export interface EvidenceItem {
  id: string;
  topic: EvidenceTopic;
  title: string;
  /** one formal sentence for the letter */
  statement: string;
  figures: { label: string; value: string }[];
  /** a figure was computed by this tool, not published by the source */
  computedByTool: boolean;
  source: { publisher: string; title: string; url: string; retrievedAt: string; credit: string };
  chart: ChartSeries | null;
}

/** Keywords in a category's name or main material -> CGPI category names. */
const MATERIAL_KEYWORDS: readonly [RegExp, string[]][] = [
  [/(紙|パルプ|原紙|段ボール)/, ['パルプ・紙・同製品']],
  [/(樹脂|ポリエチレン|ポリプロピレン|フィルム|発泡|プラスチック)/, ['プラスチック製品']],
  [/(化学|界面活性剤|粘着剤|ゴム|ニトリル)/, ['化学製品']],
  [/(鋼|鉄)/, ['鉄鋼', '金属製品']],
  [/(銅|アルミ|非鉄)/, ['非鉄金属']],
  [/(石油|燃料|ナフサ)/, ['石油・石炭製品']],
];

/** CGPI series codes that fit a category, from keywords in its name and main material. */
export function seriesForCategory(category: Category, cgpi: IndexDataset): string[] {
  const text = `${category.name} ${category.mainMaterial}`;
  const names = new Set<string>();
  for (const [re, targets] of MATERIAL_KEYWORDS) if (re.test(text)) for (const t of targets) names.add(t);
  return cgpi.series.filter((x) => names.has(x.name)).map((x) => x.code);
}

export interface EvidenceOptions {
  /** date of the letter: decides which minimum wages are in force */
  asOf: IsoDate;
  /** CGPI series codes for raw materials (e.g. from seriesForCategory) */
  materialSeries: readonly string[];
  /** compare the latest month with this month ("YYYY-MM"); default: 12 months earlier */
  basePeriod?: string;
  /** a prefecture to quote next to the national minimum wage (e.g. "大阪") */
  prefecture?: string;
  include?: Partial<Record<EvidenceTopic, boolean>>;
}

function tenths(v: number): number {
  return Math.round(v * 10);
}

function fmtIndex(v: number): string {
  const t = tenths(v);
  return `${Math.trunc(t / 10)}.${Math.abs(t % 10)}`;
}

function direction(bp: number): string {
  return bp > 0 ? '上昇' : bp < 0 ? '低下' : '横ばい';
}

function shiftPeriod(period: string, months: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = (((m % 12) + 12) % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/** Name of the statistic as credited ("企業物価指数"), else the dataset title without its parenthesis. */
function statName(ds: IndexDataset): string {
  return /「([^」]+)」/.exec(ds.credit)?.[1] ?? ds.title.replace(/（.*）$/, '');
}

function publisherShort(publisher: string): string {
  return publisher.replace(/\s.*$/, '');
}

function indexChange(
  ds: IndexDataset,
  code: string,
  basePeriod: string | undefined,
  topic: EvidenceTopic,
): EvidenceItem | null {
  const series = ds.series.find((x) => x.code === code);
  if (!series || ds.periods.length === 0) return null;
  const lastIdx = ds.periods.length - 1;
  const latestPeriod = ds.periods[lastIdx] as string;
  let baseIdx = basePeriod !== undefined ? ds.periods.indexOf(basePeriod) : -1;
  if (baseIdx < 0) baseIdx = ds.periods.indexOf(shiftPeriod(latestPeriod, -12));
  if (baseIdx < 0) baseIdx = 0;
  const basePer = ds.periods[baseIdx] as string;
  const latest = series.values[lastIdx] as number;
  const base = series.values[baseIdx] as number;
  const bp = changeBp(tenths(latest), tenths(base));
  const indexTitle = ds.title.replace(/（.*）$/, '');
  const stat = statName(ds);
  const subject = indexTitle === stat ? series.name : `${indexTitle}の${series.name}`;
  const title = `${indexTitle}（${series.name}）`;
  const statement = `${publisherShort(ds.publisher)}「${stat}」によりますと、${subject}（${series.unit}）は${toWarekiMonth(latestPeriod)}に${fmtIndex(latest)}となり、${toWarekiMonth(basePer)}の${fmtIndex(base)}から${formatRatioPct(Math.abs(tenths(latest) - tenths(base)), tenths(base))}${direction(bp)}しております（変化率は本ツールで計算）。`;
  return {
    id: `${ds.id}:${code}`,
    topic,
    title,
    statement,
    figures: [
      { label: toWarekiMonth(basePer), value: fmtIndex(base) },
      { label: toWarekiMonth(latestPeriod), value: fmtIndex(latest) },
      {
        label: '変化率（本ツールで計算）',
        value: `${bp >= 0 ? '+' : ''}${formatRatioPct(tenths(latest) - tenths(base), tenths(base))}`,
      },
    ],
    computedByTool: true,
    source: {
      publisher: ds.publisher,
      title: ds.title,
      url: ds.url,
      retrievedAt: ds.retrievedAt,
      credit: ds.credit,
    },
    chart: {
      label: title,
      unit: series.unit,
      points: ds.periods.map((p, i) => ({ period: p, value: series.values[i] as number })),
    },
  };
}

function officialYoY(ds: IndexDataset, code: string): EvidenceItem | null {
  const series = ds.series.find((x) => x.code === code);
  if (!series || ds.periods.length === 0) return null;
  const lastIdx = ds.periods.length - 1;
  const period = ds.periods[lastIdx] as string;
  const v = series.values[lastIdx] as number;
  const title = ds.title.replace(/（.*）$/, '');
  return {
    id: `${ds.id}:${code}`,
    topic: 'general',
    title: `${title}（総平均・前年比）`,
    statement: `${publisherShort(ds.publisher)}「${statName(ds)}」によりますと、${toWarekiMonth(period)}の${title}（総平均）は前年同月比${v >= 0 ? '+' : ''}${v.toFixed(1)}％でございました。`,
    figures: [
      { label: `${toWarekiMonth(period)} 前年同月比`, value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
    ],
    computedByTool: false,
    source: {
      publisher: ds.publisher,
      title: ds.title,
      url: ds.url,
      retrievedAt: ds.retrievedAt,
      credit: ds.credit,
    },
    chart: {
      label: `${title} 総平均 前年比`,
      unit: series.unit,
      points: ds.periods.map((p, i) => ({ period: p, value: series.values[i] as number })),
    },
  };
}

function minimumWageItem(
  mw: MinimumWageDataset,
  asOf: IsoDate,
  prefecture: string | undefined,
): EvidenceItem | null {
  const latest = mw.national[mw.national.length - 1];
  if (!latest) return null;
  const prev = mw.national.find((x) => x.fiscalYear === latest.fiscalYear - 1);
  const incYen = latest.increaseYen ?? (prev ? latest.yen - prev.yen : null);
  const incPct = latest.increasePct;
  const fy = toWarekiFiscalYear(latest.fiscalYear);
  let statement = `厚生労働省「地域別最低賃金の全国一覧」によりますと、${fy}の地域別最低賃金（改定額）の全国加重平均は${withCommas(latest.yen)}円で`;
  statement +=
    incYen !== null
      ? `、前年度から${incYen}円${incPct !== null ? `（${incPct.toFixed(1)}％）` : ''}の引上げとなっております。`
      : 'ございます。';
  const figures = [{ label: `${fy} 全国加重平均`, value: `${withCommas(latest.yen)}円` }];
  if (incYen !== null)
    figures.push({
      label: '前年度からの引上げ',
      value: `${incYen}円${incPct !== null ? `（${incPct.toFixed(1)}%）` : ''}`,
    });
  if (prefecture) {
    const p = mw.prefectures.find((x) => x.name === prefecture || x.fullName === prefecture);
    const v = p?.values[p.values.length - 1];
    if (p && v) {
      const inForce = v.effectiveDate !== null && v.effectiveDate <= asOf;
      const when = v.effectiveDate ? `${toWareki(v.effectiveDate)}${inForce ? '発効' : '発効予定'}` : '';
      statement += `${p.fullName}は${withCommas(v.yen)}円（${when}）でございます。`;
      figures.push({ label: `${p.fullName}（${when}）`, value: `${withCommas(v.yen)}円` });
    }
  }
  return {
    id: 'minimum-wage',
    topic: 'labor',
    title: '地域別最低賃金（全国加重平均）',
    statement,
    figures,
    computedByTool: false,
    source: {
      publisher: mw.publisher,
      title: mw.title,
      url: mw.url,
      retrievedAt: mw.retrievedAt,
      credit: mw.credit,
    },
    chart: {
      label: '地域別最低賃金 全国加重平均',
      unit: '円（時間額）',
      points: mw.national.map((x) => ({ period: String(x.fiscalYear), value: x.yen })),
    },
  };
}

function shuntoItem(sh: ShuntoDataset): EvidenceItem | null {
  const latest = sh.series[sh.series.length - 1];
  if (!latest) return null;
  const era = toWareki(`${latest.year}-04-01`).replace(/年.*$/, '年');
  return {
    id: 'shunto',
    topic: 'labor',
    title: '民間主要企業 春季賃上げ状況',
    statement: `また、厚生労働省「民間主要企業春季賃上げ要求・妥結状況」によりますと、${era}の賃上げ率は${latest.ratePct.toFixed(2)}％（妥結額${withCommas(latest.settlementYen)}円）でございました。`,
    figures: [
      { label: `${era} 賃上げ率`, value: `${latest.ratePct.toFixed(2)}%` },
      { label: `${era} 妥結額`, value: `${withCommas(latest.settlementYen)}円` },
    ],
    computedByTool: false,
    source: {
      publisher: sh.publisher,
      title: sh.title,
      url: sh.url,
      retrievedAt: sh.retrievedAt,
      credit: sh.credit,
    },
    chart: {
      label: '春季賃上げ率',
      unit: '％',
      points: sh.series.map((x) => ({ period: String(x.year), value: x.ratePct })),
    },
  };
}

const CGPI_TOTAL_YOY = 'PRCG20_2200000000%';
const CGPI_ENERGY_NAME = '電力・都市ガス・水道';
const SPPI_FREIGHT_NAME = '道路貨物輸送';

/** Evidence items for a letter, in the order: materials, energy, logistics, labour, general. */
export function buildEvidence(stats: StatsBundle, options: EvidenceOptions): EvidenceItem[] {
  const inc = {
    material: true,
    energy: true,
    logistics: true,
    labor: true,
    general: true,
    ...options.include,
  };
  const out: EvidenceItem[] = [];
  const push = (x: EvidenceItem | null) => {
    if (x && !out.some((y) => y.id === x.id)) out.push(x);
  };
  if (stats.cgpi && inc.material)
    for (const code of options.materialSeries)
      push(indexChange(stats.cgpi, code, options.basePeriod, 'material'));
  if (stats.cgpi && inc.energy) {
    const e = stats.cgpi.series.find((x) => x.name === CGPI_ENERGY_NAME);
    if (e) push(indexChange(stats.cgpi, e.code, options.basePeriod, 'energy'));
  }
  if (stats.sppi && inc.logistics) {
    const f = stats.sppi.series.find((x) => x.name === SPPI_FREIGHT_NAME);
    if (f) push(indexChange(stats.sppi, f.code, options.basePeriod, 'logistics'));
  }
  if (stats.minimumWage && inc.labor)
    push(minimumWageItem(stats.minimumWage, options.asOf, options.prefecture));
  if (stats.shunto && inc.labor) push(shuntoItem(stats.shunto));
  if (stats.cgpi && inc.general) push(officialYoY(stats.cgpi, CGPI_TOTAL_YOY));
  return out;
}
