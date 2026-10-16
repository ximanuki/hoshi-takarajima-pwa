/**
 * Evaluation of the leak detection and the 反映チェック against the generator's
 * ground truth (data-gen/truth/). The engine reads only the published sample
 * files (public/sample/); the truth files are read here, for scoring only.
 *
 *   npm run sample      # generate public/sample/ and data-gen/truth/
 *   npm run evaluate    # print the tables and write docs/evaluation-results.json
 *
 * The data and the detection rules come from the same project and the same
 * written rules, so the scores show that the engine is consistent with those
 * rules on synthetic data. They are not an estimate of accuracy on real data.
 * The "ablation" runs show how much the result depends on optional input files.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPriceMaster,
  checkFollowup,
  collectPairVolumes,
  type DiagnosisResult,
  defaultGuardrails,
  diagnose,
  type InputFile,
  importFile,
  LEAK_TYPES,
  type LeakType,
  type LineDiagnosis,
  loadWorkspace,
  ongoingBillingLeaks,
  outcomesFromAgreements,
  type PriceMasterRow,
  parseCsv,
  proposeListPrices,
  proposePairs,
  settingsFromJson,
  trailingMonths,
  type Workspace,
} from '../src/engine/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'public', 'sample');
const TRUTH = join(ROOT, 'data-gen', 'truth');

if (!existsSync(join(SAMPLE, 'customers.csv')) || !existsSync(join(TRUTH, 'lines.csv'))) {
  console.error(
    'サンプルデータがありません。先に `npm run sample`（cd data-gen && npm run gen）を実行してください。',
  );
  process.exit(1);
}

const file = (name: string): InputFile => ({ name, data: new Uint8Array(readFileSync(join(SAMPLE, name))) });
const AGREEMENTS = 'revision_2025-04_agreements.csv';
const MASTERS = [
  'customers.csv',
  'products.csv',
  'rate_tiers.csv',
  'categories.csv',
  'suppliers.csv',
  'list_price_history.csv',
  'cost_history.csv',
  'supplier_notices.csv',
];
const settings = settingsFromJson(JSON.parse(readFileSync(join(SAMPLE, 'demo_settings.json'), 'utf8')));

function run(
  layout: 'A' | 'B',
  opts: { agreements?: boolean; specials?: boolean } = {},
): { ws: Workspace; result: DiagnosisResult } {
  const names = [...MASTERS, `sales_${layout}_202410-202609.csv`];
  if (opts.agreements !== false) names.push(AGREEMENTS);
  if (opts.specials !== false) names.push(`special_prices_${layout}.csv`);
  const ws = loadWorkspace(names.map(file), { settings });
  const lines = ws.sales.get(`sales_${layout}_202410-202609.csv`);
  if (!lines) throw new Error('sales file not loaded');
  return { ws, result: diagnose(ws.dataset, lines) };
}

/* ---------- truth and scoring ---------- */

