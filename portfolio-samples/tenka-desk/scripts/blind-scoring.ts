/**
 * Scoring helpers of blind-compare.ts that touch no files, so they can be tested
 * (src/app/blindScoring.test.ts): precision/recall counts and the 反映チェック
 * (follow-up check) score of each new price master.
 */

export type Row = Record<string, string>;

export interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}
export function prf(tp: number, fp: number, fn: number): Prf {
  const r = (x: number) => Math.round(x * 10000) / 10000;
  return {
    tp,
    fp,
    fn,
    precision: tp + fp > 0 ? r(tp / (tp + fp)) : null,
    recall: tp + fn > 0 ? r(tp / (tp + fn)) : null,
  };
}

export function inc(m: Record<string, number>, k: string, n = 1): void {
  m[k] = (m[k] ?? 0) + n;
}
export function sorted(m: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}
export const num = (s: string | undefined) => (s === undefined || s === '' ? 0 : Number(s));

/* ---------- 反映チェック ---------- */

export interface FollowupScore {
  lines: { truth: number; engine: number; joined: number; notImported: number };
  linesScored: number;
  linesAmbiguous: Record<string, { lines: number; engine: Record<string, number> }>;
  labelAgreementScored: { agree: number; of: number };
  stillOldPrice: Prf;
  yen: { truthStillOld: number; engineStillOld: number; truthOnTP: number; engineOnTP: number };
  pairsFlagged: { truth: number; engine: number; tp: number };
  customersFlagged: { truth: number; engine: number; tp: number };
  otherDiffLines: number;
  confusion: Record<string, Record<string, number>>;
  mismatchExamples: string[];
}

/**
 * The engine's 反映チェック for one new price master against the truth. Lines are
 * joined on the sales file and its data row; ambiguous truth lines are left out
 * of the scores and listed by pattern.
 */
export function scoreFollowupMaster(truthRows: Row[], engineRows: Row[]): FollowupScore {
  const byKey = new Map(engineRows.map((r) => [`${r['file']}|${r['data_row']}`, r]));
  const joined = truthRows.map((t) => ({ t, e: byKey.get(`${t['file']}|${t['row']}`) }));
  const scored = joined.filter((j) => j.t['label'] !== 'ambiguous');
  const ambiguous: FollowupScore['linesAmbiguous'] = {};
  for (const j of joined) {
    if (j.t['label'] !== 'ambiguous') continue;
    const p = j.t['pattern'] || '(no pattern)';
    const a = ambiguous[p] ?? { lines: 0, engine: {} };
    a.lines++;
    inc(a.engine, j.e?.['label'] ?? '(not imported)');
    ambiguous[p] = a;
  }
  const isOld = (l: string | undefined) => l === 'still_old_price';
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let agree = 0;
  const confusion: Record<string, Record<string, number>> = {};
  const examples: string[] = [];
  const yen = { truthStillOld: 0, engineStillOld: 0, truthOnTP: 0, engineOnTP: 0 };
  const pairOf = (j: { t: Row; e: Row | undefined }) =>
    `${j.e?.['cust'] || j.t['customer'] || ''}|${j.e?.['sku'] || j.t['product'] || ''}`;
  const custOf = (j: { t: Row; e: Row | undefined }) => j.e?.['cust'] || j.t['customer'] || '';
  const sets = {
    tPairs: new Set<string>(),
    ePairs: new Set<string>(),
    tCust: new Set<string>(),
    eCust: new Set<string>(),
  };
  for (const j of scored) {
    const truth = j.t['label'] ?? '';
    const engine = j.e?.['label'] ?? '(not imported)';
    const m = confusion[truth] ?? {};
    inc(m, engine);
    confusion[truth] = m;
    if (truth === engine) agree++;
    else if (examples.length < 20)
      examples.push(
        `${j.t['file']}:${j.t['row']} (${j.t['line_id']}) truth ${truth} expected ${j.t['expected'] ?? ''} -> engine ${engine} expected ${j.e?.['expected'] ?? ''} billed ${j.t['billed'] ?? ''}`,
      );
    const a = isOld(truth);
    const b = isOld(engine);
    if (a) {
      yen.truthStillOld += num(j.t['shortfall_yen']);
      sets.tPairs.add(pairOf(j));
      sets.tCust.add(custOf(j));
    }
    if (b) {
      sets.ePairs.add(pairOf(j));
      sets.eCust.add(custOf(j));
    }
    if (a && b) {
      tp++;
      yen.truthOnTP += num(j.t['shortfall_yen']);
      yen.engineOnTP += num(j.e?.['shortfall_yen']);
    } else if (b) fp++;
    else if (a) fn++;
  }
  yen.engineStillOld = engineRows
    .filter((r) => isOld(r['label']))
    .reduce((s, r) => s + num(r['shortfall_yen']), 0);
  const overlap = (x: Set<string>, y: Set<string>) => [...x].filter((k) => y.has(k)).length;
  return {
    lines: {
      truth: truthRows.length,
      engine: engineRows.length,
      joined: joined.filter((j) => j.e).length,
      notImported: joined.filter((j) => !j.e).length,
    },
    linesScored: scored.length,
    linesAmbiguous: ambiguous,
    labelAgreementScored: { agree, of: scored.length },
    stillOldPrice: prf(tp, fp, fn),
    yen,
    pairsFlagged: {
      truth: sets.tPairs.size,
      engine: sets.ePairs.size,
      tp: overlap(sets.tPairs, sets.ePairs),
    },
    customersFlagged: {
      truth: sets.tCust.size,
      engine: sets.eCust.size,
      tp: overlap(sets.tCust, sets.eCust),
    },
    otherDiffLines: engineRows.filter((r) => r['label'] === 'other_diff').length,
    confusion: Object.fromEntries(
      Object.entries(confusion)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => [k, sorted(v)]),
    ),
    mismatchExamples: examples,
  };
}

/** Every new price master of one engine-followup file, and the lines whose label differs between masters. */
export function scoreFollowup(truthRows: Row[], engineRows: Row[]) {
  const masters = [...new Set(engineRows.map((r) => r['master'] ?? ''))].sort();
  const byMaster: Record<string, FollowupScore> = {};
  for (const m of masters)
    byMaster[m] = scoreFollowupMaster(
      truthRows,
      engineRows.filter((r) => r['master'] === m),
    );
  const labelBy = masters.map(
    (m) =>
      new Map(
        engineRows.filter((r) => r['master'] === m).map((r) => [`${r['file']}|${r['data_row']}`, r['label']]),
      ),
  );
  const keys = new Set(labelBy.flatMap((x) => [...x.keys()]));
  const differences = [...keys].filter((k) => new Set(labelBy.map((x) => x.get(k) ?? '(missing)')).size > 1);
  return {
    scored: true,
    masters: byMaster,
    masterLayoutDifferences: { masters, lines: differences.length, examples: differences.slice(0, 20) },
  };
}
