#!/usr/bin/env node
// gen-3 生成器：建材・住宅設備の卸「浜風建材株式会社（架空）」の売上データと正解。
//   node generate.mjs --data <入力フォルダ> --sealed <正解フォルダ> [--seal-file <SEALED.sha256 の出力先>]
// すべて架空のデータです。乱数は固定シード、時計・Math.random は使いません。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  RNG, hashStr, dn, iso, d8, slash, bizDays, mulRate, toHalfKana, encodeSjis, csvText, writeBuf, BOM, ymd,
} from './lib/util.mjs';
import { CATS, SUPPLIERS, SUPPLIER_NAME, TIERS } from './lib/catalog.mjs';
import { buildWorld, K, INF, SEED, listFor, specialAt, priceAt, costAt, REVS, COST_EVENTS, segsOf } from './lib/world.mjs';
import { generateLines } from './lib/orders.mjs';
import { judgeMain, ambiguityOf, parseVol, isSampleRemark } from './lib/judge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const DATA = arg('data');
const SEALED = arg('sealed');
const SEAL_FILE = arg('seal-file', path.join(here, 'SEALED.sha256'));
if (!DATA || !SEALED) {
  console.error('usage: node generate.mjs --data <dir> --sealed <dir> [--seal-file <file>]');
  process.exit(2);
}
const ORDERS_PER_DAY = Number(arg('opd', '10.0'));

const FILES = {
  customers: '得意先マスタ.csv',
  products: '商品マスタ.csv',
  tiers: '掛率ランク表.csv',
  cats: 'カテゴリ一覧.csv',
  sups: '仕入先一覧.csv',
  listHist: '定価履歴.csv',
  costHist: '原単価履歴.csv',
  notices: '仕入先値上げ通知.csv',
  specials: '特値登録一覧.csv',
  agreements: '価格改定回答状況_最新版.csv',
  sales2025: '売上明細_2025年.csv',
  sales2026: '売上明細_2026年.csv',
  nextList: 'next/定価改定表_20261101.csv',
  nextOutcomes: 'next/改定協議結果.csv',
  nextMaster: 'next/新単価マスタ_20261101.csv',
  nextSales: 'next/売上明細_202611.csv',
};

const w = buildWorld();
const dataBytes = new Map(); // 相対パス -> Buffer
const putUtf8 = (rel, text, bom = true, eol = '\r\n') => dataBytes.set(rel, Buffer.from((bom ? BOM : '') + text.replace(/\r?\n/g, eol), 'utf8'));
const putSjis = (rel, text) => dataBytes.set(rel, encodeSjis(text));
const rate1 = (r) => (r / 10).toFixed(1);
const yen2 = (c100) => (c100 / 100).toFixed(2);

// ================================================================ 売上明細（本体）
const mainDays = bizDays(K.S_START, K.S_END);
const optsMain = { seedName: 'main', slipStart: 4010000, ordersPerDay: ORDERS_PER_DAY, volume: 1, allowAmb: true, allowOneOff: true, noGhost: false, cashPerDay: 0.06 };
const { lines: mainLines, nextSlip } = generateLines(w, mainDays, optsMain);

// ================================================================ 次回改定（反映チェック用）
const bought = new Set();
for (const l of mainLines) if (l.kind === 'normal' && l.qty > 0 && l.d >= K.W_START && !l.c.ghost && l.p.inMaster) bought.add(l.c.code + '|' + l.p.code);

