/**
 * Evaluation of the leak detection and the 反映チェック against the generator's
 * ground truth (data-gen/truth/). The engine reads only the published sample
 * files (public/sample/); the truth files are read here, for scoring only.
 *
 *   npm run sample      # generate public/sample/ and data-gen/truth/
 *   npm run evaluate    # print the tables and write docs/evaluation-results.json
 *
 * Both the data and the rules were written by the same project, so the scores
 * show that the engine is consistent with the documented rules on synthetic
 * data. They are not an estimate of accuracy on real company data.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
  outcomesFromAgreements,
  parseCsv,
  proposeListPrices,
  proposePairs,
  buildPriceMaster,
  settingsFromJson,
  trailingMonths,
  type Workspace,
} from '../src/engine/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'public', 'sample');
const TRUTH = join(ROOT, 'data-gen', 'truth');

if (!existsSync(join(SAMPLE, 'customers.csv')) || !existsSync(join(TRUTH, 'lines.csv'))) {
  console.error('サンプルデータがありません。先に `npm run sample`（cd data-gen && npm run gen）を実行してください。');
  process.exit(1);
}

const file = (name: string): InputFile => ({ name, data: new Uint8Array(readFileSync(join(SAMPLE, name))) });
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
const settings = settingsFromJson(JSON.parse(readFileSync(join(SAMPLE, 'demo_settings.json'), 'utf8')));

function load(layout: 'A' | 'B'): { ws: Workspace; result: DiagnosisResult } {
  const ws = loadWorkspace([...MASTERS.map(file), file(`special_prices_${layout}.csv`), file(`sales_${layout}_202410-202609.csv`)], {
    settings,
  });
  const lines = ws.sales.get(`sales_${layout}_202410-202609.csv`);
  if (!lines) throw new Error('sales file not loaded');
  return { ws, result: diagnose(ws.dataset, lines) };
}

/* ---------- truth ---------- */

function readTruth(name: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(join(TRUTH, name), 'utf8'));
  const [header = [], ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const TRUTH_LABEL: Record<LeakType, string> = {
  old_price: 'leak_old_price',
  expired_special: 'leak_expired_special',
  rate_out_of_tier: 'leak_rate_out_of_tier',
  below_margin_floor: 'leak_below_margin_floor',
};

function engineLabel(d: LineDiagnosis): string {
  switch (d.status) {
    case 'leak':
      return d.leak ? TRUTH_LABEL[d.leak] : 'unexplained';
    case 'price_mismatch':
      return 'unexplained';
    case 'ok':
      return 'ok';
    case 'ok_special':
      return 'ok_special';
    case 'ok_kept_price':
      return d.expected?.list.basis === 'kept_before_agreed_date' ? 'ok_deferred' : 'ok_declined';
    case 'ok_volume_discount':
      return 'ok_volume_discount';
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
  return { tp, fp, fn, precision: tp + fp > 0 ? tp / (tp + fp) : null, recall: tp + fn > 0 ? tp / (tp + fn) : null };
}

const pct = (x: number | null) => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
const yen = (n: number) => `${n.toLocaleString('en-US')}`;

/* ---------- 1. leak detection ---------- */

const runA = load('A');
const runB = load('B');

// The two layouts must give the same result line by line.
let layoutDiffs = 0;
const byIdB = new Map(runB.result.lines.map((d) => [d.line.id, d]));
for (const d of runA.result.lines) {
  const o = byIdB.get(d.line.id);
  if (!o || engineLabel(o) !== engineLabel(d) || o.shortfallYen !== d.shortfallYen) layoutDiffs++;
}

const truthLines = readTruth('lines.csv');
const truthById = new Map(truthLines.map((r) => [r['line_id'] ?? '', r]));
const { result } = runA;
const window = result.window;

const lineMetrics: Record<string, Prf> = {};
const pairMetrics: Record<string, Prf> = {};
const yenRows: Record<string, { engineYen: number; truthYen: number; enginePairs: number; truthPairs: number }> = {};
const confusion = new Map<string, number>();
let refCompared = 0;
let refAgree = 0;
let missingInTruth = 0;

const engineLineLabel = new Map<string, string>();
for (const d of result.lines) {
  const label = engineLabel(d);
  engineLineLabel.set(d.line.id, label);
  const t = truthById.get(d.line.id);
  if (!t) {
    missingInTruth++;
    continue;
  }
  const key = `${t['label']} -> ${label}`;
  confusion.set(key, (confusion.get(key) ?? 0) + 1);
  if (d.expected && t['reference_kind'] !== 'none') {
    refCompared++;
    if (String(d.expected.price) === t['reference']) refAgree++;
  }
}

for (const type of LEAK_TYPES) {
  const tl = TRUTH_LABEL[type];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const t of truthLines) {
    const e = engineLineLabel.get(t['line_id'] ?? '');
    const isT = t['label'] === tl;
    const isE = e === tl;
    if (isT && isE) tp++;
    else if (isE) fp++;
    else if (isT) fn++;
  }
  lineMetrics[type] = prf(tp, fp, fn);
}
{
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const t of truthLines) {
    const e = engineLineLabel.get(t['line_id'] ?? '') ?? '';
    const isT = (t['label'] ?? '').startsWith('leak_');
    const isE = e.startsWith('leak_') || e === 'unexplained';
    if (isT && isE) tp++;
    else if (isE) fp++;
    else if (isT) fn++;
  }
  lineMetrics['any'] = prf(tp, fp, fn);
}

