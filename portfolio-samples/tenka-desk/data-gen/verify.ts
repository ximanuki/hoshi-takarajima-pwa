/**
 * Checks the generated sample data end to end, using only the published files:
 *
 *  1. layout A and layout B of every sales file parse into identical records
 *     (全角/半角, 和暦/西暦, 品番ゆれ, 半角カナ are all normalised away);
 *  2. the 特値 lists and the demo price masters agree between A and B;
 *  3. the diagnosis rules (lib/rules.ts) applied to the parsed files reproduce
 *     truth/lines.csv, truth/issues.csv and truth/followup_lines.csv exactly;
 *  4. every file still has the sha256 recorded in truth/summary.json;
 *  5. with --regen: the generator is run again into a temporary directory and
 *     every file must be byte-identical (determinism).
 *
 *   node data-gen/verify.ts [--root DIR] [--regen]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvObjects } from './lib/csv.ts';
import {
  parsePriceMasterA, parsePriceMasterB, parseSalesA, parseSalesB, parseSpecialsA, parseSpecialsB,
} from './lib/importers.ts';
import type { SalesRecord, SpecialRecord } from './lib/importers.ts';
import { LEAK_TYPES, classifyFollowupLine, classifyHistoryLine, pairKey } from './lib/rules.ts';
import type { Ctx, Line, MasterEntry, SpecialRow } from './lib/rules.ts';
import { codeKey } from './lib/text.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? resolve(process.argv[rootArg + 1]) : resolve(HERE, '..');
const S = (p: string): string => join(ROOT, 'public', 'sample', p);
const T = (p: string): string => join(ROOT, 'data-gen', 'truth', p);
const read = (p: string): string => readFileSync(p, 'utf8');

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    if (failures <= 30) console.error(`NG: ${msg}`);
  }
}

/* ---------- masters ---------- */
const settings = JSON.parse(read(S('demo_settings.json'))) as { marginFloorPct: number; previousRevisionDate: string; historyEnd: string };
const products = parseCsvObjects(read(S('products.csv')));
const keyToSku = new Map<string, string>();
for (const p of products) {
  const k = codeKey(p['商品コード']);
  check(!keyToSku.has(k), `duplicate product key ${k}`);
  keyToSku.set(k, p['商品コード']);
}
const ctx: Ctx = {
  floorPct: settings.marginFloorPct,
  revisionDate: settings.previousRevisionDate,
  tiers: new Map(parseCsvObjects(read(S('rate_tiers.csv'))).map((t) => [
    t['掛率ランク'], { min: Math.round(Number(t['下限(%)']) * 10), max: Math.round(Number(t['上限(%)']) * 10) },
  ])),
  customers: new Map(parseCsvObjects(read(S('customers.csv'))).map((c) => [
    c['得意先コード'], { rank: c['掛率ランク'], ratePm: Math.round(Number(c['掛率(%)']) * 10) },
  ])),
  productCat: new Map(products.map((p) => [p['商品コード'], p['カテゴリコード']])),
  listHist: new Map(),
  agreements: new Map(parseCsvObjects(read(S('revision_2025-04_agreements.csv'))).map((a) => [
    a['得意先コード'],
    { status: a['合意状況'], eff: a['適用日'] || null, excluded: new Set(a['対象外カテゴリ'] ? a['対象外カテゴリ'].split(';') : []) },
  ])),
  specials: new Map(),
};
for (const r of parseCsvObjects(read(S('list_price_history.csv')))) {
  const arr = ctx.listHist.get(r['商品コード']) ?? [];
  arr.push({ price: Number(r['定価(円)']), start: r['適用開始日'], end: r['適用終了日'] || null });
  ctx.listHist.set(r['商品コード'], arr);
}
for (const arr of ctx.listHist.values()) arr.sort((a, b) => (a.start < b.start ? -1 : 1));

