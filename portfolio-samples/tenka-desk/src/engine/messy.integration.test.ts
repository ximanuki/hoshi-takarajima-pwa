/**
 * The hand-written "messy" sample (scripts/messy-sample/, 架空): a Shift_JIS
 * sales export with Excel-style values, a sales file without 原単価, negated and
 * future 合意状況, a 定価 cut, billing above the rank, an unexplained difference,
 * a 7-digit customer code. It was written apart from the generator, line by line
 * with the expected label (truth.csv), to test what the generated sample cannot.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';
import { diagnose, type LineDiagnosis } from './diagnosis.ts';
import { loadWorkspace } from './workspace.ts';

const DIR = join(import.meta.dirname, '..', '..', 'scripts', 'messy-sample');
const FILES = [
  'customers.csv',
  'products.csv',
  'rate_tiers.csv',
  'categories.csv',
  'list_price_history.csv',
  'cost_history.csv',
  'agreements.csv',
  'sales_sjis.csv',
];

/** Engine result in the vocabulary of truth.csv. */
function messyLabel(d: LineDiagnosis): string {
  switch (d.status) {
    case 'leak':
      return `leak_${d.leak}`;
    case 'price_mismatch':
      return 'unexplained';
    case 'ok_kept_price':
      return 'ok_kept';
    case 'excluded_return':
      return 'ok_return';
    default:
      return d.status;
  }
}

describe('messy sample (架空)', () => {
  const ws = loadWorkspace(
    FILES.map((name) => ({ name, data: new Uint8Array(readFileSync(join(DIR, name))) })),
    { revisionDates: { 'agreements.csv': '2025-04-01' } },
  );
  const sales = ws.sales.get('sales_sjis.csv') ?? [];
  const result = diagnose(ws.dataset, sales);
  const [header = [], ...rows] = parseCsv(readFileSync(join(DIR, 'truth.csv'), 'utf8'));
  const truth = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

  it('reads every line of the Shift_JIS export without dropping a row', () => {
    const f = ws.files.find((x) => x.name === 'sales_sjis.csv');
    expect(f?.decoded.encoding).toBe('shift_jis');
    expect(ws.importIssues).toEqual([]);
    expect(sales).toHaveLength(truth.length);
    expect(sales.find((l) => l.id === '9005-1')?.remark).toBe('分納\r\n残りは来週');
  });

  it('labels every line as written in truth.csv', () => {
    const got = new Map(result.lines.map((d) => [d.line.id, messyLabel(d)]));
    for (const t of truth)
      expect(got.get(t['line_id'] ?? ''), `${t['line_id']}: ${t['why']}`).toBe(t['label']);
  });

  it('reports the agreement wording it had to interpret', () => {
    const notes = ws.dataset.issues
      .filter((i) => i.kind === 'interpreted_agreement_status')
      .map((i) => i.ref);
    expect(notes.sort()).toEqual(['100002', '100003', '100004', '100005']);
  });

  it('keeps overcharges out of the leak amounts', () => {
    expect(result.overcharges.lines).toBe(2);
    expect(result.findings.every((f) => f.shortfallTotalYen > 0)).toBe(true);
  });
});
