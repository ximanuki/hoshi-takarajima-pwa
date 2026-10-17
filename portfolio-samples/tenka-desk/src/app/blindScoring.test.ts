/**
 * The 反映チェック (follow-up check) score of scripts/blind-compare.ts, on a few
 * hand-made lines: a hit, a false alarm, a miss, an ambiguous line, a line the
 * engine did not read, and two new price masters that disagree. All data is fictional (架空).
 */

import { describe, expect, it } from 'vitest';
import { type Row, scoreFollowup } from '../../scripts/blind-scoring.ts';

const truth = (row: string, label: string, extra: Partial<Row> = {}): Row => ({
  file: 'sales.csv',
  row,
  line_id: `L${row}`,
  label,
  pattern: '',
  expected: '',
  billed: '',
  shortfall_yen: '0',
  customer: 'C1',
  product: `P${row}`,
  ...extra,
});
const engine = (master: string, row: string, label: string, shortfall = '0'): Row => ({
  master,
  file: 'sales.csv',
  data_row: row,
  label,
  cust: row === '4' ? 'C2' : 'C1',
  sku: `P${row}`,
  expected: '',
  shortfall_yen: shortfall,
});

const TRUTH = [
  truth('2', 'still_old_price', { shortfall_yen: '100' }), // hit in both masters
  truth('3', 'ok_new_price'), // false alarm in A
  truth('4', 'still_old_price', { shortfall_yen: '30', customer: 'C2' }), // missed (A), not read (B)
  truth('5', 'ambiguous', { pattern: '値引の読み方' }),
];
const ENGINE = [
  engine('A', '2', 'still_old_price', '100'),
  engine('A', '3', 'still_old_price', '50'),
  engine('A', '4', 'ok_new_price'),
  engine('A', '5', 'still_old_price', '20'),
  engine('B', '2', 'still_old_price', '100'),
  engine('B', '3', 'ok_new_price'),
  engine('B', '5', 'ok_new_price'),
];

describe('blind-compare: 反映チェック scoring', () => {
  const out = scoreFollowup(TRUTH, ENGINE);
  const a = out.masters['A'];
  const b = out.masters['B'];

  it('counts hits, false alarms and misses of still_old_price per master, leaving ambiguous lines out', () => {
    expect(Object.keys(out.masters)).toEqual(['A', 'B']);
    expect(a?.stillOldPrice).toEqual({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5 });
    expect(a?.linesScored).toBe(3);
    expect(a?.labelAgreementScored).toEqual({ agree: 1, of: 3 });
    expect(a?.linesAmbiguous).toEqual({ 値引の読み方: { lines: 1, engine: { still_old_price: 1 } } });
    // the engine's yen counts every still_old_price row it wrote, the ambiguous one too
    expect(a?.yen).toEqual({ truthStillOld: 130, engineStillOld: 170, truthOnTP: 100, engineOnTP: 100 });
    expect(a?.pairsFlagged).toEqual({ truth: 2, engine: 2, tp: 1 });
    expect(a?.customersFlagged).toEqual({ truth: 2, engine: 1, tp: 1 });
  });

  it('counts a line the engine did not read as not imported, and as a miss', () => {
    expect(b?.lines).toEqual({ truth: 4, engine: 3, joined: 3, notImported: 1 });
    expect(b?.stillOldPrice).toEqual({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(b?.confusion['still_old_price']).toEqual({ still_old_price: 1, '(not imported)': 1 });
  });

  it('lists the lines whose label differs between the two masters', () => {
    expect(out.masterLayoutDifferences).toEqual({
      masters: ['A', 'B'],
      lines: 3,
      examples: ['sales.csv|3', 'sales.csv|4', 'sales.csv|5'],
    });
  });
});
