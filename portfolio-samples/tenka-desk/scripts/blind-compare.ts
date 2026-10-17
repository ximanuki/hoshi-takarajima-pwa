/**
 * Reveal step of the blind evaluation: compare the engine's labels written by
 * scripts/blind-score.ts with the sealed ground truth of each generator.
 *
 *   node scripts/blind-compare.ts --out blind \
 *     --dataset gen-1 <data-dir> <sealed-dir> [--dataset gen-2 <data-dir> <sealed-dir>]...
 *
 * For each dataset the truth files are checked against blind/<gen>/SEALED.sha256
 * before they are read; a file that does not match stops the run. Each run of
 * blind-score.ts found in <data-dir> is scored: engine-labels.csv (the app
 * default) and any engine-labels.<tag>.csv. When the sealed truth has
 * truth/followup_lines.csv (a dataset with a next/ folder), the 反映チェック is
 * scored too, from engine-followup(.<tag>).csv, per new price master. Writes
 * <out>/results.json and <out>/mismatches.csv.
 *
 * Lines the truth labels "ambiguous" (the documents allow two readings) are left
 * out of precision and recall and reported per pattern instead.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, toCsv } from '../src/engine/index.ts';
import {
  type FollowupScore,
  inc,
  num,
  type Prf,
  prf,
  type Row,
  scoreFollowup,
  sorted,
} from './blind-scoring.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
let outDir = join(ROOT, 'blind');
const datasets: { gen: string; dataDir: string; sealedDir: string }[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] ?? '';
  if (a === '--out') outDir = argv[++i] ?? outDir;
  else if (a === '--dataset') {
    const gen = argv[++i] ?? '';
    const dataDir = argv[++i] ?? '';
    const sealedDir = argv[++i] ?? '';
    if (!gen || !dataDir || !sealedDir) throw new Error('--dataset expects <gen> <data-dir> <sealed-dir>');
    datasets.push({ gen, dataDir, sealedDir });
  } else throw new Error(`unexpected argument: ${a}`);
}
if (datasets.length === 0) {
  console.error(
    'usage: node scripts/blind-compare.ts [--out <dir>] --dataset <gen> <data-dir> <sealed-dir> ...',
  );
  process.exit(1);
}

/* ---------- helpers ---------- */

function readCsv(path: string): Row[] {
  const [header = [], ...body] = parseCsv(readFileSync(path, 'utf8'));
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function verifySealed(gen: string, sealedDir: string): { file: string; sha256: string; ok: boolean }[] {
  const listPath = join(ROOT, 'blind', gen, 'SEALED.sha256');
  const out: { file: string; sha256: string; ok: boolean }[] = [];
  for (const line of readFileSync(listPath, 'utf8').split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!m) continue;
    const want = m[1] ?? '';
    const file = m[2] ?? '';
    const p = join(sealedDir, file);
    const got = existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : '';
    out.push({ file, sha256: got, ok: got === want });
  }
  const bad = out.filter((x) => !x.ok);
  if (out.length === 0 || bad.length > 0)
    throw new Error(
      `${gen}: sealed truth does not match SEALED.sha256: ${bad.map((b) => b.file).join(', ')}`,
    );
  return out;
}

const LEAKS = [
  'leak_old_price',
  'leak_expired_special',
  'leak_rate_out_of_tier',
  'leak_below_margin_floor',
] as const;
const CLASSES = [...LEAKS, 'unexplained'] as const;
const isLeak = (l: string) => (LEAKS as readonly string[]).includes(l);
const isFlag = (l: string) => isLeak(l) || l === 'unexplained';

/** Truth labels in one vocabulary (gen-1 names step 8 unexplained_price_diff). */
function truthNorm(label: string): string {
  return label === 'unexplained_price_diff' ? 'unexplained' : label;
}

/** Engine labels in the truth's vocabulary (both generators file kept categories under ok_declined). */
function engineNorm(label: string): string {
  switch (label) {
    case 'ok_kept_excluded_category':
    case 'ok_negotiating':
      return 'ok_declined';
    case 'excluded_unknown_customer':
    case 'excluded_no_list_price':
      return 'excluded';
    default:
      return label;
  }
}

