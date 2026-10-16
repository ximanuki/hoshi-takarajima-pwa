import { describe, expect, it } from 'vitest';
import { Dataset, inferRevisionDates } from './dataset.ts';
import { fixtureDataset, fixtureInput, REVISION } from './testing/fixtures.ts';

describe('applicableList', () => {
  const ds = fixtureDataset();

  it('moves an agreed customer to the new 定価 and remembers the old one', () => {
    const l = ds.applicableList('000001', 'DB-1001', '2025-05-10');
    expect(l).toMatchObject({ price: 770, basis: 'current', previousPrice: 710, since: REVISION });
    expect(ds.applicableList('000001', 'DB-1001', '2025-03-31')).toMatchObject({
      price: 710,
      previousPrice: null,
    });
  });

  it('keeps the old 定価 for 見送り, excluded categories and before an agreed later date', () => {
    expect(ds.applicableList('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 710,
      basis: 'kept_declined',
      previousPrice: null,
    });
    expect(ds.applicableList('000003', 'KG-1001', '2025-05-10')).toMatchObject({
      price: 1000,
      basis: 'kept_excluded_category',
    });
    expect(ds.applicableList('000003', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 770,
      basis: 'current',
    });
    expect(ds.applicableList('000004', 'DB-1001', '2025-05-31')).toMatchObject({
      price: 710,
      basis: 'kept_before_agreed_date',
    });
    expect(ds.applicableList('000004', 'DB-1001', '2025-06-01')).toMatchObject({
      price: 770,
      basis: 'current',
      previousPrice: 710,
      since: '2025-06-01',
    });
  });

  it('applies a 定価 change to a customer with no recorded answer', () => {
    const input = fixtureInput();
    const rev = input.revisions?.[0];
    if (!rev) throw new Error('fixture');
    const ds2 = new Dataset({
      ...input,
      revisions: [{ ...rev, agreements: rev.agreements.filter((a) => a.cust !== '000001') }],
    });
    expect(ds2.applicableList('000001', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 770,
      previousPrice: 710,
    });
  });

  it('returns null before the first 定価 and uses the master 定価 without history', () => {
    expect(ds.applicableList('000001', 'DB-1001', '2020-01-01')).toBeNull();
    const ds2 = fixtureDataset({ listPriceHistory: [] });
    expect(ds2.applicableList('000001', 'DB-1001', '2020-01-01')).toMatchObject({
      price: 770,
      previousPrice: null,
    });
  });
});

describe('expected price, 特値 and cost', () => {
  const ds = fixtureDataset();

  it('uses a valid 特値, else 定価 × 掛率', () => {
    expect(ds.expectedPrice('000002', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 450,
      kind: 'special',
    });
    expect(ds.expectedPrice('000001', 'DB-1001', '2025-05-10')).toMatchObject({
      price: 554,
      kind: 'list_rate',
      ratePm: 720,
    });
    expect(ds.expectedPrice('000003', 'DB-1001', '2025-05-10')?.price).toBe(446);
    expect(ds.expectedPrice('999999', 'DB-1001', '2025-05-10')).toBeNull();
  });

  it('lists expired 特値', () => {
    expect(ds.validSpecial('000001', 'DB-1002', '2025-03-31')?.price).toBe(330);
    expect(ds.validSpecial('000001', 'DB-1002', '2025-04-01')).toBeNull();
    expect(ds.expiredSpecials('000001', 'DB-1002', '2025-04-01').map((s) => s.price)).toEqual([330]);
  });

  it('reads cost from history, falling back to the master', () => {
    expect(ds.costAt('DB-1001', '2025-03-31')).toBe(29323);
    expect(ds.costAt('DB-1001', '2025-04-01')).toBe(31141);
    expect(ds.costAt('KG-1001', '2025-04-01')).toBe(60000);
    expect(ds.costShareOf('KG-1001')).toEqual({ material: 45, labor: 30, energy: 12, other: 13 });
  });

  it('resolves codes written in any style', () => {
    expect(ds.resolveSku('ＤＢー１００１')).toBe('DB-1001');
    expect(ds.resolveSku('9999')).toBeNull();
  });
});

describe('data checks', () => {
  it('reports duplicate codes, ambiguous keys, unknown ranks and rates outside the rank', () => {
    const input = fixtureInput();
    const p = input.products[0];
    const c = input.customers[0];
    if (!p || !c) throw new Error('fixture');
    const ds = new Dataset({
      ...input,
      products: [...input.products, { ...p, code: 'DB1001', key: 'DB1001' }],
      customers: [
        ...input.customers,
        { ...c, code: '000009', rank: 'Z' },
        { ...c, code: '000010', ratePm: 900 },
      ],
    });
    const kinds = ds.issues.map((i) => i.kind);
    expect(kinds).toContain('ambiguous_key');
    expect(kinds).toContain('unknown_rank');
    expect(kinds).toContain('rate_outside_tier');
  });

  it('reports overlapping 特値 and unknown products in histories', () => {
    const input = fixtureInput();
    const ds = new Dataset({
      ...input,
      specials: [
        ...(input.specials ?? []),
        {
          cust: '000002',
          sku: null,
          skuKey: 'DB1001',
          rawSku: 'DB-1001',
          price: 440,
          start: '2025-06-01',
          end: null,
          reason: '',
        },
        {
          cust: '000002',
          sku: null,
          skuKey: 'XX1',
          rawSku: 'XX-1',
          price: 1,
          start: '2025-06-01',
          end: null,
          reason: '',
        },
      ],
      listPriceHistory: [
        ...(input.listPriceHistory ?? []),
        { sku: 'ZZ-1', price: 1, start: '2024-01-01', end: null },
      ],
    });
    const kinds = ds.issues.map((i) => i.kind);
    expect(kinds).toContain('overlapping_period');
    expect(kinds.filter((k) => k === 'unknown_product')).toHaveLength(2);
  });

  it('infers revision dates from the 定価 history', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ sku: `P${i}`, price: 100, start: '2024-04-01', end: '2025-03-31' });
      rows.push({ sku: `P${i}`, price: 110, start: '2025-04-01', end: null });
    }
    rows.push(
      { sku: 'Q', price: 100, start: '2024-04-01', end: '2025-07-31' },
      { sku: 'Q', price: 120, start: '2025-08-01', end: null },
    );
    expect(inferRevisionDates(rows)).toEqual(['2025-04-01']);
  });
});