function readTruth(name: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(join(TRUTH, name), 'utf8'));
  const [header = [], ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const TRUTH_LABEL: Record<LeakType, string> = {
  old_price: 'leak_old_price',
  expired_special: 'leak_expired_special',
  rate_out_of_tier: 'leak_rate_out_of_tier',
  below_margin_floor: 'leak_below_margin_floor',
};

/** Engine status in the truth's vocabulary. */
function engineLabel(d: LineDiagnosis): string {
  switch (d.status) {
    case 'leak':
      return d.leak ? TRUTH_LABEL[d.leak] : 'unexplained';
    case 'price_mismatch':
      return 'unexplained';
    case 'ok_kept_price':
      return d.expected?.list.basis === 'kept_before_agreed_date' ? 'ok_deferred' : 'ok_declined';
    case 'excluded_return':
      return 'ok_return';
    case 'excluded_sample':
      return 'ok_sample';
    case 'excluded_non_product':
      return 'ok_non_product';
    default:
      return d.status;
  }
}

interface Prf {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
}

function prf(tp: number, fp: number, fn: number): Prf {
  return {
    tp,
    fp,
    fn,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
  };
}

const truthLines = readTruth('lines.csv');
const truthIssues = readTruth('issues.csv');
const isLeakLabel = (l: string) => l.startsWith('leak_') || l === 'unexplained';

interface Score {
  lineLevel: Record<string, Prf>;
  pairLevel: Record<string, Prf>;
  annualImpact: Record<string, { engineYen: number; truthYen: number }>;
  confusion: Record<string, number>;
  referencePriceAgreement: { compared: number; agree: number };
}

function score(result: DiagnosisResult): Score {
  const label = new Map(result.lines.map((d) => [d.line.id, engineLabel(d)]));
  const expected = new Map(result.lines.map((d) => [d.line.id, d.expected?.price ?? null]));
  const lineLevel: Record<string, Prf> = {};
  const counts = (pred: (t: string, e: string) => [boolean, boolean]) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const t of truthLines) {
      const [isT, isE] = pred(t['label'] ?? '', label.get(t['line_id'] ?? '') ?? '');
      if (isT && isE) tp++;
      else if (isE) fp++;
      else if (isT) fn++;
    }
    return prf(tp, fp, fn);
  };
  for (const type of LEAK_TYPES)
    lineLevel[type] = counts((t, e) => [t === TRUTH_LABEL[type], e === TRUTH_LABEL[type]]);
  lineLevel['any'] = counts((t, e) => [isLeakLabel(t), isLeakLabel(e)]);

  const pairLevel: Record<string, Prf> = {};
  const annualImpact: Record<string, { engineYen: number; truthYen: number }> = {};
  for (const type of LEAK_TYPES) {
    const truthPairs = new Map(
      truthIssues.filter((r) => r['type'] === TRUTH_LABEL[type]).map((r) => [`${r['cust']}|${r['sku']}`, r]),
    );
    const engPairs = new Set(result.findings.filter((f) => f.type === type).map((f) => `${f.cust}|${f.sku}`));
    let tp = 0;
    for (const k of engPairs) if (truthPairs.has(k)) tp++;
    pairLevel[type] = prf(tp, engPairs.size - tp, truthPairs.size - tp);
    annualImpact[type] = {
      engineYen: result.summary.find((s) => s.type === type)?.annualImpactYen ?? 0,
      truthYen: [...truthPairs.values()].reduce((s, r) => s + Number(r['shortfall_last12m_yen'] ?? 0), 0),
    };
  }
  const confusion = new Map<string, number>();
  let compared = 0;
  let agree = 0;
  for (const t of truthLines) {
    const id = t['line_id'] ?? '';
    const k = `${t['label']} -> ${label.get(id) ?? '(missing)'}`;
    confusion.set(k, (confusion.get(k) ?? 0) + 1);
    const e = expected.get(id);
    if (e !== null && e !== undefined && t['reference_kind'] !== 'none') {
      compared++;
      if (String(e) === t['reference']) agree++;
    }
  }
  return {
    lineLevel,
    pairLevel,
    annualImpact,
    confusion: Object.fromEntries([...confusion.entries()].sort()),
    referencePriceAgreement: { compared, agree },
  };
}

/* ---------- 1. leak detection ---------- */

const runA = run('A');
const runB = run('B');
const { result } = runA;
let layoutDiffs = 0;
const byIdB = new Map(runB.result.lines.map((d) => [d.line.id, d]));
for (const d of runA.result.lines) {
  const o = byIdB.get(d.line.id);
  if (!o || engineLabel(o) !== engineLabel(d) || o.shortfallYen !== d.shortfallYen) layoutDiffs++;
}
const main = score(result);

const summaryJson = JSON.parse(readFileSync(join(TRUTH, 'summary.json'), 'utf8')) as {
  wholeCustomerGroups: { group: string; cust: string; to: string | null }[];
};
const wholeCustomer = {
  flaggedByEngine: result.customers
    .filter((c) => c.wholeCustomer)
    .map((c) => ({ cust: c.cust, type: c.type, share: `${c.affectedPairs}/${c.eligiblePairs}` })),
  truthGroups: summaryJson.wholeCustomerGroups.map((g) => ({
    group: g.group,
    cust: g.cust,
    flagged: result.customers.some((c) => c.cust === g.cust && c.wholeCustomer),
  })),
};

/* ---------- 2. ablations: optional inputs left out ---------- */

const ablations = {
  withoutAgreements: score(run('A', { agreements: false }).result),
  withoutSpecials: score(run('A', { specials: false }).result),
};

/* ---------- 3. 反映チェック (2026-12) with the sample price master ---------- */

