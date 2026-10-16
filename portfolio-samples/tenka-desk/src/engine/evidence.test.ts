import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildEvidence,
  parseIndexDataset,
  parseMinimumWage,
  parseShunto,
  type StatsBundle,
  seriesForCategory,
} from './evidence.ts';

const STATS = join(import.meta.dirname, '..', '..', 'public', 'stats');
const json = (name: string): unknown => JSON.parse(readFileSync(join(STATS, name), 'utf8'));

const stats: StatsBundle = {
  cgpi: parseIndexDataset(json('cgpi.json')),
  sppi: parseIndexDataset(json('sppi.json')),
  minimumWage: parseMinimumWage(json('minimum-wage.json')),
  shunto: parseShunto(json('shunto.json')),
};

const PAPER = {
  code: 'DB',
  name: '段ボール・紙器',
  mainMaterial: '段ボール原紙',
  costShare: { material: 55, labor: 15, energy: 15, other: 15 },
};
const STEEL = {
  code: 'KG',
  name: '工具・金物',
  mainMaterial: '鋼材',
  costShare: { material: 45, labor: 30, energy: 12, other: 13 },
};

describe('parsing the bundled statistics', () => {
  it('reads every file with its credit line', () => {
    expect(stats.cgpi?.periods.at(-1)).toBe('2026-09');
    expect(stats.cgpi?.credit).toContain('日本銀行');
    expect(stats.minimumWage?.national.at(-1)).toMatchObject({
      fiscalYear: 2026,
      yen: 1177,
      increaseYen: 56,
      increasePct: 5,
    });
    expect(stats.shunto?.series.at(-1)).toEqual({ year: 2026, settlementYen: 18167, ratePct: 5.18 });
    expect(stats.minimumWage?.credit).toContain('加工して作成');
  });

  it('rejects malformed input', () => {
    expect(() => parseIndexDataset({})).toThrow(TypeError);
    expect(() => parseIndexDataset({ ...(json('cgpi.json') as object), periods: ['2026/09'] })).toThrow(
      TypeError,
    );
    expect(() => parseShunto(null)).toThrow(TypeError);
  });
});

describe('seriesForCategory', () => {
  it('maps categories to CGPI series by their materials', () => {
    const cgpi = stats.cgpi;
    if (!cgpi) throw new Error('cgpi');
    const name = (codes: string[]) => codes.map((c) => cgpi.series.find((s) => s.code === c)?.name);
    expect(name(seriesForCategory(PAPER, cgpi))).toEqual(['パルプ・紙・同製品']);
    expect(name(seriesForCategory(STEEL, cgpi))).toEqual(['鉄鋼', '金属製品']);
    expect(seriesForCategory({ ...PAPER, name: '雑貨', mainMaterial: '' }, cgpi)).toEqual([]);
  });
});

describe('buildEvidence', () => {
  const cgpi = stats.cgpi;
  if (!cgpi) throw new Error('cgpi');
  const items = buildEvidence(stats, {
    asOf: '2026-10-16',
    materialSeries: seriesForCategory(PAPER, cgpi),
    prefecture: '岩手',
  });

  it('orders items: materials, energy, logistics, labour, general', () => {
    expect(items.map((i) => i.topic)).toEqual([
      'material',
      'energy',
      'logistics',
      'labor',
      'labor',
      'general',
    ]);
  });

  it('labels computed rates of change and quotes official ones as published', () => {
    const paper = items[0];
    expect(paper?.computedByTool).toBe(true);
    // 126.5 (令和7年9月) → 134.9 (令和8年9月): +6.6%
    expect(paper?.statement).toBe(
      '日本銀行「企業物価指数」によりますと、国内企業物価指数のパルプ・紙・同製品（2020年=100）は令和8年9月に134.9となり、令和7年9月の126.5から6.6%上昇しております（変化率は本ツールで計算）。',
    );
    expect(paper?.chart?.points).toHaveLength(36);
    const general = items.find((i) => i.topic === 'general');
    expect(general?.computedByTool).toBe(false);
    expect(general?.statement).toContain('前年同月比+6.8％');
  });

  it('quotes the minimum wage and shows whether a prefecture’s new amount is in force', () => {
    const mw = items.find((i) => i.id === 'minimum-wage');
    expect(mw?.statement).toContain(
      '令和8年度の地域別最低賃金（改定額）の全国加重平均は1,177円で、前年度から56円（5.0％）の引上げ',
    );
    expect(mw?.statement).toContain('岩手県は1,090円（令和8年12月1日発効予定）');
    const osaka = buildEvidence(stats, { asOf: '2026-10-16', materialSeries: [], prefecture: '大阪府' }).find(
      (i) => i.id === 'minimum-wage',
    );
    expect(osaka?.statement).toContain('大阪府は1,231円（令和8年10月1日発効）');
    const shunto = items.find((i) => i.id === 'shunto');
    expect(shunto?.statement).toContain('令和8年の賃上げ率は5.18％（妥結額18,167円）');
  });

  it('uses a given base period and can leave topics out', () => {
    const some = buildEvidence(stats, {
      asOf: '2026-10-16',
      materialSeries: seriesForCategory(STEEL, cgpi),
      basePeriod: '2025-04',
      include: { labor: false, general: false, logistics: false, energy: false },
    });
    expect(some.map((i) => i.title)).toEqual(['国内企業物価指数（鉄鋼）', '国内企業物価指数（金属製品）']);
    expect(some[0]?.statement).toContain('令和7年4月');
    expect(buildEvidence({}, { asOf: '2026-10-16', materialSeries: [] })).toEqual([]);
  });
});