const master3 = new Map(); // 得意先|商品 -> {c,p,eff,old,newP}
{
  const sortedCust = w.masterCustomers.slice();
  for (const c of sortedCust) {
    const rec = w.ag3.get(c.code);
    if (!rec || rec.status === 'declined' || rec.status === 'negotiating') continue;
    const eff = rec.apply ?? K.R3;
    for (const p of w.products) {
      if (!p.revAt.R3) continue;
      if (rec.status === 'partial' && rec.excl.has(p.cat)) continue;
      if (!bought.has(c.code + '|' + p.code)) continue;
      if ((w.specialMap.get(c.code + '|' + p.code) || []).some((x) => x.start <= Math.max(eff, K.NOV_TO) && x.end >= K.R3)) continue;
      const oldList = listFor(w, c, p, K.R3 - 1);
      const newList = p.versionsAll.find((v) => v.rev === 'R3').price;
      const old = mulRate(oldList, c.rate1000);
      const nw = mulRate(newList, c.rate1000);
      if (nw <= old) continue;
      master3.set(c.code + '|' + p.code, { c, p, eff, old, nw, oldList });
    }
  }
}
// 反映漏れ（次回）：商品ごと、得意先まるごと、途中で直った得意先
{
  const rng = new RNG(hashStr('r3stale:' + SEED));
  const byCust = new Map();
  for (const e of master3.values()) {
    if (!byCust.has(e.c.code)) byCust.set(e.c.code, []);
    byCust.get(e.c.code).push(e);
  }
  const big = [...byCust.entries()].filter(([code, v]) => v.length >= 14 && v[0].eff === K.R3).sort((a, b) => b[1].length - a[1].length);
  const wholeCust = big[1]?.[0];
  const untilCust = big[3]?.[0];
  w.r3Stale = { wholeCust, untilCust };
  for (const e of master3.values()) {
    let to = null;
    if (e.c.code === wholeCust) to = INF;
    else if (e.c.code === untilCust) to = dn(2026, 11, 10);
    else if (rng.chance(0.05)) to = rng.chance(0.4) ? INF : e.eff + rng.int(5, 18);
    if (to !== null) w.addRegime(e.c, e.p, { type: 'stale', from: e.eff, to, frozen: e.oldList, tag: e.c.code === wholeCust ? 'cust' : e.c.code === untilCust ? 'until' : 'pair' });
  }
}
const novDays = bizDays(K.NOV_FROM, K.NOV_TO);
const optsNov = { seedName: 'nov', slipStart: nextSlip + 1000, ordersPerDay: ORDERS_PER_DAY * 1.25, volume: 1, allowAmb: false, allowOneOff: false, noGhost: true, cashPerDay: 0.02 };
const { lines: novLines } = generateLines(w, novDays, optsNov);

// ================================================================ ファイル出力：売上明細（販売管理B形式）
const SALES_HEADER = ['伝票日付', '伝票No', '明細No', '得意先CD', '得意先略称', '品番', '品名', '売上区分', '数量', '単位', '標準価格', '掛率', '売単価', '売上金額', '原価単価', '原価金額', '単価種別', '摘要'];
function salesRowB(l) {
  const c = l.c;
  const list = l.listCo;
  const isNP = l.kind === 'nonproduct';
  const rate = isNP ? '1.000' : l.billed === 0 ? '0.000' : (l.billed / list).toFixed(3);
  const costAmt = isNP ? 0 : (l.qty < 0 ? -1 : 1) * Math.round((l.cost100 * Math.abs(l.qty)) / 100);
  const half = hashStr(l.slip + '-' + l.ln) % 100 < (c.office === '西部営業所' ? 40 : 8);
  const remark = half ? toHalfKana(l.remark) : l.remark;
  return [
    d8(l.d), l.slip, l.ln, c.code, c.abbr, l.rawCode, toHalfKana(l.rawName), l.qty < 0 ? 2 : 1, l.qty, toHalfKana(l.rawUnit),
    list, rate, l.billed, l.billed * l.qty, isNP ? '0.00' : yen2(l.cost100), costAmt, l.ptype, remark,
  ];
}
const fileOf = (l) => (l.d < dn(2026, 1, 1) ? FILES.sales2025 : FILES.sales2026);
{
  const g = { [FILES.sales2025]: [SALES_HEADER], [FILES.sales2026]: [SALES_HEADER] };
  for (const l of mainLines) {
    const f = fileOf(l);
    g[f].push(salesRowB(l));
    l.file = f;
    l.row = g[f].length - 1;
  }
  for (const [f, rows] of Object.entries(g)) putSjis(f, csvText(rows));
  const rows = [SALES_HEADER];
  for (const l of novLines) {
    rows.push(salesRowB(l));
    l.file = FILES.nextSales;
    l.row = rows.length - 1;
  }
  putSjis(FILES.nextSales, csvText(rows));
}