/* ---------- scoring one run ---------- */

interface Joined {
  file: string;
  row: string;
  t: Row;
  e: Row | undefined;
  truth: string;
  engine: string;
  /** pattern of an ambiguous line (or the embedded cause, gen-2) */
  pattern: string;
  ambiguous: boolean;
  readingA: string;
  readingB: string;
}

interface MismatchOut {
  dataset: string;
  run: string;
  j: Joined;
  cluster: string;
}

const mismatches: MismatchOut[] = [];

function scoreRun(gen: string, run: string, truthRows: Row[], engineRows: Row[], issues: unknown) {
  const engineByKey = new Map(engineRows.map((r) => [`${r['file']}|${r['data_row']}`, r]));
  const joined: Joined[] = truthRows.map((t) => {
    const file = t['file'] ?? '';
    const row = t['row'] ?? '';
    const e = engineByKey.get(`${file}|${row}`);
    const amb = t['ambiguity'] ?? '';
    const pat = t['pattern'] ?? '';
    const ambiguous = t['label'] === 'ambiguous';
    const parts = amb.split('|');
    return {
      file,
      row,
      t,
      e,
      truth: truthNorm(t['label'] ?? ''),
      engine: e ? engineNorm(e['label'] ?? '') : '(not imported)',
      pattern: ambiguous ? parts[0] || pat : pat,
      ambiguous,
      readingA: truthNorm((parts[1] ?? '').replace(/^A=/, '')),
      readingB: truthNorm((parts[2] ?? '').replace(/^B=/, '')),
    };
  });
  const idMismatch = joined.filter((j) => j.e && j.e['line_id'] !== j.t['line_id']).length;
  const notImported = joined.filter((j) => !j.e).length;
  const scored = joined.filter((j) => !j.ambiguous);

  // line level
  const lineLevel: Record<string, Prf> = {};
  const count = (isT: (j: Joined) => boolean, isE: (j: Joined) => boolean) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const j of scored) {
      const a = isT(j);
      const b = isE(j);
      if (a && b) tp++;
      else if (b) fp++;
      else if (a) fn++;
    }
    return prf(tp, fp, fn);
  };
  for (const c of CLASSES)
    lineLevel[c] = count(
      (j) => j.truth === c,
      (j) => j.engine === c,
    );
  lineLevel['any_leak_type_ignored'] = count(
    (j) => isLeak(j.truth),
    (j) => isLeak(j.engine),
  );
  lineLevel['any_flag_incl_unexplained'] = count(
    (j) => isFlag(j.truth),
    (j) => isFlag(j.engine),
  );

  // pair level (customer × product); the pair of a line is taken from the engine's resolved codes
  const pairOf = (j: Joined) =>
    `${j.e?.['cust'] || j.t['customer_code'] || j.t['customer'] || ''}|${j.e?.['sku'] || j.t['product_code'] || j.t['product'] || ''}`;
  const pairLevel: Record<string, Prf> = {};
  for (const c of [...CLASSES, 'any_leak_type_ignored']) {
    const want = (l: string) => (c === 'any_leak_type_ignored' ? isLeak(l) : l === c);
    const tPairs = new Set(scored.filter((j) => want(j.truth)).map(pairOf));
    const ePairs = new Set(scored.filter((j) => want(j.engine)).map(pairOf));
    let tp = 0;
    for (const p of ePairs) if (tPairs.has(p)) tp++;
    pairLevel[c] = prf(tp, ePairs.size - tp, tPairs.size - tp);
  }

  // yen
  const engineSummary = (
    issues as { summary?: { type: string; annualImpactYen: number; shortfallTotalYen: number }[] }
  ).summary;
  const yen: Record<string, unknown> = {};
  for (const c of CLASSES) {
    const tLines = scored.filter((j) => j.truth === c);
    const eLines = joined.filter((j) => j.engine === c);
    const tIn = tLines.filter((j) => j.t['last12m'] === '1');
    const eIn = eLines.filter((j) => j.e?.['in_window'] === '1');
    const tp = tIn.filter((j) => j.engine === c);
    const app = engineSummary?.find((s) => `leak_${s.type}` === c);
    yen[c] = {
      truthLast12m: tIn.reduce((s, j) => s + num(j.t['shortfall_yen']), 0),
      truthLast12mPositiveOnly: tIn.reduce((s, j) => s + Math.max(0, num(j.t['shortfall_yen'])), 0),
      truthAllPeriod: tLines.reduce((s, j) => s + num(j.t['shortfall_yen']), 0),
      engineAppFigureLast12m: app ? app.annualImpactYen : null,
      engineLast12m: eIn.reduce((s, j) => s + num(j.e?.['shortfall_yen']), 0),
      engineLast12mOnTruthAmbiguousLines: eIn
        .filter((j) => j.ambiguous)
        .reduce((s, j) => s + num(j.e?.['shortfall_yen']), 0),
      engineAllPeriod: eLines.reduce((s, j) => s + num(j.e?.['shortfall_yen']), 0),
      truePositiveLinesLast12m: {
        lines: tp.length,
        truthYen: tp.reduce((s, j) => s + num(j.t['shortfall_yen']), 0),
        engineYen: tp.reduce((s, j) => s + num(j.e?.['shortfall_yen']), 0),
        linesWithSameShortfall: tp.filter((j) => num(j.t['shortfall_yen']) === num(j.e?.['shortfall_yen']))
          .length,
      },
    };
  }

  // confusion
  const confusion: Record<string, Record<string, number>> = {};
  for (const j of joined) {
    const k = j.ambiguous ? `ambiguous:${j.pattern}` : j.truth;
    const m = confusion[k] ?? {};
    inc(m, j.engine);
    confusion[k] = m;
  }
  const confusionSorted = Object.fromEntries(
    Object.entries(confusion)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => [k, sorted(v)]),
  );
  const leakConfusion: Record<string, number> = {};
  for (const j of scored)
    if (isFlag(j.truth) || isFlag(j.engine))
      if (j.truth !== j.engine) inc(leakConfusion, `${j.truth} -> ${j.engine}`);

  // non-leak reasons (decoys): how each truth ok_* label was labelled
  const decoys: Record<
    string,
    { lines: number; sameLabel: number; flaggedAsLeak: number; engine: Record<string, number> }
  > = {};
  for (const j of scored) {
    if (isFlag(j.truth)) continue;
    const d = decoys[j.truth] ?? { lines: 0, sameLabel: 0, flaggedAsLeak: 0, engine: {} };
    d.lines++;
    if (j.engine === j.truth) d.sameLabel++;
    if (isFlag(j.engine)) d.flaggedAsLeak++;
    inc(d.engine, j.engine);
    decoys[j.truth] = d;
  }
  for (const d of Object.values(decoys)) d.engine = sorted(d.engine);

  // embedded causes (gen-2 marks every leak line with its cause)
  const byPattern: Record<string, { truthLabel: Record<string, number>; engine: Record<string, number> }> =
    {};
  for (const j of scored) {
    if (!j.pattern) continue;
    const p = byPattern[j.pattern] ?? { truthLabel: {}, engine: {} };
    inc(p.truthLabel, j.truth);
    inc(p.engine, j.engine);
    byPattern[j.pattern] = p;
  }

  // ambiguous lines
  const ambiguous: Record<string, unknown> = {};
  const ambLines = joined.filter((j) => j.ambiguous);
  for (const pat of [...new Set(ambLines.map((j) => j.pattern))].sort()) {
    const ls = ambLines.filter((j) => j.pattern === pat);
    const engine: Record<string, number> = {};
    for (const j of ls) inc(engine, j.engine);
    const hasReadings = ls.some((j) => j.readingA || j.readingB);
    const asA = ls.filter((j) => j.readingA && j.engine === engineNorm(j.readingA)).length;
    const asB = ls.filter((j) => j.readingB && j.engine === engineNorm(j.readingB)).length;
    ambiguous[pat] = {
      lines: ls.length,
      engine: sorted(engine),
      ...(hasReadings
        ? {
            readingA: ls[0]?.readingA,
            readingB: ls[0]?.readingB,
            engineMatchesA: asA,
            engineMatchesB: asB,
            engineMatchesNeither: ls.filter(
              (j) => j.engine !== engineNorm(j.readingA) && j.engine !== engineNorm(j.readingB),
            ).length,
          }
        : {}),
      engineYenLast12m: ls
        .filter((j) => j.e?.['in_window'] === '1')
        .reduce((s, j) => s + num(j.e?.['shortfall_yen']), 0),
    };
  }

  // reference price agreement (the price the line should have been billed at)
  let compared = 0;
  let agree = 0;
  for (const j of scored) {
    const tr = j.t['reference'] ?? '';
    const er = j.e?.['expected_price'] ?? '';
    if (tr === '' || er === '') continue;
    compared++;
    if (Number(tr) === Number(er)) agree++;
  }

  // mismatches
  let mismatchCount = 0;
  for (const j of joined) {
    // ambiguous lines are always listed (scored = 0), also when they match one documented reading
    if (!j.ambiguous && j.truth === j.engine) continue;
    if (!j.ambiguous) mismatchCount++;
    mismatches.push({ dataset: gen, run, j, cluster: clusterOf(j) });
  }

  const engineCounts: Record<string, number> = {};
  for (const j of joined) inc(engineCounts, j.engine);
  const truthCounts: Record<string, number> = {};
  for (const j of joined) inc(truthCounts, j.ambiguous ? 'ambiguous' : j.truth);

  const iss = issues as {
    sales?: unknown;
    revisionsAssigned?: unknown;
    workspaceNotes?: unknown;
    files?: {
      file: string;
      status: string;
      usedInDiagnosis: boolean;
      skippedRows: number;
      error: string | null;
    }[];
  };
  return {
    lines: { truth: truthRows.length, engine: engineRows.length, joined: joined.length - notImported },
    joinCheck: { notImported, lineIdDifferent: idMismatch },
    linesScored: scored.length,
    linesAmbiguous: ambLines.length,
    mismatchesScored: mismatchCount,
    labelAgreementScored: { agree: scored.length - mismatchCount, of: scored.length },
    importAndExclusion: {
      revisionsAssigned: iss.revisionsAssigned,
      workspaceNotes: iss.workspaceNotes,
      sales: iss.sales,
      filesNotUsed: (iss.files ?? [])
        .filter((f) => !f.usedInDiagnosis || f.status === 'unrecognised' || f.status === 'error')
        .map((f) => ({ file: f.file, status: f.status, error: f.error })),
      rowsSkippedInUsedFiles: (iss.files ?? [])
        .filter((f) => f.usedInDiagnosis)
        .reduce((s, f) => s + f.skippedRows, 0),
      engineExcluded: {
        unknownCustomer: joined.filter((j) => j.e?.['label'] === 'excluded_unknown_customer').length,
        noListPrice: joined.filter((j) => j.e?.['label'] === 'excluded_no_list_price').length,
        overchargeNotCountedAsLeak: joined.filter((j) => j.e?.['label'] === 'overcharge').length,
      },
    },
    labelCounts: { truth: sorted(truthCounts), engine: sorted(engineCounts) },
    lineLevel,
    pairLevel,
    yen,
    referencePriceAgreement: { compared, agree },
    leakConfusion: sorted(leakConfusion),
    decoys,
    embeddedCauses: Object.fromEntries(
      Object.entries(byPattern)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => [k, { truthLabel: sorted(v.truthLabel), engine: sorted(v.engine) }]),
    ),
    ambiguous,
    confusion: confusionSorted,
  };
}

