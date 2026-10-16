import { describe, expect, it } from 'vitest';
import { runScenario } from './scenario.ts';
import { fixtureDataset } from './testing/fixtures.ts';

const shock = { material: 10, labor: 5, energy: 20, other: 0 };

describe('runScenario', () => {
  const ds = fixtureDataset();

  it('raises each cost component by its share and rate', () => {
    const r = runScenario(ds, { shock, asOf: '2026-09-30' });
    const db = r.items.get('DB-1001');
    // 311.41円 × (55%×10% + 15%×5% + 15%×20%) per component, rounded to the 銭
    expect(db).toMatchObject({
      currentCostSen: 31141,
      byComponent: { material: 1713, labor: 234, energy: 934, other: 0 },
      deltaSen: 2881,
      newCostSen: 34022,
      changeBp: 925,
      source: 'model',
    });
    expect(r.items.get('KG-1001')).toMatchObject({ deltaSen: 5040, newCostSen: 65040, changeBp: 840 });
  });

  it('uses the cost on the as-of day', () => {
    const r = runScenario(ds, { shock, asOf: '2025-03-31', skus: ['DB-1001'] });
    expect(r.items.get('DB-1001')?.currentCostSen).toBe(29323);
    expect(r.items.size).toBe(1);
  });

  it('applies per-category shocks', () => {
    const r = runScenario(ds, { shock, asOf: '2026-09-30', categoryShocks: { KG: { material: 20 } } });
    expect(r.items.get('KG-1001')?.byComponent.material).toBe(5400);
    expect(r.items.get('KG-1001')?.appliedBp).toEqual({ material: 2000, labor: 500, energy: 2000, other: 0 });
    expect(r.items.get('DB-1001')?.byComponent.material).toBe(1713);
  });

  it('uses a supplier notice instead of the model when asked', () => {
    const withNotice = fixtureDataset({
      supplierNotices: [
        {
          noticeDate: '2026-08-01',
          supplier: 'S12',
          supplierName: '架空鋼材株式会社',
          sku: 'KG-1001',
          currentCostSen: 60000,
          newCostSen: 67200,
          effective: '2026-11-01',
          reason: '鋼材価格の上昇',
          status: '予定',
        },
      ],
    });
    const used = runScenario(withNotice, { shock, asOf: '2026-09-30', supplierNotices: 'use' });
    expect(used.items.get('KG-1001')).toMatchObject({ source: 'notice', deltaSen: 7200, changeBp: 1200 });
    const ignored = runScenario(withNotice, { shock, asOf: '2026-09-30' });
    expect(ignored.items.get('KG-1001')?.source).toBe('model');
    const already = runScenario(withNotice, { shock, asOf: '2026-11-15', supplierNotices: 'use' });
    expect(already.items.get('KG-1001')?.source).toBe('model');
  });

  it('uses only the notices in force by the proposal date, combined in date order', () => {
    const notice = (effective: string, currentCostSen: number, newCostSen: number) => ({
      noticeDate: '2026-08-01',
      supplier: 'S12',
      supplierName: '架空鋼材株式会社',
      sku: 'KG-1001',
      currentCostSen,
      newCostSen,
      effective,
      reason: '鋼材価格の上昇',
      status: '予定',
    });
    // chained: 600円 → 660円 (11/1), then 660円 → 693円 (2027/2/1)
    const chained = fixtureDataset({
      supplierNotices: [notice('2027-02-01', 66000, 69300), notice('2026-11-01', 60000, 66000)],
    });
    const run = (ds: typeof chained, horizon: string) =>
      runScenario(ds, { shock, asOf: '2026-09-30', supplierNotices: 'use', horizon }).items.get('KG-1001');
    // between the two notices: only the first has started (+10%), not the later +5%
    expect(run(chained, '2026-12-01')).toMatchObject({ source: 'notice', deltaSen: 6000, changeBp: 1000 });
    expect(run(chained, '2026-12-01')?.notices).toHaveLength(1);
    // after both: both increases (600円 → 693円, +15.5%), not just the later +5%
    expect(run(chained, '2027-04-01')).toMatchObject({ source: 'notice', deltaSen: 9300, changeBp: 1550 });
    expect(run(chained, '2027-04-01')?.notices.map((n) => n.effective)).toEqual(['2026-11-01', '2027-02-01']);
    // before either: the cost model
    expect(run(chained, '2026-10-15')?.source).toBe('model');
    // each notice stated from today's cost (600円 → 660円, 600円 → 693円): the same 693円 by April
    const fromToday = fixtureDataset({
      supplierNotices: [notice('2026-11-01', 60000, 66000), notice('2027-02-01', 60000, 69300)],
    });
    expect(run(fromToday, '2027-04-01')).toMatchObject({ deltaSen: 9300 });
  });

  it('is zero when nothing rises', () => {
    const r = runScenario(ds, { shock: { material: 0, labor: 0, energy: 0, other: 0 }, asOf: '2026-09-30' });
    for (const item of r.items.values()) expect(item.deltaSen).toBe(0);
  });
});