// ================================================================ マスタ類
{
  // 得意先
  const rows = [['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日']];
  for (const c of w.masterCustomers) rows.push([c.code6, c.name, c.abbr, c.type, c.tier, rate1(c.rate1000), c.office, c.rep, c.pref, c.closing, c.dept, slash(c.tradeStart)]);
  putSjis(FILES.customers, csvText(rows));
  // 商品
  const prows = [['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)']];
  for (const p of w.products) {
    const lp = p.versions[p.versions.length - 1].price;
    const cc = costAt(p, K.S_END);
    prows.push([p.code, p.name, p.cat, p.unit, lp, yen2(cc), p.sup, ...p.shares]);
  }
  putUtf8(FILES.products, csvText(prows));
  // 掛率ランク
  const trows = [['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明']];
  for (const [k, t] of Object.entries(TIERS)) trows.push([k, t.name, rate1(t.std), rate1(t.lo), rate1(t.hi), t.desc]);
  putSjis(FILES.tiers, csvText(trows));
  // カテゴリ
  const crows = [['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料']];
  for (const c of CATS) crows.push([c.code, c.name, ...c.shares, c.mat]);
  putUtf8(FILES.cats, csvText(crows));
  // 仕入先
  putUtf8(FILES.sups, csvText([['仕入先コード', '仕入先名', '主な取扱カテゴリ'], ...SUPPLIERS]));
  // 定価履歴（Excelで開いて保存した体裁：日付は 2025/4/1）
  const lrows = [['商品コード', '定価(円)', '適用開始日', '適用終了日']];
  for (const p of w.products) {
    p.versions.forEach((v, i) => {
      const nx = p.versions[i + 1];
      lrows.push([p.code, v.price, slash(v.start), nx ? slash(nx.start - 1) : '']);
    });
  }
  putUtf8(FILES.listHist, csvText(lrows));
  // 原単価履歴
  const hrows = [['商品コード', '原単価(円)', '適用開始日', '適用終了日']];
  for (const p of w.products) {
    p.costs.forEach((c, i) => {
      const nx = p.costs[i + 1];
      hrows.push([p.code, yen2(c.c100), iso(c.start), nx ? iso(nx.start - 1) : '']);
    });
  }
  putUtf8(FILES.costHist, csvText(hrows));
  // 仕入先値上げ通知（適用済み＋予定）
  const nrows = [['通知日', '仕入先コード', '仕入先名', '商品コード', '商品名', '現行仕入単価(円)', '改定後仕入単価(円)', '改定率(%)', '適用日', '主な理由', '状態']];
  const ev = COST_EVENTS[COST_EVENTS.length - 1];
  for (const p of w.products) {
    const ci = p.costs.findIndex((c) => c.start === ev.date);
    if (ci > 0) {
      const a = p.costs[ci - 1].c100;
      const b = p.costs[ci].c100;
      nrows.push([iso(dn(2026, 5, 15)), p.sup, SUPPLIER_NAME[p.sup], p.code, p.name, yen2(a), yen2(b), (((b - a) / a) * 100).toFixed(1), iso(ev.date), '鋼材・樹脂価格の上昇', '適用済み']);
    }
  }
  const rngN = new RNG(hashStr('notice:' + SEED));
  const plan = [
    { sup: ['S01', 'S02'], date: dn(2026, 11, 1), notice: dn(2026, 8, 24), pct: 5, why: '原木価格・物流費の上昇' },
    { sup: ['S08'], date: dn(2026, 12, 1), notice: dn(2026, 9, 7), pct: 4, why: '原材料・エネルギーコストの上昇' },
    { sup: ['S10', 'S11'], date: dn(2027, 1, 1), notice: dn(2026, 9, 18), pct: 4.5, why: '部材・人件費の上昇' },
  ];
  for (const pl of plan) {
    for (const p of w.products) {
      if (!pl.sup.includes(p.sup)) continue;
      const a = costAt(p, K.S_END);
      const b = Math.round(a * (1 + (pl.pct * rngN.range(0.8, 1.25)) / 100));
      nrows.push([iso(pl.notice), p.sup, SUPPLIER_NAME[p.sup], p.code, p.name, yen2(a), yen2(b), (((b - a) / a) * 100).toFixed(1), iso(pl.date), pl.why, '予定']);
    }
  }
  putUtf8(FILES.notices, csvText(nrows));
  // 特値（販売管理B形式）
  const srows = [['得意先CD', '品番', '特価', '有効開始日', '有効終了日', '摘要']];
  const rngS = new RNG(hashStr('spfmt:' + SEED));
  for (const s of w.specials) {
    const code = rngS.chance(0.93) ? s.p.code : s.p.code.replace('-', '');
    srows.push([s.c.code, code, s.price, d8(s.start), d8(s.end), s.reason]);
  }
  putSjis(FILES.specials, csvText(srows));
  // 前回改定の合意状況
  const arows = [['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考']];
  const recs = [...w.ag2.values()].sort((a, b) => (a.c.code < b.c.code ? -1 : 1));
  for (const r of recs) arows.push([r.c.code, r.c.name, slash(r.ask), r.ans ? slash(r.ans) : '', r.text, r.apply ? slash(r.apply) : '', [...r.excl].join(';'), r.note]);
  putUtf8(FILES.agreements, csvText(arows));
}