const truthIssues = readTruth('issues.csv');
for (const type of LEAK_TYPES) {
  const tl = TRUTH_LABEL[type];
  const truthPairs = new Map(truthIssues.filter((r) => r['type'] === tl).map((r) => [`${r['cust']}|${r['sku']}`, r]));
  const engPairs = new Map(result.findings.filter((f) => f.type === type).map((f) => [`${f.cust}|${f.sku}`, f]));
  let tp = 0;
  for (const k of engPairs.keys()) if (truthPairs.has(k)) tp++;
  pairMetrics[type] = prf(tp, engPairs.size - tp, truthPairs.size - tp);
  yenRows[type] = {
    engineYen: result.summary.find((s) => s.type === type)?.annualImpactYen ?? 0,
    truthYen: [...truthPairs.values()].reduce((s, r) => s + Number(r['shortfall_last12m_yen'] ?? 0), 0),
    enginePairs: engPairs.size,
    truthPairs: truthPairs.size,
  };
}

const summaryJson = JSON.parse(readFileSync(join(TRUTH, 'summary.json'), 'utf8')) as {
  wholeCustomerGroups: { group: string; cust: string; to: string | null }[];
};
const wholeFlagged = result.customers.filter((c) => c.wholeCustomer).map((c) => `${c.cust}:${c.type}`);
const wholeTruth = summaryJson.wholeCustomerGroups.map((g) => ({
  group: g.group,
  cust: g.cust,
  flagged: result.customers.some((c) => c.cust === g.cust && c.wholeCustomer),
  share: result.customers
    .filter((c) => c.cust === g.cust)
    .map((c) => `${c.type} ${c.affectedPairs}/${c.eligiblePairs}`)
    .join(', '),
}));

/* ---------- 2. 反映チェック (2026-12) with the sample price master ---------- */

function followup(layout: 'A' | 'B') {
  const ws = loadWorkspace(
    [...MASTERS.map(file), file(`next/price_master_${layout}_20261201.csv`), file(`next/sales_${layout}_202612.csv`)],
    { settings },
  );
  const master = ws.priceMasters.get(`next/price_master_${layout}_20261201.csv`) ?? [];
  const sales = ws.sales.get(`next/sales_${layout}_202612.csv`) ?? [];
  return checkFollowup(ws.dataset, master, sales);
}
const fuA = followup('A');
const fuB = followup('B');
let followupLayoutDiffs = 0;
const fuB_byId = new Map(fuB.lines.map((x) => [x.line.id, x.status]));
for (const x of fuA.lines) if (fuB_byId.get(x.line.id) !== x.status) followupLayoutDiffs++;

