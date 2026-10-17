/**
 * The generator's truth rules (data-gen/lib/rules.ts) read free goods, bills
 * above the correct price and the rank's upper limit the same way as the app, as
 * data-gen/README.md says.
 * data-gen is its own package (not type-checked with the app), so it is loaded
 * at run time. All data here is fictional (架空).
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

interface Rules {
  isSampleRemark(remark: string): boolean;
  classifyHistoryLine(ctx: unknown, line: unknown): { label: string; shortfall: number };
}

const RULES = pathToFileURL(join(import.meta.dirname, '..', '..', 'data-gen', 'lib', 'rules.ts')).href;
let rules: Rules;
beforeAll(async () => {
  rules = (await import(/* @vite-ignore */ RULES)) as Rules;
});

/** P1: 定価 1,000 → 1,100 (2025-04-01); P2: 定価 1,200 → 1,100 (a cut, 2025-04-01). Rank B 70–75%, 掛率 72%. */
const ctx = {
  floorPct: 10,
  revisionDate: '2025-04-01',
  tiers: new Map([['B', { min: 700, max: 750 }]]),
  customers: new Map([['000001', { rank: 'B', ratePm: 720 }]]),
  productCat: new Map([
    ['P1', 'DB'],
    ['P2', 'DB'],
  ]),
  listHist: new Map([
    [
      'P1',
      [
        { price: 1000, start: '2024-04-01', end: '2025-03-31' },
        { price: 1100, start: '2025-04-01', end: null },
      ],
    ],
    [
      'P2',
      [
        { price: 1200, start: '2024-04-01', end: '2025-03-31' },
        { price: 1100, start: '2025-04-01', end: null },
      ],
    ],
  ]),
  agreements: new Map(),
  specials: new Map(),
};

const line = (sku: string, billed: number, remark = '', costSen = 50000) => ({
  date: '2025-06-10',
  cust: '000001',
  sku,
  qty: 2,
  billed,
  costSen,
  remark,
  isReturn: false,
});

describe('data-gen truth rules', () => {
  it('treat a 0-yen line with 見本・サンプル・無償・試供 as free goods, and other 0-yen lines as leaks', () => {
    for (const w of ['見本品', 'サンプル', '販促品(無償提供)', '試供品'])
      expect(rules.classifyHistoryLine(ctx, line('P1', 0, w)).label, w).toBe('ok_sample');
    expect(rules.classifyHistoryLine(ctx, line('P1', 0, '販促品')).label).toBe('leak_rate_out_of_tier');
  });

  it('do not count a bill above the correct price as a leak', () => {
    // above the rank's upper limit (1,100 × 75% = 825; correct price 792)
    expect(rules.classifyHistoryLine(ctx, line('P1', 830))).toMatchObject({
      label: 'overcharge',
      shortfall: 0,
    });
    // the old, higher 定価 after a cut (1,200 × 72% = 864)
    expect(rules.classifyHistoryLine(ctx, line('P2', 864))).toMatchObject({
      label: 'overcharge',
      shortfall: 0,
    });
    // the margin floor still counts: 原単価 900円, so the floor price is 1,000円
    expect(rules.classifyHistoryLine(ctx, line('P1', 830, '', 90000))).toMatchObject({
      label: 'leak_below_margin_floor',
      shortfall: (1000 - 830) * 2,
    });
    // below the rank's lower limit is still 掛率ランク外 (1,100 × 70% = 770)
    expect(rules.classifyHistoryLine(ctx, line('P1', 760)).label).toBe('leak_rate_out_of_tier');
  });

  it('count a bill below the correct price but above the rank upper limit as 掛率ランク外, like the app', () => {
    // 掛率 78% is above rank B (70–75%): correct 858円, upper limit 825円, billed 840円
    const high = { ...ctx, customers: new Map([['000001', { rank: 'B', ratePm: 780 }]]) };
    expect(rules.classifyHistoryLine(high, line('P1', 840))).toMatchObject({
      label: 'leak_rate_out_of_tier',
      shortfall: (858 - 840) * 2,
    });
  });
});
