/**
 * Runs the engine on the generated sample data (public/sample/), when present.
 * The data is not in git: create it with `npm run sample`. These tests check
 * formats and internal consistency only; scoring against the generator's ground
 * truth is done by scripts/evaluate.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnosis.ts';
import { checkFollowup } from './followup.ts';
import { importFile } from './importers.ts';
import { exportPriceMaster } from './priceMaster.ts';
import { loadWorkspace, settingsFromJson } from './workspace.ts';

const SAMPLE = join(import.meta.dirname, '..', '..', 'public', 'sample');
const present = existsSync(join(SAMPLE, 'sales_A_202410-202609.csv'));
const file = (name: string) => ({ name, data: new Uint8Array(readFileSync(join(SAMPLE, name))) });
const MASTERS = [
  'customers.csv',
  'products.csv',
  'rate_tiers.csv',
  'categories.csv',
  'suppliers.csv',
  'list_price_history.csv',
  'cost_history.csv',
  'supplier_notices.csv',
  'revision_2025-04_agreements.csv',
];

describe.skipIf(!present)('sample data (架空)', () => {
  const settings = present
    ? settingsFromJson(JSON.parse(readFileSync(join(SAMPLE, 'demo_settings.json'), 'utf8')))
    : {};
  const load = (layout: 'A' | 'B') =>
    loadWorkspace(
      [...MASTERS, `special_prices_${layout}.csv`, `sales_${layout}_202410-202609.csv`].map(file),
      { settings },
    );

  it('reads both layouts into the same lines and the same diagnosis', () => {
    const a = load('A');
    const b = load('B');
    expect(a.importIssues).toEqual([]);
    expect(a.dataset.issues).toEqual([]);
    const la = a.sales.get('sales_A_202410-202609.csv') ?? [];
    const lb = b.sales.get('sales_B_202410-202609.csv') ?? [];
    expect(la).toHaveLength(56328);
    const key = (l: (typeof la)[number]) =>
      [l.id, l.date, l.cust, l.sku, l.qty, l.unitPrice, l.costSen, l.isReturn, l.priceType, l.remark].join(
        '|',
      );
    expect(la.map(key)).toEqual(lb.map(key));
    const da = diagnose(a.dataset, la);
    const db = diagnose(b.dataset, lb);
    expect(da.summary).toEqual(db.summary);
    expect(da.window).toEqual({ start: '2025-10-01', end: '2026-09-30' });
    expect(da.statusCounts.price_mismatch).toBe(0);
  });

  it('writes a price master that the sample layout B file matches byte for byte', () => {
    const ws = loadWorkspace([...MASTERS, 'next/price_master_B_20261201.csv'].map(file), { settings });
    const rows = ws.priceMasters.get('next/price_master_B_20261201.csv') ?? [];
    const out = exportPriceMaster(ws.dataset, rows, 'B');
    expect(
      Buffer.from(out.bytes).equals(readFileSync(join(SAMPLE, 'next/price_master_B_20261201.csv'))),
    ).toBe(true);
    const a = exportPriceMaster(ws.dataset, rows, 'A');
    const back = importFile('a.csv', a.bytes);
    const sampleA = importFile('sa.csv', readFileSync(join(SAMPLE, 'next/price_master_A_20261201.csv')));
    if (back.data.kind !== 'priceMaster' || sampleA.data.kind !== 'priceMaster') throw new Error('kind');
    const strip = (r: {
      cust: string;
      skuKey: string;
      effective: string;
      newPrice: number;
      currentPrice: number;
    }) => [r.cust, r.skuKey, r.effective, r.newPrice, r.currentPrice].join('|');
    expect(back.data.result.records.map(strip)).toEqual(sampleA.data.result.records.map(strip));
  });

  it('runs the 反映チェック on the December file in both layouts', () => {
    const run = (layout: 'A' | 'B') => {
      const ws = loadWorkspace(
        [...MASTERS, `next/price_master_${layout}_20261201.csv`, `next/sales_${layout}_202612.csv`].map(file),
        {
          settings,
        },
      );
      return checkFollowup(
        ws.dataset,
        ws.priceMasters.get(`next/price_master_${layout}_20261201.csv`) ?? [],
        ws.sales.get(`next/sales_${layout}_202612.csv`) ?? [],
      );
    };
    const a = run('A');
    const b = run('B');
    expect(a.counts).toEqual(b.counts);
    expect(a.lines).toHaveLength(2770);
    expect(a.stillOld.lines).toBeGreaterThan(0);
  });
});