// ================================================================ next/ の入力
{
  const lrows = [['商品コード', '商品名', '現定価(円)', '新定価(円)', '適用日']];
  for (const p of w.products) {
    if (!p.revAt.R3) continue;
    const v = p.versionsAll.find((x) => x.rev === 'R3');
    lrows.push([p.code, p.name, priceAt(p, K.R3 - 1), v.price, iso(K.R3)]);
  }
  putUtf8(FILES.nextList, csvText(lrows));
  const orows = [['得意先コード', '得意先名', '協議結果', '適用日', '対象外カテゴリ', '備考']];
  const recs = [...w.ag3.values()].sort((a, b) => (a.c.code < b.c.code ? -1 : 1));
  for (const r of recs) orows.push([r.c.code6, r.c.name, r.text, r.apply ? iso(r.apply) : r.status === 'agreed' ? iso(K.R3) : '', [...r.excl].join(';'), r.note]);
  putUtf8(FILES.nextOutcomes, csvText(orows));
  const mrows = [['得意先CD', '品番', '適用開始日', '売単価', '旧売単価']];
  const ents = [...master3.values()].sort((a, b) => (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : a.p.code < b.p.code ? -1 : 1));
  for (const e of ents) mrows.push([e.c.code, e.p.code, d8(e.eff), e.nw, e.old]);
  putSjis(FILES.nextMaster, csvText(mrows));
}

// ================================================================ 正解：本体
const LABELS = ['ok', 'ok_special', 'ok_declined', 'ok_deferred', 'ok_volume_discount', 'ok_return', 'ok_sample', 'ok_non_product', 'leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor', 'unexplained', 'ambiguous'];
const LEAKS = ['leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor'];
const counts = Object.fromEntries(LABELS.map((x) => [x, 0]));
const short = { all: Object.fromEntries(LEAKS.map((x) => [x, 0])), last12m: Object.fromEntries(LEAKS.map((x) => [x, 0])) };
const leakLines = { all: Object.fromEntries(LEAKS.map((x) => [x, 0])), last12m: Object.fromEntries(LEAKS.map((x) => [x, 0])) };
const ambCounts = {};
const truthRows = [['file', 'row', 'line_id', 'date', 'customer_code', 'product_code', 'qty', 'billed', 'label', 'ambiguity', 'reference', 'reference_kind', 'shortfall_yen', 'below_floor', 'floor_price', 'floor_gap_yen', 'last12m']];
const oddities = [];
let last12Lines = 0;
const label12 = Object.fromEntries(LABELS.map((x) => [x, 0]));
for (const l of mainLines) {
  const j = judgeMain(w, l);
  if (j.label === 'overcharge') oddities.push(`overcharge ${l.file}:${l.row}`);
  const amb = ambiguityOf(l, j);
  let label = j.label;
  let ambStr = '';
  let shortfall = j.shortfall;
  if (amb) {
    label = 'ambiguous';
    ambStr = `${amb.pattern}|A=${amb.A}|B=${amb.B}`;
    ambCounts[amb.pattern] = (ambCounts[amb.pattern] || 0) + 1;
    shortfall = 0;
  }
  const in12 = l.d >= K.W_START ? 1 : 0;
  counts[label] = (counts[label] || 0) + 1;
  if (in12) {
    last12Lines++;
    label12[label] = (label12[label] || 0) + 1;
  }
  if (LEAKS.includes(label)) {
    short.all[label] += shortfall;
    leakLines.all[label]++;
    if (in12) {
      short.last12m[label] += shortfall;
      leakLines.last12m[label]++;
    }
  }
  const np = l.kind === 'nonproduct';
  truthRows.push([
    l.file, l.row, `${l.slip}-${l.ln}`, iso(l.d), l.c.code6, np ? l.code : l.p.code, l.qty, l.billed, label, ambStr,
    j.reference, j.refKind, shortfall, j.below, j.floorPrice, j.floorGap, in12,
  ]);
}