/** A short cause for grouping mismatches: truth -> engine plus what explains the line. */
function clusterOf(j: Joined): string {
  const e = j.e;
  const why: string[] = [];
  if (j.ambiguous) why.push(`ambiguous:${j.pattern}`);
  else if (j.pattern) why.push(`cause:${j.pattern}`);
  if (e) {
    if (e['list_basis'] && e['list_basis'] !== 'current') why.push(`basis:${e['list_basis']}`);
    if (e['expected_kind'] === 'special') why.push('engine_ref:special');
    const tr = j.t['reference'] ?? '';
    if (tr !== '' && e['expected_price'] !== '' && Number(tr) !== Number(e['expected_price']))
      why.push('reference_differs');
  }
  return `${j.ambiguous ? 'ambiguous' : j.truth} -> ${j.engine}${why.length ? ` [${why.join(', ')}]` : ''}`;
}

/* ---------- run ---------- */

const results: Record<string, unknown> = {
  note: 'Blind evaluation of the tenka-desk engine on two independently generated fictional datasets. Engine labels were written by scripts/blind-score.ts before the truth was read; the truth hashes were checked against blind/<gen>/SEALED.sha256 first. Lines the truth marks ambiguous are excluded from precision/recall and reported per pattern.',
  runs: {
    default:
      'engine-labels.csv: the app with default settings: no 改定日 typed for the agreements file (the app may infer it from the data; see workspace.ts chooseRevision). Before the fix on branch tenka-desk-revision-fix the app did not infer it; those figures are in commit 20004cd.',
    revdate:
      'engine-labels.revdate.csv: the same, after typing the 改定日 of the agreements file on the import screen (from demo_settings.json previousRevisionDate / the README).',
    followup:
      'engine-followup(.tag).csv: the 反映チェック of each new price master in next/ against the sales export there, scored against truth/followup_lines.csv when the sealed truth has it.',
  },
  labelMapping: {
    truth: { unexplained_price_diff: 'unexplained' },
    engine: {
      ok_kept_excluded_category: 'ok_declined',
      ok_negotiating: 'ok_declined',
      excluded_unknown_customer: 'excluded',
      excluded_no_list_price: 'excluded',
      'price_mismatch (status)': 'unexplained',
      'overcharge (status)':
        'overcharge (kept: the engine never counts billing above the expected price as a leak)',
    },
  },
  datasets: {} as Record<string, unknown>,
};