const FOLLOW_TRUTH: Record<string, string> = {
  ok_new_price: 'ok_new_price',
  ok_before_effective: 'ok_before_effective',
  ok_volume_discount: 'ok_volume_discount',
  still_old_price: 'still_old_price',
  other_diff: 'other_diff',
  not_in_master: 'not_in_master',
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
  const e = FOLLOW_TRUTH[x.status];
  if (t && t['label'] === e) followAgree++;
  const isT = t?.['label'] === 'still_old_price';
  const isE = x.status === 'still_old_price';
  if (isT && isE) fTp++;
  else if (isE) fFp++;
  else if (isT) fFn++;
}
const followupMetrics = prf(fTp, fFp, fFn);
const truthFollowYen = [...truthFollow.values()]
  .filter((r) => r['label'] === 'still_old_price')
  .reduce((s, r) => s + Number(r['shortfall_yen'] ?? 0), 0);

/* ---------- 3. price master: rebuild the sample master from the published outcome files ---------- */

const outcomesImport = importFile('next/revision_2026-12_outcomes.csv', readFileSync(join(SAMPLE, 'next/revision_2026-12_outcomes.csv')));
const newListImport = importFile('next/list_prices_20261201.csv', readFileSync(join(SAMPLE, 'next/list_prices_20261201.csv')));
if (outcomesImport.data.kind !== 'agreements' || newListImport.data.kind !== 'newListPrices') throw new Error('unexpected layout');
const ds = runA.ws.dataset;
const salesA = runA.ws.sales.get('sales_A_202410-202609.csv') ?? [];
const volumes = collectPairVolumes(salesA, trailingMonths('2026-09-30', 12));
const proposalInput = {
  method: 'fixed_list' as const,
  newListPrices: newListImport.data.result.records,
  effectiveDate: '2026-12-01',
  asOf: '2026-11-30',
};
const guard = { ...defaultGuardrails(ds), maxIncreaseBp: null };
const lists = proposeListPrices(ds, volumes, proposalInput, guard);
const pairs = proposePairs(ds, volumes, lists, proposalInput, guard);
const rebuilt = buildPriceMaster(pairs, outcomesFromAgreements(outcomesImport.data.result.records));
const sampleMasterImport = importFile(
  'next/price_master_B_20261201.csv',
  readFileSync(join(SAMPLE, 'next/price_master_B_20261201.csv')),
);
if (sampleMasterImport.data.kind !== 'priceMaster') throw new Error('unexpected layout');
const sampleMaster = sampleMasterImport.data.result.records.map((r) => ({ ...r, sku: ds.resolveSku(r.skuKey) }));
const sampleByKey = new Map(sampleMaster.map((r) => [`${r.cust}|${r.sku}`, r]));
const rebuiltByKey = new Map(rebuilt.map((r) => [`${r.cust}|${r.sku}`, r]));
let masterExact = 0;
let masterPriceDiff = 0;
for (const [k, r] of rebuiltByKey) {
  const s = sampleByKey.get(k);
  if (!s) continue;
  if (s.newPrice === r.newPrice && s.currentPrice === r.currentPrice && s.effective === r.effective) masterExact++;
  else masterPriceDiff++;
}
const masterOnlyRebuilt = [...rebuiltByKey.keys()].filter((k) => !sampleByKey.has(k)).length;
const masterOnlySample = [...sampleByKey.keys()].filter((k) => !rebuiltByKey.has(k)).length;

/* ---------- output ---------- */