function followup(layout: 'A' | 'B') {
  const ws = loadWorkspace(
    [...MASTERS, `next/price_master_${layout}_20261201.csv`, `next/sales_${layout}_202612.csv`].map(file),
    { settings },
  );
  const master = ws.priceMasters.get(`next/price_master_${layout}_20261201.csv`) ?? [];
  const sales = ws.sales.get(`next/sales_${layout}_202612.csv`) ?? [];
  return checkFollowup(ws.dataset, master, sales);
}
const fuA = followup('A');
const fuB = followup('B');
const fuBById = new Map(fuB.lines.map((x) => [x.line.id, x.status]));
const followupLayoutDiffs = fuA.lines.filter((x) => fuBById.get(x.line.id) !== x.status).length;
const FOLLOW_TRUTH: Record<string, string> = {
  excluded_return: 'ok_return',
  excluded_sample: 'ok_sample',
  excluded_non_product: 'ok_non_product',
};
const truthFollow = new Map(readTruth('followup_lines.csv').map((r) => [r['line_id'] ?? '', r]));
let fTp = 0;
let fFp = 0;
let fFn = 0;
let followAgree = 0;
for (const x of fuA.lines) {
  const t = truthFollow.get(x.line.id);
  if (t && t['label'] === (FOLLOW_TRUTH[x.status] ?? x.status)) followAgree++;
  const isT = t?.['label'] === 'still_old_price';
  const isE = x.status === 'still_old_price';
  if (isT && isE) fTp++;
  else if (isE) fFp++;
  else if (isT) fFn++;
}
const truthFollowYen = [...truthFollow.values()]
  .filter((r) => r['label'] === 'still_old_price')
  .reduce((s, r) => s + Number(r['shortfall_yen'] ?? 0), 0);

/* ---------- 4. rebuild the sample price master from the published outcome files ---------- */

const outcomesImport = importFile(
  'next/revision_2026-12_outcomes.csv',
  readFileSync(join(SAMPLE, 'next/revision_2026-12_outcomes.csv')),
);
const newListImport = importFile(
  'next/list_prices_20261201.csv',
  readFileSync(join(SAMPLE, 'next/list_prices_20261201.csv')),
);
const sampleMasterImport = importFile(
  'next/price_master_B_20261201.csv',
  readFileSync(join(SAMPLE, 'next/price_master_B_20261201.csv')),
);
if (
  outcomesImport.data.kind !== 'agreements' ||
  newListImport.data.kind !== 'newListPrices' ||
  sampleMasterImport.data.kind !== 'priceMaster'
) {
  throw new Error('unexpected layout');
}
const ds = runA.ws.dataset;
const salesA = runA.ws.sales.get('sales_A_202410-202609.csv') ?? [];
const volumes = collectPairVolumes(salesA, trailingMonths(result.window.end, 12));
const proposalInput = {
  method: 'fixed_list' as const,
  newListPrices: newListImport.data.result.records,
  effectiveDate: '2026-12-01',
  asOf: '2026-11-30',
  ongoingLeaks: ongoingBillingLeaks(result),
};
const guard = { ...defaultGuardrails(ds), maxIncreaseBp: null };
const pairs = proposePairs(
  ds,
  volumes,
  proposeListPrices(ds, volumes, proposalInput, guard),
  proposalInput,
  guard,
);
const outcomes = outcomesFromAgreements(outcomesImport.data.result.records);
const sampleMaster = sampleMasterImport.data.result.records.map((r) => ({
  ...r,
  sku: ds.resolveSku(r.skuKey),
}));

function compareMaster(rows: PriceMasterRow[]) {
  const sampleByKey = new Map(sampleMaster.map((r) => [`${r.cust}|${r.sku}`, r]));
  const rebuiltByKey = new Map(rows.map((r) => [`${r.cust}|${r.sku}`, r]));
  let exact = 0;
  let differentPrice = 0;
  for (const [k, r] of rebuiltByKey) {
    const s = sampleByKey.get(k);
    if (!s) continue;
    if (s.newPrice === r.newPrice && s.currentPrice === r.currentPrice && s.effective === r.effective)
      exact++;
    else differentPrice++;
  }
  return {
    rows: rows.length,
    sameKeyExact: exact,
    sameKeyDifferent: differentPrice,
    onlyInRebuilt: [...rebuiltByKey.keys()].filter((k) => !sampleByKey.has(k)).length,
    onlyInSample: [...sampleByKey.keys()].filter((k) => !rebuiltByKey.has(k)).length,
  };
}
const priceMasterRebuild = {
  sampleRows: sampleMaster.length,
  currentPriceSystem: compareMaster(buildPriceMaster(pairs, outcomes, { currentPrice: 'system' })),
  currentPriceLastBilled: compareMaster(buildPriceMaster(pairs, outcomes, { currentPrice: 'last_billed' })),
  currentPriceExpected: compareMaster(buildPriceMaster(pairs, outcomes, { currentPrice: 'expected' })),
};