for (const { gen, dataDir, sealedDir } of datasets) {
  const sealed = verifySealed(gen, sealedDir);
  const truthRows = readCsv(join(sealedDir, 'truth', 'lines.csv'));
  const runs: Record<string, unknown> = {};
  for (const name of readdirSync(dataDir).sort()) {
    const m = /^engine-labels(?:\.(.+))?\.csv$/.exec(name);
    if (!m) continue;
    const run = m[1] ?? 'default';
    const issuesPath = join(dataDir, m[1] ? `import-issues.${m[1]}.json` : 'import-issues.json');
    const issues = existsSync(issuesPath) ? (JSON.parse(readFileSync(issuesPath, 'utf8')) as unknown) : {};
    runs[run] = scoreRun(gen, run, truthRows, readCsv(join(dataDir, name)), issues);
  }
  // the 反映チェック truth is read only when the sealed list has it (and so its hash was checked above)
  const followupTruth = sealed.some((x) => x.file === 'truth/followup_lines.csv')
    ? readCsv(join(sealedDir, 'truth', 'followup_lines.csv'))
    : null;
  let followup: Record<string, unknown> = {
    scored: false,
    reason: '反映チェックの正解がありません（next/ がありません）',
  };
  if (followupTruth) {
    followup = {};
    for (const name of readdirSync(dataDir).sort()) {
      const m = /^engine-followup(?:\.(.+))?\.csv$/.exec(name);
      if (m) followup[m[1] ?? 'default'] = scoreFollowup(followupTruth, readCsv(join(dataDir, name)));
    }
    if (Object.keys(followup).length === 0)
      followup = {
        scored: false,
        reason: 'engine-followup.csv がありません（blind-score.ts を実行してください）',
      };
  }
  (results['datasets'] as Record<string, unknown>)[gen] = { sealedTruth: sealed, runs, followup };
}