const out = {
  note: 'Generated by scripts/evaluate.ts on the synthetic sample data (架空). Scores show consistency with the documented rules, not accuracy on real data.',
  window,
  lines: result.lines.length,
  layoutAvsB_lineDifferences: layoutDiffs,
  linesNotInTruth: missingInTruth,
  referencePriceAgreement: { compared: refCompared, agree: refAgree },
  lineLevel: lineMetrics,
  pairLevel: pairMetrics,
  annualImpact: yenRows,
  wholeCustomer: { flagged: wholeFlagged, truthGroups: wholeTruth },
  confusion: Object.fromEntries([...confusion.entries()].sort()),
  followup: {
    lines: fuA.lines.length,
    layoutAvsB_lineDifferences: followupLayoutDiffs,
    labelAgreement: { agree: followAgree, of: fuA.lines.length },
    stillOldPrice: followupMetrics,
    engineShortfallYen: fuA.stillOld.shortfallYen,
    truthShortfallYen: truthFollowYen,
    counts: fuA.counts,
  },
  priceMasterRebuild: {
    sampleRows: sampleMaster.length,
    rebuiltRows: rebuilt.length,
    sameKeyExact: masterExact,
    sameKeyDifferentPrice: masterPriceDiff,
    onlyInRebuilt: masterOnlyRebuilt,
    onlyInSample: masterOnlySample,
  },
};

const typeJa: Record<string, string> = {
  old_price: '反映漏れ',
  expired_special: '特値の期限切れ',
  rate_out_of_tier: '掛け率ランク外',
  below_margin_floor: '粗利下限割れ',
  any: '漏れ全体（種類を問わない）',
};

console.log(`# 漏れ検出の評価（架空データ・${result.lines.length.toLocaleString('en-US')}行・窓 ${window.start}〜${window.end}）\n`);
console.log('| 種類 | 行 P | 行 R | 行 TP/FP/FN | 組 P | 組 R | 組 TP/FP/FN | 年間影響額 engine | 年間影響額 truth |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const k of [...LEAK_TYPES, 'any']) {
  const l = lineMetrics[k] as Prf;
  const p = pairMetrics[k];
  const y = yenRows[k];
  console.log(
    `| ${typeJa[k]} | ${pct(l.precision)} | ${pct(l.recall)} | ${l.tp}/${l.fp}/${l.fn} | ${p ? pct(p.precision) : '-'} | ${p ? pct(p.recall) : '-'} | ${p ? `${p.tp}/${p.fp}/${p.fn}` : '-'} | ${y ? yen(y.engineYen) : '-'} | ${y ? yen(y.truthYen) : '-'} |`,
  );
}
console.log(`\n- A形式とB形式の結果の差: ${layoutDiffs}行`);
console.log(`- 基準単価の一致: ${refAgree}/${refCompared}行`);
console.log(`- 得意先まるごとの判定: ${JSON.stringify(wholeTruth)}`);
console.log(`- 混同（truth -> engine、件数）:`);
for (const [k, v] of Object.entries(out.confusion)) console.log(`  - ${k}: ${v}`);
console.log(`\n# 反映チェック（2026年12月・${fuA.lines.length}行）\n`);
console.log(
  `- 旧単価のまま: P ${pct(followupMetrics.precision)} / R ${pct(followupMetrics.recall)}（TP ${fTp} / FP ${fFp} / FN ${fFn}）、不足額 engine ${yen(fuA.stillOld.shortfallYen)}円 / truth ${yen(truthFollowYen)}円`,
);
console.log(`- 全ラベルの一致: ${followAgree}/${fuA.lines.length}、A/B差 ${followupLayoutDiffs}行`);
console.log(`\n# 新単価マスタの再現（協議結果と新定価表から）\n`);
console.log(`- ${JSON.stringify(out.priceMasterRebuild)}`);

writeFileSync(join(ROOT, 'docs', 'evaluation-results.json'), `${JSON.stringify(out, null, 2)}\n`);