// ================================================================ 正解：反映チェック
const FU = ['ok_new_price', 'still_old_price', 'ok_before_effective', 'ok_volume_discount', 'ok_return', 'ok_sample', 'ok_non_product', 'not_in_master', 'ambiguous'];
const fuCounts = Object.fromEntries(FU.map((x) => [x, 0]));
let fuShort = 0;
const fuRows = [['file', 'row', 'line_id', 'label', 'date', 'customer', 'product', 'qty', 'billed', 'expected', 'shortfall_yen', 'pattern']];
for (const l of novLines) {
  const np = l.kind === 'nonproduct';
  let label;
  let expected = '';
  let shortfall = 0;
  let pattern = '';
  const e = np || l.c.ghost || !l.p.inMaster ? null : master3.get(l.c.code + '|' + l.p.code);
  if (np || l.c.ghost || !l.p.inMaster) {
    label = 'ok_non_product';
    pattern = np ? 'freight_or_other_code' : l.c.ghost ? 'customer_not_in_master' : 'product_not_in_master';
  } else if (l.qty < 0) {
    label = 'ok_return';
    pattern = 'return';
  } else if (l.billed === 0 && isSampleRemark(l.remark)) {
    label = 'ok_sample';
    pattern = 'free_sample';
  } else if (!e) {
    label = 'not_in_master';
    const rec = w.ag3.get(l.c.code);
    pattern = !rec ? 'customer_without_row' : rec.status === 'declined' ? 'customer_declined' : rec.status === 'negotiating' ? 'customer_negotiating' : !l.p.revAt.R3 ? 'product_not_revised' : rec.status === 'partial' && rec.excl.has(l.p.cat) ? 'category_kept' : specialAt(w, l.c, l.p, l.d) ? 'special_price_pair' : 'not_bought_last_12m';
  } else {
    const exp = l.d < e.eff ? e.old : e.nw;
    expected = exp;
    const v10 = parseVol(l.remark);
    if (l.billed === exp) {
      label = l.d < e.eff ? 'ok_before_effective' : 'ok_new_price';
      pattern = l.d < e.eff ? `before_effective_${d8(e.eff)}` : 'new_price';
    } else if (v10 !== null && Math.floor((exp * (1000 - v10)) / 1000) === l.billed) {
      label = 'ok_volume_discount';
      pattern = `volume_${v10 / 10}pct`;
    } else if (l.d >= e.eff && l.billed === e.old) {
      label = 'still_old_price';
      shortfall = (e.nw - l.billed) * l.qty;
      fuShort += shortfall;
      const reg = (w.regimes.get(l.c.code + '|' + l.p.code) || []).find((r) => r.from <= l.d && l.d <= r.to);
      pattern = reg ? (reg.tag === 'cust' ? 'customer_whole_month' : reg.tag === 'until' ? 'old_until_1110' : 'pair_old') : 'pair_old';
    } else {
      label = 'ambiguous';
      pattern = `BILLED_NEITHER_OLD_NOR_NEW|A=still_old_price|B=not_in_master`;
    }
  }
  fuCounts[label]++;
  fuRows.push([l.file, l.row, `${l.slip}-${l.ln}`, label, iso(l.d), l.c.code6, np ? l.code : l.p.code, l.qty, l.billed, expected, shortfall, pattern]);
}