/* ---------- 特値 A vs B ---------- */
const spA = parseSpecialsA(read(S('special_prices_A.csv')));
const spB = parseSpecialsB(read(S('special_prices_B.csv')));
check(spA.length === spB.length, `special rows A=${spA.length} B=${spB.length}`);
const spKey = (s: SpecialRecord): string => `${s.cust}|${s.skuKey}|${s.price}|${s.start}|${s.end}|${s.reason}`;
spA.forEach((s, i) => check(spKey(s) === spKey(spB[i]), `special row ${i + 1}: ${spKey(s)} vs ${spKey(spB[i])}`));
for (const s of spA) {
  const sku = keyToSku.get(s.skuKey);
  check(!!sku, `special for unknown sku ${s.skuKey}`);
  const k = pairKey(s.cust, sku ?? '');
  const arr = ctx.specials.get(k) ?? [];
  arr.push({ price: s.price, start: s.start, end: s.end } as SpecialRow);
  ctx.specials.set(k, arr);
}

/* ---------- sales A vs B ---------- */
function compareLayouts(a: SalesRecord[], b: SalesRecord[], label: string): void {
  check(a.length === b.length, `${label}: rows A=${a.length} B=${b.length}`);
  const fields: (keyof SalesRecord)[] = ['date', 'slip', 'line', 'isReturn', 'cust', 'skuKey', 'itemName', 'qty', 'unit', 'list', 'billed', 'amount', 'costSen', 'costAmount', 'priceType', 'remark'];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    for (const f of fields) {
      if (a[i][f] !== b[i][f]) {
        check(false, `${label} row ${i + 2} ${String(f)}: A=${JSON.stringify(a[i][f])} B=${JSON.stringify(b[i][f])}`);
        break;
      }
    }
    check(a[i].amount === a[i].billed * a[i].qty, `${label} row ${i + 2}: 金額 != 単価×数量`);
  }
}

function toLine(r: SalesRecord): Line {
  return {
    date: r.date, cust: r.cust, sku: keyToSku.get(r.skuKey) ?? null, qty: r.qty, billed: r.billed, costSen: r.costSen,
    remark: r.remark, isReturn: r.isReturn,
  };
}

const histA = parseSalesA(read(S('sales_A_202410-202609.csv')));
const histB = parseSalesB(read(S('sales_B_202410-202609.csv')));
compareLayouts(histA, histB, 'history');

/* ---------- rules vs truth (history) ---------- */
const truthLines = parseCsvObjects(read(T('lines.csv')));
check(truthLines.length === histA.length, `truth lines ${truthLines.length} vs sales ${histA.length}`);
const labelCount: Record<string, number> = {};
type Agg = { lines: number; total: number; last12: number };
const agg = new Map<string, Agg>();
const last12Start = '2025-10-01';
histA.forEach((r, i) => {
  const t = truthLines[i];
  const res = classifyHistoryLine(ctx, toLine(r));
  labelCount[res.label] = (labelCount[res.label] ?? 0) + 1;
  const id = `${r.slip}-${r.line}`;
  check(t.line_id === id, `line id ${t.line_id} vs ${id}`);
  check(t.label === res.label, `${id}: truth ${t.label} vs rules ${res.label}`);
  check(Number(t.reference) === res.reference, `${id}: reference ${t.reference} vs ${res.reference}`);
  check(Number(t.shortfall_yen) === res.shortfall, `${id}: shortfall ${t.shortfall_yen} vs ${res.shortfall}`);
  check(Number(t.below_floor) === (res.belowFloor ? 1 : 0), `${id}: below_floor`);
  check(Number(t.floor_gap_yen) === res.floorGap, `${id}: floor gap`);
  if ((LEAK_TYPES as readonly string[]).includes(res.label)) {
    const sku = keyToSku.get(r.skuKey) ?? '';
    const k = `${res.label}|${r.cust}|${sku}`;
    const a = agg.get(k) ?? { lines: 0, total: 0, last12: 0 };
    a.lines++;
    a.total += res.shortfall;
    if (r.date >= last12Start) a.last12 += res.shortfall;
    agg.set(k, a);
  }
});
const truthIssues = parseCsvObjects(read(T('issues.csv')));
check(truthIssues.length === agg.size, `issues ${truthIssues.length} vs rules ${agg.size}`);
for (const t of truthIssues) {
  const a = agg.get(`${t.type}|${t.cust}|${t.sku}`);
  check(!!a, `issue ${t.issue_id} not reproduced`);
  if (a) {
    check(a.lines === Number(t.lines), `issue ${t.issue_id}: lines ${a.lines} vs ${t.lines}`);
    check(a.total === Number(t.shortfall_total_yen), `issue ${t.issue_id}: total`);
    check(a.last12 === Number(t.shortfall_last12m_yen), `issue ${t.issue_id}: last12m`);
  }
}