/* ---------- mismatch clusters ---------- */

const clusters: Record<string, Record<string, { lines: number; scored: boolean; examples: string[] }>> = {};
for (const m of mismatches) {
  const key = `${m.dataset}/${m.run}`;
  const byCluster = clusters[key] ?? {};
  const c = byCluster[m.cluster] ?? { lines: 0, scored: !m.j.ambiguous, examples: [] };
  c.lines++;
  if (c.examples.length < 3) c.examples.push(`${m.j.file}:${m.j.row} (${m.j.t['line_id']})`);
  byCluster[m.cluster] = c;
  clusters[key] = byCluster;
}
results['mismatchClusters'] = Object.fromEntries(
  Object.entries(clusters).map(([k, v]) => [
    k,
    Object.entries(v)
      .sort((a, b) => b[1].lines - a[1].lines || (a[0] < b[0] ? -1 : 1))
      .map(([cluster, c]) => ({ cluster, ...c })),
  ]),
);

writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

const HEADER = [
  'dataset',
  'run',
  'file',
  'row',
  'line_id',
  'truth_label',
  'engine_label',
  'scored',
  'ambiguity_or_cause',
  'cluster',
  'date',
  'cust',
  'sku',
  'qty',
  'billed',
  'truth_reference',
  'engine_expected',
  'truth_shortfall_yen',
  'engine_shortfall_yen',
  'engine_status',
  'engine_flags',
  'engine_list_basis',
  'remark',
];
const rows = mismatches.map(({ dataset, run, j, cluster }) => [
  dataset,
  run,
  j.file,
  j.row,
  j.t['line_id'] ?? '',
  j.ambiguous ? 'ambiguous' : (j.t['label'] ?? ''),
  j.e?.['label'] ?? '(not imported)',
  j.ambiguous ? 0 : 1,
  j.ambiguous ? `${j.pattern}${j.readingA ? `|A=${j.readingA}|B=${j.readingB}` : ''}` : j.pattern,
  cluster,
  j.t['date'] ?? '',
  j.e?.['cust'] ?? j.t['customer_code'] ?? j.t['customer'] ?? '',
  j.e?.['sku'] || j.e?.['raw_sku'] || j.t['product_code'] || j.t['product'] || '',
  j.e?.['qty'] ?? j.t['qty'] ?? '',
  j.e?.['unit_price'] ?? j.t['billed'] ?? '',
  j.t['reference'] ?? '',
  j.e?.['expected_price'] ?? '',
  j.t['shortfall_yen'] ?? '',
  j.e?.['shortfall_yen'] ?? '',
  j.e?.['status'] ?? '',
  j.e?.['flags'] ?? '',
  j.e?.['list_basis'] ?? '',
  j.e?.['remark'] ?? '',
]);
writeFileSync(join(outDir, 'mismatches.csv'), toCsv(HEADER, rows, { bom: true, eol: '\n', quoteAll: false }));