/* ---------- output ---------- */

const out = {
  note: 'scripts/evaluate.ts on the synthetic sample data (架空). The scores show consistency with the documented rules, not accuracy on real data.',
  window: result.window,
  lines: result.lines.length,
  layoutAvsB_lineDifferences: layoutDiffs,
  ...main,
  enginePairsByType: Object.fromEntries(result.summary.map((s) => [s.type, s.pairs])),
  wholeCustomer,
  ablations: Object.fromEntries(
    Object.entries(ablations).map(([k, v]) => [
      k,
      { lineLevel: v.lineLevel, pairLevel: v.pairLevel, annualImpact: v.annualImpact },
    ]),
  ),
  followup: {
    lines: fuA.lines.length,
    layoutAvsB_lineDifferences: followupLayoutDiffs,
    labelAgreement: { agree: followAgree, of: fuA.lines.length },
    stillOldPrice: prf(fTp, fFp, fFn),
    engineShortfallYen: fuA.stillOld.shortfallYen,
    truthShortfallYen: truthFollowYen,
    counts: fuA.counts,
  },
  priceMasterRebuild,
};

const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
const yen = (n: number) => n.toLocaleString('en-US');
const typeJa: Record<string, string> = {
  old_price: '反映漏れ',
  expired_special: '特値の期限切れ',
  rate_out_of_tier: '掛け率ランク外',
  below_margin_floor: '粗利下限割れ',
  any: '漏れ全体（種類を問わない）',
};

function printTable(title: string, s: Score) {
  console.log(`\n## ${title}\n`);
  console.log(
    '| 種類 | 行 適合率 | 行 再現率 | 行 TP/FP/FN | 組 適合率 | 組 再現率 | 組 TP/FP/FN | 年間影響額 engine | 年間影響額 正解 |',
  );
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const k of [...LEAK_TYPES, 'any']) {
    const l = s.lineLevel[k] as Prf;
    const p = s.pairLevel[k];
    const y = s.annualImpact[k];
    console.log(
      `| ${typeJa[k]} | ${pct(l.precision)} | ${pct(l.recall)} | ${l.tp}/${l.fp}/${l.fn} | ${p ? pct(p.precision) : '-'} | ${p ? pct(p.recall) : '-'} | ${p ? `${p.tp}/${p.fp}/${p.fn}` : '-'} | ${y ? yen(y.engineYen) : '-'} | ${y ? yen(y.truthYen) : '-'} |`,
    );
  }
}

console.log(
  `# 漏れ検出の評価（架空データ ${yen(result.lines.length)}行、直近12か月 ${result.window.start}〜${result.window.end}）`,
);
printTable('すべての入力ファイルあり', main);
console.log(`\n- A形式とB形式の結果の差: ${layoutDiffs}行`);
console.log(
  `- 基準単価の一致: ${main.referencePriceAgreement.agree}/${main.referencePriceAgreement.compared}行`,
);
console.log(`- 得意先まるごと: ${JSON.stringify(wholeCustomer)}`);
printTable('合意状況ファイルなし（前回改定の合意を読み込まない）', ablations.withoutAgreements);
printTable('特値ファイルなし', ablations.withoutSpecials);
console.log(`\n# 反映チェック（2026年12月 ${fuA.lines.length}行、サンプルの新単価マスタを使用）\n`);
console.log(
  `- 旧単価のまま: 適合率 ${pct(out.followup.stillOldPrice.precision)} / 再現率 ${pct(out.followup.stillOldPrice.recall)}（TP ${fTp} / FP ${fFp} / FN ${fFn}）、不足額 engine ${yen(fuA.stillOld.shortfallYen)}円 / 正解 ${yen(truthFollowYen)}円`,
);
console.log(`- 全ラベルの一致: ${followAgree}/${fuA.lines.length}、A/B差 ${followupLayoutDiffs}行`);
console.log('\n# 新単価マスタの再現（協議結果と新定価表から）\n');
console.log(JSON.stringify(priceMasterRebuild, null, 2));

writeFileSync(join(ROOT, 'docs', 'evaluation-results.json'), `${JSON.stringify(out, null, 2)}\n`);