// ================================================================ 出力
const toUtf8 = (rows) => Buffer.from(csvText(rows, '\n'), 'utf8');
for (const [rel, buf] of dataBytes) writeBuf(path.join(DATA, rel), buf);
writeBuf(path.join(SEALED, 'truth/lines.csv'), toUtf8(truthRows));
writeBuf(path.join(SEALED, 'truth/followup_lines.csv'), toUtf8(fuRows));

const revDates = REVS.filter((r) => r.date <= K.S_END).map((r) => iso(r.date));
const fileInfo = [...dataBytes.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([rel, buf]) => ({ file: rel, bytes: buf.length, rows: (buf.toString('latin1').match(/\n/g) || []).length - 1, sha256: crypto.createHash('sha256').update(buf).digest('hex') }));
const summary = {
  generator: 'gen-3',
  fictional: true,
  company: '浜風建材株式会社（架空）',
  scenario: '建材・住宅設備の卸（工務店・リフォーム会社向け）',
  period: { from: iso(K.S_START), to: iso(K.S_END), last12m: { from: iso(K.W_START), to: iso(K.S_END) } },
  previousRevisionDate: iso(K.R2),
  revisionDatesInListPriceHistory: revDates,
  agreementsFile: FILES.agreements,
  linesTotal: mainLines.length,
  linesLast12m: last12Lines,
  customersInMaster: w.masterCustomers.length,
  productsInMaster: w.products.length,
  counts,
  countsLast12m: label12,
  leakLines,
  shortfallYen: short,
  ambiguityPatterns: ambCounts,
  followup: { effectiveDate: iso(K.R3), linesTotal: novLines.length, counts: fuCounts, stillOldShortfallYen: fuShort, newPriceMasterRows: master3.size },
  files: fileInfo,
};
writeBuf(path.join(SEALED, 'truth/summary.json'), Buffer.from(JSON.stringify(summary, null, 2) + '\n', 'utf8'));