for (const [gen, d] of Object.entries(
  results['datasets'] as Record<string, { runs: Record<string, unknown>; followup: Record<string, unknown> }>,
)) {
  for (const [run, f] of Object.entries(d.followup)) {
    const masters = (f as { masters?: Record<string, FollowupScore> }).masters;
    for (const [master, x] of Object.entries(masters ?? {})) {
      const o = x.stillOldPrice;
      console.log(
        `${gen} followup/${run} ${master}: still_old_price P ${o.precision ?? '-'} R ${o.recall ?? '-'} (${o.tp}/${o.fp}/${o.fn}) yen engine ${x.yen.engineStillOld} truth ${x.yen.truthStillOld}, labels ${x.labelAgreementScored.agree}/${x.labelAgreementScored.of}`,
      );
    }
  }
  for (const [run, r] of Object.entries(d.runs)) {
    const s = r as {
      lineLevel: Record<string, Prf>;
      pairLevel: Record<string, Prf>;
      mismatchesScored: number;
    };
    console.log(`\n## ${gen} / ${run}  (mismatches on scored lines: ${s.mismatchesScored})`);
    for (const c of [...CLASSES, 'any_leak_type_ignored']) {
      const l = s.lineLevel[c];
      const p = s.pairLevel[c];
      if (!l) continue;
      console.log(
        `${c.padEnd(26)} line P ${l.precision ?? '-'} R ${l.recall ?? '-'} (${l.tp}/${l.fp}/${l.fn})  pair P ${p?.precision ?? '-'} R ${p?.recall ?? '-'} (${p?.tp}/${p?.fp}/${p?.fn})`,
      );
    }
  }
}
console.log(
  `\nwrote ${join(outDir, 'results.json')} and ${join(outDir, 'mismatches.csv')} (${rows.length} rows)`,
);