/* ---------- 反映チェック month ---------- */
const pmA = parsePriceMasterA(read(S('next/price_master_A_20261201.csv')));
const pmB = parsePriceMasterB(read(S('next/price_master_B_20261201.csv')));
check(pmA.length === pmB.length, `price master rows A=${pmA.length} B=${pmB.length}`);
const master = new Map<string, MasterEntry>();
pmA.forEach((m, i) => {
  const o = pmB[i];
  check(m.cust === o.cust && m.skuKey === o.skuKey && m.eff === o.eff && m.newPrice === o.newPrice && m.curPrice === o.curPrice, `price master row ${i + 2} differs`);
  const sku = keyToSku.get(m.skuKey);
  check(!!sku, `price master unknown sku ${m.skuKey}`);
  master.set(pairKey(m.cust, sku ?? ''), { eff: m.eff, newPrice: m.newPrice, curPrice: m.curPrice });
});
const folA = parseSalesA(read(S('next/sales_A_202612.csv')));
const folB = parseSalesB(read(S('next/sales_B_202612.csv')));
compareLayouts(folA, folB, 'followup');
const truthFol = parseCsvObjects(read(T('followup_lines.csv')));
check(truthFol.length === folA.length, `followup truth ${truthFol.length} vs ${folA.length}`);
const folCount: Record<string, number> = {};
folA.forEach((r, i) => {
  const res = classifyFollowupLine(master, ctx.productCat, toLine(r));
  folCount[res.label] = (folCount[res.label] ?? 0) + 1;
  const t = truthFol[i];
  check(t.label === res.label, `followup ${t.line_id}: truth ${t.label} vs rules ${res.label}`);
  check(Number(t.shortfall_yen) === res.shortfall, `followup ${t.line_id}: shortfall`);
});

/* ---------- hashes ---------- */
const summary = JSON.parse(read(T('summary.json'))) as { files: { path: string; rows: number; sha256: string }[] };
for (const f of summary.files) {
  const h = createHash('sha256').update(readFileSync(join(ROOT, f.path))).digest('hex');
  check(h === f.sha256, `sha256 changed: ${f.path}`);
}

/* ---------- determinism ---------- */
if (process.argv.includes('--regen')) {
  const tmp = mkdtempSync(join(tmpdir(), 'tenka-desk-regen-'));
  try {
    execFileSync(process.execPath, [...process.execArgv, join(HERE, 'generate.ts'), '--out', tmp], { stdio: 'ignore' });
    let same = 0;
    for (const f of summary.files) {
      const a = readFileSync(join(ROOT, f.path));
      const b = readFileSync(join(tmp, f.path));
      check(a.equals(b), `regenerated file differs: ${f.path}`);
      if (a.equals(b)) same++;
    }
    const sa = readFileSync(T('summary.json'));
    const sb = readFileSync(join(tmp, 'data-gen', 'truth', 'summary.json'));
    check(sa.equals(sb), 'regenerated summary.json differs');
    console.log(`determinism: regenerated ${same}/${summary.files.length} files + summary.json byte-identical`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------- report ---------- */
const unknownSku = new Set(histA.filter((r) => !keyToSku.has(r.skuKey)).map((r) => r.rawSku.normalize('NFKC')));
const rawVariants = new Set(histB.map((r) => r.rawSku)).size;
console.log(`history: ${histA.length} lines; A == B after normalisation; ${rawVariants} raw 品番 spellings in B map to ${new Set(histB.map((r) => r.skuKey)).size} keys`);
console.log(`codes not in the product master: ${[...unknownSku].join(', ')}`);
console.log('history labels', JSON.stringify(Object.fromEntries(Object.entries(labelCount).sort())));
console.log('followup labels', JSON.stringify(Object.fromEntries(Object.entries(folCount).sort())));
console.log(`issues reproduced: ${truthIssues.length}; files hashed: ${summary.files.length}`);
if (failures > 0) {
  console.error(`FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log('OK');