// notes.md
const pc = (k) => ambCounts[k] || 0;
const notes = `# gen-3 判断が分かれる行と前提（正解側のメモ）

すべて架空のデータです（浜風建材株式会社（架空））。

## 判断が分かれる行（label=ambiguous）
- PARTIAL_NO_CATEGORY（${pc('PARTIAL_NO_CATEGORY')}行）：合意状況が「一部合意」なのに「対象外カテゴリ」が空で、備考だけ「一部商品は据え置き（品目は別途連絡）」とある2社。
  A=全品目が新定価（旧価格のままの請求は反映漏れ）、B=据え置き品目があり旧価格のままが正しい（見送りと同じ）。新定価で請求している行は ok としている。
- FREE_GOODS_OTHER_WORDING（${pc('FREE_GOODS_OTHER_WORDING')}行）：単価0円で、備考が「サービス品」「販促品」「おまけ」など（見本・サンプル・無償・試供のどれでもない）。
  A=無償品（対象外）、B=ほかの行と同じに判定（掛率ランク外、不足額は基準単価×数量）。
- DISCOUNT_REMARK_NO_RATE（${pc('DISCOUNT_REMARK_NO_RATE')}行）：備考が「数量値引」「まとめ買い値引」で率の記載がなく、請求単価は基準単価の8〜10%引き。A=数量値引（正常）、B=率が読めないので通常の判定。
- DISCOUNT_ROUNDING（${pc('DISCOUNT_ROUNDING')}行）：備考に率はあるが、請求単価が切り捨てでなく四捨五入で計算した値（切り捨てと1円違う）。A=数量値引（正常）、B=切り捨てと合わないので通常の判定。

## 前提（ambiguous にしていないが、文書の読み方に依存するもの）
- 合意状況の「合意」で適用日が空欄＝前回の改定日（${iso(K.R2)}）から。
- ok_deferred：合意だが適用日が改定日より後の得意先の、適用日前の旧価格。ok_declined：見送り（「合意に至らず」を含む）・協議中・一部合意の対象外カテゴリの旧価格。
- 合意状況に行がない得意先は合意とみなす（旧価格のままは反映漏れ）。
- 商品マスタにない商品コード（運賃9999・荷造費9998・取付工賃9980・出精値引9900、廃番で商品マスタから消えた12品目）と、得意先マスタにない得意先（取引終了で削除された3社、現金売上99999）の行は ok_non_product（対象外）。
- 前回の改定（${iso(K.R2)}）の前の改定（${iso(K.R1)}、${iso(K.R0)}）には合意状況がない。全得意先が合意したものとして扱うので、その旧価格のままの請求は反映漏れ。
  前々回の定価のまま${iso(K.R2)}以降も請求している行は、直前の定価ではないので反映漏れにせず、ランクの下限より安ければ掛率ランク外、範囲内なら unexplained。
- 粗利下限：粗利率 = (請求単価 − 原単価) / 請求単価 が10%未満。floor_price = ceil(原単価(銭) / 90) 円。floor_gap_yen = (floor_price − 請求単価) × 数量（下限割れのときだけ）。
  粗利下限割れの reference は正しい単価（特値・定価×掛率・数量値引後）、shortfall_yen は floor_gap_yen。
  反映漏れ・期限切れ・ランク外の行は、同時に下限を割っていても種類は前者（below_floor=1 と floor_gap_yen だけ記録）。
- 粗利率が下限の前後0.5ポイント以内になる行は生成時に避けている（原価金額の丸めで判定がぶれるため）。
- 基準単価より高い請求（overcharge）は、ラベルの集合にないため生成していない。
- unexplained の行は、同時に粗利下限を割らないように作っている。
- 掛率は得意先マスタの掛率（0.1%単位）、単価 = floor(定価 × 掛率)。数量値引は floor(基準単価 × (100 − 率)%)。
- 前回の改定で定価が変わった商品の、見送り・据え置きの得意先は直前までの定価（${iso(K.R1)}の定価）が正しい。

## 反映チェック（next/）
- 次回改定は${iso(K.R3)}。新単価マスタは「合意・一部合意・適用日変更」の得意先が直近12か月に買った、値上げ対象で、適用日に特値がない商品。旧売単価は現在の正しい単価。
- 新単価マスタの対象で、適用開始日以降に旧売単価で請求 → still_old_price。適用開始日前は ok_before_effective。
- BILLED_NEITHER_OLD_NOR_NEW（${fuCounts.ambiguous}行）：新単価マスタの組で、旧売単価とも新単価とも合わない請求（以前からの更新漏れが続いている）。A=旧価格のままの請求、B=マスタの想定外（判定対象外）。

## 生成のしかけ（参考）
- 乱数は固定シード（${SEED}）。時計・Math.random・ロケールは使っていない。
`;
writeBuf(path.join(SEALED, 'notes.md'), Buffer.from(notes, 'utf8'));

// SEALED.sha256
{
  const rels = ['notes.md', 'truth/followup_lines.csv', 'truth/lines.csv', 'truth/summary.json'];
  const out = rels.map((r) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(SEALED, r))).digest('hex')}  ${r}`).join('\n') + '\n';
  writeBuf(SEAL_FILE, Buffer.from(out, 'utf8'));
}

// 自己点検（生成の前提が崩れていたら止める）
{
  const total = mainLines.length;
  const leakN = LEAKS.reduce((a, k) => a + counts[k], 0);
  const problems = [...oddities];
  if (leakN / total < 0.05 || leakN / total > 0.12) problems.push(`leak share ${(leakN / total).toFixed(4)}`);
  if (counts.ambiguous / total >= 0.01) problems.push('ambiguous >= 1%');
  if (counts.overcharge) problems.push('overcharge present');
  for (const l of mainLines) {
    const j = judgeMain(w, l);
    if (j.label === 'unexplained' && j.below) problems.push(`unexplained below floor ${l.slip}-${l.ln}`);
  }
  if (problems.length) {
    console.error('PROBLEMS', problems.slice(0, 20));
    process.exit(1);
  }
}
console.log(JSON.stringify({ lines: mainLines.length, last12m: last12Lines, novLines: novLines.length, counts, short, ambCounts, fuCounts, master3: master3.size, oddities: oddities.length }, null, 1));
