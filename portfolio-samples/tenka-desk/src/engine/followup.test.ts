import { describe, expect, it } from 'vitest';
import { checkFollowup } from './followup.ts';
import { fixtureDataset, line } from './testing/fixtures.ts';
import type { PriceMasterRow } from './types.ts';

const ds = fixtureDataset();
const row = (
  cust: string,
  sku: string,
  effective: string,
  newPrice: number,
  currentPrice: number,
): PriceMasterRow => ({
  cust,
  sku,
  skuKey: sku.replace('-', ''),
  rawSku: sku,
  effective,
  newPrice,
  currentPrice,
});
const master = [
  row('000001', 'DB-1001', '2026-12-01', 612, 554),
  row('000004', 'DB-1001', '2027-01-01', 595, 539),
];

describe('checkFollowup', () => {
  const lines = [
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-12-05', unitPrice: 612 }),
    line({ cust: '000001', rawSku: 'ＤＢ－１００１', date: '2026-12-06', unitPrice: 554, qty: 7 }),
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-11-30', unitPrice: 554 }),
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-12-07', unitPrice: 593, remark: '数量値引3%' }),
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-12-08', unitPrice: 600, qty: 2 }),
    line({ cust: '000004', rawSku: 'DB-1001', date: '2026-12-10', unitPrice: 539 }),
    line({ cust: '000004', rawSku: 'DB-1001', date: '2027-01-05', unitPrice: 539, qty: 3 }),
    line({ cust: '000003', rawSku: 'DB-1001', date: '2026-12-10', unitPrice: 446 }),
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-12-10', unitPrice: 612, qty: -1, isReturn: true }),
    line({ cust: '000001', rawSku: 'DB-1001', date: '2026-12-10', unitPrice: 0, remark: 'サンプル(無償)' }),
    line({ cust: '000001', rawSku: '9999', date: '2026-12-10', unitPrice: 1500 }),
  ];
  const r = checkFollowup(ds, master, lines);

  it('labels every line', () => {
    expect(r.lines.map((x) => x.status)).toEqual([
      'ok_new_price',
      'still_old_price',
      'ok_before_effective',
      'ok_volume_discount',
      'other_diff',
      'ok_before_effective',
      'still_old_price',
      'not_in_master',
      'excluded_return',
      'excluded_sample',
      'excluded_non_product',
    ]);
  });

  it('adds up what is still billed at the old price', () => {
    expect(r.stillOld).toEqual({ lines: 2, pairs: 2, customers: 2, shortfallYen: 58 * 7 + 56 * 3 });
    expect(r.byCustomer.map((c) => [c.cust, c.lines, c.shortfallYen, c.firstDate])).toEqual([
      ['000001', 1, 406, '2026-12-06'],
      ['000004', 1, 168, '2027-01-05'],
    ]);
    expect(r.counts.other_diff).toBe(1);
    expect(r.lines[1]?.explanation).toContain('旧単価 554円 のまま');
  });

  it('follows several effective dates for one pair', () => {
    const two = [...master, row('000001', 'DB-1001', '2027-04-01', 650, 612)];
    const res = checkFollowup(ds, two, [
      line({ cust: '000001', rawSku: 'DB-1001', date: '2027-04-02', unitPrice: 612 }),
      line({ cust: '000001', rawSku: 'DB-1001', date: '2027-04-03', unitPrice: 554 }),
      line({ cust: '000001', rawSku: 'DB-1001', date: '2027-03-31', unitPrice: 612 }),
    ]);
    expect(res.lines.map((x) => [x.status, x.expected])).toEqual([
      ['still_old_price', 650],
      ['still_old_price', 650],
      ['ok_new_price', 612],
    ]);
  });
});
