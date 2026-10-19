#!/usr/bin/env node
// gen-5：機械部品・工具の商社（架空）の書き出しデータと正解を作る。
// 使い方: node generate.mjs --data <入力の出力先> --sealed <正解の出力先>
// 依存なし・固定シード・時計と Math.random は使わない。
import { D, R2_CATS, R4_CATS, buildCustomers, buildProducts, createModel } from './model.mjs';
import { makeRng, ymd } from './util.mjs';
import { writeAll } from './output.mjs';

const argv = process.argv.slice(2);
const arg = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const DATA = arg('--data');
const SEALED = arg('--sealed');
if (!DATA || !SEALED) {
  console.error('usage: node generate.mjs --data <dir> --sealed <dir>');
  process.exit(2);
}
const INF = 1e9;
const rngP = makeRng(0x5a01);
const rngC = makeRng(0x5a02);
const rngO = makeRng(0x5a03);
const rngS = makeRng(0x5a04);
const rngA = makeRng(0x5a05);
const rngI = makeRng(0x5a06);
const rngF = makeRng(0x5a07);

const products = buildProducts(rngP);
const customers = buildCustomers(rngC);
const specials = [];
const specialsByPair = new Map();
const M = createModel({ specialsByPair });
const key = (c, p) => `${c.code}|${p.code}`;
const hasEntry = (p, day) => p.hist.some((e, i) => i > 0 && e.start === day);

// ---- 営業日 ----
function isHoliday(day) {
  const t = ymd(day);
  const md = t.m * 100 + t.d;
  if (t.wd === 0 || t.wd === 6) return true;
  if (md <= 103 || md >= 1229) return true;
  if (md >= 503 && md <= 506) return true;
  if (md >= 813 && md <= 816) return true;
  return [211, 223, 429, 1103, 1123].includes(md);
}
const bizDays = (from, to) => {
  const r = [];
  for (let x = from; x <= to; x++) if (!isHoliday(x)) r.push(x);
  return r;
};
const nextBiz = (day) => {
  let x = day;
  while (isHoliday(x)) x++;
  return x;
};

// ---- 得意先ごとのよく買う商品 ----
const CAT_W = [
  { CT: 4, HT: 2, FS: 2, MS: 2, LB: 2, BR: 1, PN: 1, TR: 0.5 },
  { BR: 4, TR: 3, HT: 2, PN: 2, LB: 2, FS: 2, MS: 1, CT: 0.5 },
  { FS: 4, BR: 3, PN: 3, TR: 2, CT: 1, HT: 1, MS: 1, LB: 1 },
  { BR: 3, FS: 3, HT: 2.5, CT: 2, PN: 2, TR: 2, MS: 1.5, LB: 2 },
  { FS: 4, HT: 3, PN: 2, LB: 2, TR: 1, BR: 1, MS: 0.5, CT: 0.5 },
];
for (const c of customers) {
  const [a, b] = { S: [60, 90], A: [45, 70], B: [30, 50], C: [14, 30], D: [6, 16] }[c.rank];
  const n = rngO.int(a, b);
  const cand = products.map((p) => ({ p, w: (CAT_W[c.ti][p.cat] ?? 0.2) * p.pop }));
  const basket = [];
  for (let k = 0; k < n; k++) {
    let tot = 0;
    for (const x of cand) tot += x.w;
    let r = rngO.next() * tot;
    let j = 0;
    for (; j < cand.length - 1; j++) {
      r -= cand[j].w;
      if (r < 0) break;
    }
    basket.push({ p: cand[j].p, w: 0.3 + rngO.next() * 2.2 });
    cand.splice(j, 1);
  }
  c.basket = basket;
}

// ---- 伝票の骨組み ----
const SEASON = { 1: 0.85, 2: 0.95, 3: 1.15, 4: 1.0, 5: 0.9, 6: 1.0, 7: 1.0, 8: 0.72, 9: 1.05, 10: 1.0, 11: 1.0, 12: 1.1 };
const VOLS = [
  [300, '数量値引3%'],
  [500, 'まとめ買い5%引'],
  [250, '大口値引 2.5%'],
  [400, '数量値引 4％'],
  [300, '数量値引3%'],
];
const SAMPLE_REMARKS = ['見本品', 'サンプル（無償）', '試供品', '無償サンプル', '見本品（新製品）'];
const RETURN_REMARKS = ['返品（数量違い）', '返品（誤発注）', '返品（サイズ違い）', '返品（初期不良）'];
let slipSeq = 0;
function makeSlip(c, day, rng, fu) {
  const lines = [];
  const n = Math.min(7, 1 + rng.poisson(0.85));
  const avail = c.basket.filter((b) => (b.p.intro ?? 0) <= day && b.p.lastSale >= day);
  const used = new Set();
  for (let k = 0; k < n && used.size < avail.length; k++) {
    let b = null;
    for (let t = 0; t < 8; t++) {
      b = rng.weighted(avail, avail.map((x) => x.w));
      if (!used.has(b.p.code)) break;
    }
    if (used.has(b.p.code)) continue;
    used.add(b.p.code);
    const p = b.p;
    let qty = p.qmin + Math.floor((p.qmax - p.qmin + 1) * rng.next() ** 2);
    if (c.rank === 'S' || c.rank === 'A') qty *= rng.int(1, 3);
    let vol = null;
    let remark = '';
    if (rng.chance(0.045)) {
      qty *= rng.int(3, 5);
      if (c.vol && rng.chance(0.7)) {
        const v = rng.pick(VOLS);
        vol = v[0];
        remark = v[1];
      }
    }
    lines.push({ kind: 'sale', cust: c, prod: p, code: p.code, qty, remark, vol, date: day, fu });
  }
  if (rng.chance(0.006) && avail.length) {
    const p = rng.pick(avail).p;
    lines.push({ kind: 'sample', cust: c, prod: p, code: p.code, qty: 1, billed: 0, remark: rng.pick(SAMPLE_REMARKS), date: day, fu });
  }
  const fr = { S: 0.02, A: 0.02, B: 0.05, C: 0.12, D: 0.25 }[c.rank];
  if (rng.chance(fr)) lines.push({ kind: 'freight', cust: c, prod: null, code: 'Z-001', name: '運賃', unit: '式', qty: 1, billed: rng.pick([800, 1000, 1200, 1500, 2000]), remark: '', date: day, fu });
  if (c.rank === 'D' && rng.chance(0.03)) lines.push({ kind: 'freight', cust: c, prod: null, code: 'Z-002', name: '代引手数料', unit: '式', qty: 1, billed: rng.pick([330, 440]), remark: '', date: day, fu });
  if (rng.chance(0.004)) lines.push({ kind: 'freight', cust: c, prod: null, code: 'Z-009', name: '出精値引', unit: '式', qty: 1, billed: -rng.pick([300, 500, 800, 1000, 1500]), remark: '端数調整', date: day, fu });
  if (!lines.length) return null;
  return { date: day, cust: c, lines, seq: slipSeq++, fu };
}
function genSlips(from, to, rng, fu) {
  const out = [];
  for (const day of bizDays(from, to)) {
    const f = SEASON[ymd(day).m];
    for (const c of customers) {
      if (day < c.firstOrder || day > c.lastOrder) continue;
      if (!rng.chance((c.spm / 22.5) * f)) continue;
      const s = makeSlip(c, day, rng, fu);
      if (s) out.push(s);
    }
  }
  return out;
}
function addReturns(slips, rng, until, fu, rate) {
  const out = [];
  for (const s of slips) {
    for (const l of s.lines) {
      if (l.kind !== 'sale' || !rng.chance(rate)) continue;
      const day = nextBiz(s.date + rng.int(3, 25));
      if (day > until) continue;
      const q = -rng.int(1, Math.max(1, Math.min(l.qty, 5)));
      out.push({ date: day, cust: s.cust, seq: slipSeq++, fu, lines: [{ kind: 'return', cust: s.cust, prod: l.prod, code: l.code, qty: q, orig: l, remark: rng.pick(RETURN_REMARKS), date: day, fu }] });
    }
  }
  return slips.concat(out).sort((a, b) => a.date - b.date || a.seq - b.seq);
}
let slips = genSlips(D.SALES_START, D.SALES_END, rngO, false);
slips = addReturns(slips, rngO, D.SALES_END, false, 0.007);
const allLines = slips.flatMap((s) => s.lines);
const saleLines = allLines.filter((l) => l.kind === 'sale');
const pairLines = new Map();
for (const l of saleLines) {
  const k = key(l.cust, l.prod);
  if (!pairLines.has(k)) pairLines.set(k, []);
  pairLines.get(k).push(l);
}
const linesIn = (c, from, to, pred = () => true) => saleLines.filter((l) => l.cust === c && l.date >= from && l.date < to && pred(l));

// ---- 役割を持つ得意先（架空の出来事） ----
const existing = customers.filter((c) => c.firstOrder === D.SALES_START && c.lastOrder === INF);
const taken = new Set();
function pickRole(pred, score) {
  const cands = existing.filter((c) => !taken.has(c) && pred(c)).map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s || (a.c.code < b.c.code ? -1 : 1));
  const top = cands.slice(0, Math.max(1, Math.min(4, cands.length)));
  const c = rngI.pick(top).c;
  taken.add(c);
  return c;
}
const cnt = (c, from, to, pred) => linesIn(c, from, to, pred).length;
const midScore = (lo, hi) => (c) => {
  const n = cnt(c, D.R2, D.R3);
  return n >= lo && n <= hi ? 1000 - Math.abs(n - (lo + hi) / 2) : -Math.abs(n - (lo + hi) / 2);
};
const ROLE = {};
ROLE.X1 = pickRole((c) => c.rank === 'B' || c.rank === 'C', midScore(120, 220)); // 改定の反映漏れ（得意先まるごと、R3で修正）
ROLE.X2 = pickRole((c) => (c.rank === 'B' || c.rank === 'C') && c.closing === '末日', midScore(60, 140)); // 適用日9/1の合意、切替が12月まで遅れた
ROLE.X3 = pickRole((c) => c.rank === 'B' && c.rate10 === 700, midScore(80, 200)); // 販売管理の掛率が65%のまま
ROLE.X4 = pickRole((c) => c.rank === 'C' && c.rate10 === 770, midScore(25, 80)); // 3か月だけ76%で請求（原因不明）
ROLE.Y1 = pickRole((c) => c.rank === 'C' || c.rank === 'D', midScore(20, 50)); // 合意状況「回答待ち」
ROLE.Y2 = pickRole((c) => (c.rank === 'B' || c.rank === 'C') && c.basket.some((b) => b.p.cat === 'HT'), (c) => cnt(c, D.R2, D.SALES_END, (l) => l.prod.cat === 'HT' && hasEntry(l.prod, D.R2)) * 10 - cnt(c, D.R2, D.SALES_END) / 10); // 一部合意、据え置きは備考だけ
ROLE.Z1 = pickRole((c) => c.rank === 'C' || c.rank === 'B', (c) => cnt(c, D.R1, d0('2025-02-01'))); // R1の反映漏れ（得意先まるごと）
ROLE.X5 = pickRole((c) => c.rank === 'C' || c.rank === 'B', midScore(50, 120)); // 改定の反映漏れ（得意先まるごと、未修正。CTはR3で登録し直し）
ROLE.N1 = pickRole((c) => c.basket.some((b) => b.p.cat === 'CT'), (c) => cnt(c, D.R2, D.SALES_END, (l) => l.prod.cat === 'CT')); // 一部合意、対象外カテゴリを名前で記入
function d0(s) {
  const [y, m, dd] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, dd) / 86400000);
}

// ---- 前回改定（R2）の合意状況 ----
const CAT_NAME = { BR: 'ベアリング', CT: '切削工具', HT: '作業工具', FS: '締結部品', PN: '空圧機器', TR: '伝動部品', MS: '測定工具', LB: '潤滑剤・ケミカル' };
const DECLINE_NOTES = ['据え置きで継続取引', '他社見積と比較のうえ見送り', '年度予算確定済みのため見送り', '来期に再協議', ''];
const NEGO_NOTES = ['再提示中', '先方決裁待ち', '数量条件と合わせて協議中', ''];
for (const c of customers) {
  if (c.firstOrder >= D.R2) continue;
  const offer = d0('2025-04-07') + rngA.int(0, 40);
  const reply = offer + rngA.int(14, 50);
  const r = { offer, reply, status: '合意', apply: D.R2, applyText: 'R2', kept: [], keptText: '', note: '', amb: null };
  if (c.lastOrder < D.R2) {
    Object.assign(r, { status: '見送り', apply: null, note: '取引縮小のため' });
  } else if (c === ROLE.X2) {
    Object.assign(r, { apply: d0('2025-09-01'), note: '9月納品分から' });
  } else if (c === ROLE.Y1) {
    Object.assign(r, { status: '回答待ち', apply: null, reply: null, note: '担当者交代のため回答待ち', amb: 'AMB1' });
  } else if (c === ROLE.Y2) {
    Object.assign(r, { status: '一部合意', kept: ['HT'], keptText: '', note: '作業工具は据え置き', amb: 'AMB2' });
  } else if (c === ROLE.N1) {
    Object.assign(r, { status: '一部合意', kept: ['CT'], keptText: '切削工具', note: '' });
  } else if ([ROLE.X1, ROLE.X3, ROLE.X4, ROLE.X5, ROLE.Z1].includes(c)) {
    // 合意（初期値）
  } else {
    const w = c.rank === 'S' ? [0.4, 0.3, 0.2, 0.1] : c.rank === 'A' ? [0.6, 0.18, 0.12, 0.1] : [0.68, 0.1, 0.14, 0.08];
    const st = rngA.weighted(['合意', '一部合意', '見送り', '協議中'], w);
    r.status = st;
    if (st === '合意') {
      const u = rngA.next();
      if (u < 0.06) r.apply = null; // 適用日の記入なし（改定日から）
      else if (u < 0.2) {
        const opts = c.closing === '20日' ? ['2025-07-21', '2025-08-21'] : c.closing === '25日' ? ['2025-07-26', '2025-08-01'] : ['2025-08-01', '2025-09-01', '2025-10-01'];
        r.apply = d0(rngA.pick(opts));
        r.note = rngA.pick(['締め後から適用', '在庫消化後に切替', '']);
      }
    } else if (st === '一部合意') {
      const cats = [...R2_CATS].filter((k) => c.basket.some((b) => b.p.cat === k));
      const ks = rngA.shuffle(cats).slice(0, rngA.chance(0.35) ? 2 : 1).sort();
      r.kept = ks;
      r.keptText = ks.join(';');
      r.note = `${ks.map((k) => CAT_NAME[k]).join('・')}は据え置き`;
      if (rngA.chance(0.15)) r.apply = d0('2025-08-01');
    } else if (st === '見送り') {
      r.apply = null;
      r.note = rngA.pick(DECLINE_NOTES);
    } else {
      r.apply = null;
      r.reply = null;
      r.note = rngA.pick(NEGO_NOTES);
    }
  }
  c.r2 = r;
}
const agreedR2 = (c) => {
  const r = M.resp(c, 'R2', 'A');
  return r.agreed ? r : null;
};

// ---- 特値 ----
const noSpecial = new Set([ROLE.X1, ROLE.X2, ROLE.X3, ROLE.X4, ROLE.X5, ROLE.Y1, ROLE.Y2, ROLE.Z1]);
const REASONS = ['大口継続', '競合対策', '新規獲得', '年間契約', 'ライン採用', 'キャンペーン'];
const spCust = customers.filter((c) => !noSpecial.has(c) && (c.rank === 'S' || c.rank === 'A' || (c.rank === 'B' && rngS.chance(0.55)) || (c.rank === 'C' && rngS.chance(0.08))));
const expiredLeakPlans = [];
function maxCost(p, from, to) {
  let m = 0;
  for (const e of p.cost) {
    const end = p.cost[p.cost.indexOf(e) + 1]?.start ?? 1e9;
    if (end > from && e.start <= to) m = Math.max(m, e.sen);
  }
  return m;
}
function addSpecial(c, p, start, end, f, reason, lowMargin = false) {
  const lf = M.listFor(c, p, start);
  if (!lf) return null;
  let price;
  const mc = maxCost(p, Math.max(start, D.SALES_START), Math.min(end ?? 1e9, D.FU_END));
  if (lowMargin) price = Math.ceil((mc * 1.03) / 100);
  else {
    let ff = f;
    for (;;) {
      price = Math.floor((lf.list * c.rate10 * ff) / 1000);
      if (price >= 1000) price = Math.floor(price / 10) * 10;
      if (price * 90 >= mc) break;
      ff += 0.01;
      if (ff > 1.0) return null;
    }
  }
  const s = { cust: c, prod: p, price, start, end, reason, lowMargin };
  specials.push(s);
  const k = key(c, p);
  if (!specialsByPair.has(k)) specialsByPair.set(k, []);
  specialsByPair.get(k).push(s);
  return s;
}
for (const c of spCust) {
  const pairs = [...pairLines.entries()].filter(([k]) => k.startsWith(`${c.code}|`)).map(([, ls]) => ls).filter((ls) => ls.length >= 5).sort((a, b) => b.length - a.length || (a[0].code < b[0].code ? -1 : 1));
  const n = Math.min(pairs.length, c.rank === 'S' ? rngS.int(6, 10) : c.rank === 'A' ? rngS.int(4, 7) : rngS.int(2, 4));
  const chosen = rngS.shuffle(pairs.slice(0, n * 2)).slice(0, n);
  for (const ls of chosen) {
    const p = ls[0].prod;
    if (p.intro) continue;
    const t = rngS.weighted(['T1', 'T2', 'T3', 'T4', 'T5'], [3, 3, 2, 2, 0.6]);
    const f = 0.9 + rngS.next() * 0.06;
    const rs = rngS.pick(REASONS);
    if (t === 'T1' || t === 'T2') {
      const st = d0(t === 'T1' ? '2024-04-01' : '2025-04-01');
      const en = d0(t === 'T1' ? '2025-03-31' : '2026-03-31');
      const s = addSpecial(c, p, st, en, f, rs);
      if (!s) continue;
      const u = rngS.next();
      if (u < 0.38) addSpecial(c, p, en + 1, d0(t === 'T1' ? '2026-03-31' : '2027-03-31'), f + 0.01, rs);
      else if (u < 0.66) {
        // 期限で終了し、正しく通常単価に戻した
      } else expiredLeakPlans.push({ s, fix: rngS.chance(0.45) ? INF : en + rngS.int(60, 240) });
    } else if (t === 'T3') {
      const s = addSpecial(c, p, d0(rngS.pick(['2023-10-01', '2024-01-15'])), null, f, rs);
      if (s && rngS.chance(0.12)) addSpecial(c, p, d0('2025-10-01'), d0('2026-09-30'), f - 0.03, '競合対策'); // 期間の重なり
    } else if (t === 'T4') addSpecial(c, p, d0('2025-10-01'), d0('2026-09-30'), f, rs);
    else {
      const s = addSpecial(c, p, d0('2025-06-01'), d0('2025-08-31'), f - 0.02, 'キャンペーン');
      if (s && rngS.chance(0.6)) expiredLeakPlans.push({ s, fix: d0('2025-08-31') + rngS.int(90, 200) });
    }
  }
}
// 粗利が下限を下回る特値（競合対策で出した値）
{
  const cands = [...pairLines.values()].filter((ls) => ls.length >= 6 && !noSpecial.has(ls[0].cust) && (ls[0].cust.rank === 'S' || ls[0].cust.rank === 'A') && !specialsByPair.has(key(ls[0].cust, ls[0].prod)) && !ls[0].prod.intro).sort((a, b) => b.length - a.length || (a[0].cust.code + a[0].code < b[0].cust.code + b[0].code ? -1 : 1));
  for (const ls of rngS.shuffle(cands.slice(0, 20)).slice(0, 4)) addSpecial(ls[0].cust, ls[0].prod, d0('2025-10-01'), d0('2026-09-30'), 1, '競合対策', true);
}

// ---- 埋め込む「漏れ」（請求のしかた） ----
const injByCust = new Map();
const usedPairs = new Set();
const intent = new Map(); // line -> 意図した種類
function addInj(o) {
  if (!injByCust.has(o.cust.code)) injByCust.set(o.cust.code, []);
  injByCust.get(o.cust.code).push(o);
  if (o.prod) usedPairs.add(key(o.cust, o.prod));
}
const frozen = (c, p, day) => {
  const lf = M.listFor(c, p, day);
  return lf ? M.mul(lf.list, c.rate10) : null;
};
const stuck = (rev, prevDay) => (x, l) => (x.special || !hasEntry(l.prod, rev) ? null : frozen(l.cust, l.prod, prevDay));
addInj({ type: 'cw_stuck_r2', cust: ROLE.X1, prod: null, from: D.R2, to: D.R3, price: stuck(D.R2, D.R2 - 1) });
addInj({ type: 'cw_stuck_r2_deferred', cust: ROLE.X2, prod: null, from: d0('2025-09-01'), to: d0('2025-12-16'), price: stuck(D.R2, D.R2 - 1) });
addInj({ type: 'cw_stuck_r2_open', cust: ROLE.X5, prod: null, from: D.R2, to: INF, price: (x, l) => (l.prod.cat === 'CT' && l.date >= D.R3 ? null : stuck(D.R2, D.R2 - 1)(x, l)) });
addInj({ type: 'cw_stuck_r1', cust: ROLE.Z1, prod: null, from: D.R1, to: d0('2025-02-01'), price: stuck(D.R1, D.R1 - 1) });
addInj({ type: 'cw_rate', cust: ROLE.X3, prod: null, from: 0, to: INF, price: (x) => (x.special ? null : M.mul(x.list, 650)) });
addInj({ type: 'cw_unexplained', cust: ROLE.X4, prod: null, from: d0('2025-11-01'), to: d0('2026-02-01'), price: (x) => (x.special ? null : M.mul(x.list, 760)) });
const freeCust = (c) => !noSpecial.has(c) && c !== ROLE.N1;
const pairCands = (pred) =>
  [...pairLines.entries()]
    .filter(([k, ls]) => !usedPairs.has(k) && freeCust(ls[0].cust) && pred(ls))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
const noSpIn = (ls, from, to) => ls.every((l) => l.date < from || l.date >= to || !M.specialAt(l.cust, l.prod, l.date));
for (const [k, ls] of rngI.shuffle(pairCands((ls) => hasEntry(ls[0].prod, D.R1) && ls.filter((l) => l.date >= D.R1 && l.date < D.R1 + 120).length >= 2 && noSpIn(ls, D.R1, D.R2))).slice(0, 26)) {
  const fix = d0(rngI.pick(['2024-11-21', '2024-12-21', '2025-01-21', '2025-03-01', '2025-04-01']));
  addInj({ type: 'stuck_r1', cust: ls[0].cust, prod: ls[0].prod, from: D.R1, to: fix, price: stuck(D.R1, D.R1 - 1) });
}
for (const [k, ls] of rngI.shuffle(pairCands((ls) => hasEntry(ls[0].prod, D.R1) && hasEntry(ls[0].prod, D.R2) && agreedR2(ls[0].cust) && ls.filter((l) => l.date >= D.R2).length >= 4 && ls.filter((l) => l.date < D.R2 && l.date >= D.R1).length >= 2 && noSpIn(ls, 0, INF))).slice(0, 2)) {
  addInj({ type: 'twice_old', cust: ls[0].cust, prod: ls[0].prod, from: D.R1, to: INF, price: (x, l) => (x.special ? null : frozen(l.cust, l.prod, D.R1 - 1)) });
}
for (const [k, ls] of rngI.shuffle(
  pairCands((ls) => {
    const r = agreedR2(ls[0].cust);
    return r && !r.kept.has(ls[0].prod.cat) && hasEntry(ls[0].prod, D.R2) && ls.filter((l) => l.date >= r.apply).length >= 5 && noSpIn(ls, r.apply, INF);
  }),
).slice(0, 70)) {
  const c = ls[0].cust;
  const p = ls[0].prod;
  const r = agreedR2(c);
  let fix = rngI.chance(0.4) ? INF : d0(rngI.pick(['2025-10-01', '2025-11-21', '2026-01-05', '2026-02-01', '2026-04-01', '2026-06-01']));
  if (p.cat === 'CT' && fix > D.R3) fix = D.R3;
  addInj({ type: 'stuck_r2', cust: c, prod: p, from: r.apply, to: fix, price: stuck(D.R2, r.apply - 1) });
}
for (const [k, ls] of rngI.shuffle(pairCands((ls) => ls[0].prod.cat === 'CT' && ls.filter((l) => l.date >= D.R3).length >= 2 && noSpIn(ls, D.R3, INF))).slice(0, 20)) {
  const fix = rngI.chance(0.5) ? INF : d0(rngI.pick(['2026-06-01', '2026-07-01']));
  addInj({ type: 'stuck_r3', cust: ls[0].cust, prod: ls[0].prod, from: D.R3, to: fix, price: stuck(D.R3, D.R3 - 1) });
}
for (const pl of expiredLeakPlans) {
  const { s, fix } = pl;
  if (usedPairs.has(key(s.cust, s.prod))) continue;
  addInj({ type: 'expired_special', cust: s.cust, prod: s.prod, from: s.end + 1, to: fix, price: (x) => (x.special ? null : s.price) });
}
for (const [k, ls] of rngI.shuffle(pairCands((ls) => ls.length >= 5)).slice(0, 55)) {
  const mid = ls[rngI.int(0, ls.length - 1)].date;
  const from = mid - rngI.int(0, 40);
  const to = mid + rngI.int(30, 200);
  const f = 0.8 + rngI.next() * 0.14;
  addInj({
    type: 'manual',
    cust: ls[0].cust,
    prod: ls[0].prod,
    from,
    to,
    kubun: '手入力',
    price: (x) => {
      if (x.special) return null;
      const v = x.ref * f;
      return x.ref >= 1000 ? Math.floor(v / 10) * 10 : Math.floor(v);
    },
  });
}
// 0円の代品（備考に無償等の言葉なし）と、無償交換
{
  const returned = new Set(allLines.filter((l) => l.kind === 'return').map((l) => l.orig));
  const l12 = saleLines.filter((l) => l.date >= D.L12_START && l.qty <= 3 && !usedPairs.has(key(l.cust, l.prod)) && !noSpecial.has(l.cust) && !l.vol && !returned.has(l));
  const pick = rngI.shuffle(l12).slice(0, 6);
  pick.slice(0, 4).forEach((l) => Object.assign(l, { kind: 'daihin', billed: 0, remark: '不良交換品（代品）', vol: null }));
  pick.slice(4).forEach((l) => Object.assign(l, { kind: 'sample', billed: 0, remark: '無償交換（初期不良）', vol: null }));
}

// ---- 単価を決める ----
function findInj(l, x) {
  for (const o of injByCust.get(l.cust.code) ?? []) {
    if (o.prod && o.prod !== l.prod) continue;
    if (l.date < o.from || l.date >= o.to) continue;
    const v = o.price(x, l);
    if (v !== null && v !== undefined && v !== x.ref) return { o, v };
  }
  return null;
}
for (const l of allLines) {
  if (l.kind === 'freight' || l.kind === 'sample' || l.kind === 'daihin') {
    l.kubun = l.kind === 'freight' ? '標準' : '手入力';
    continue;
  }
  if (l.kind === 'return') continue;
  const x = M.ctx(l.cust, l.prod, l.date, 'A');
  const hit = findInj(l, x);
  if (hit) {
    l.billed = hit.v;
    l.remark = '';
    l.vol = null;
    l.kubun = hit.o.kubun ?? '得意先';
    intent.set(l, hit.o.type);
  } else if (l.vol) {
    l.billed = Math.floor((x.ref * (10000 - l.vol)) / 10000);
    l.kubun = '手入力';
  } else {
    l.billed = x.ref;
    l.kubun = x.special || x.reason !== 'std' || x.ref !== M.mul(x.sys, l.cust.rate10) ? '得意先' : '標準';
  }
}
for (const l of allLines) {
  if (l.kind !== 'return') continue;
  l.billed = l.orig.billed;
  l.kubun = l.orig.kubun;
}

// ---- 反映チェック（next/）：次回改定（2026-10-01）の協議結果・新単価マスタ・10月分の売上 ----
const active = customers.filter((c) => c.lastOrder === INF);
for (const c of active) {
  if (!saleLines.some((l) => l.cust === c && l.date >= d0('2026-03-01'))) continue;
  const st = rngF.weighted(['合意', '一部合意', '適用日変更', '見送り', '協議中'], [0.6, 0.12, 0.08, 0.1, 0.1]);
  const r = { status: st, apply: D.R4, kept: [], keptText: '', note: '' };
  if (st === '合意' && rngF.chance(0.05)) r.apply = null;
  if (st === '一部合意') {
    const cats = [...R4_CATS].filter((k) => c.basket.some((b) => b.p.cat === k));
    r.kept = rngF.shuffle(cats).slice(0, 1);
    r.keptText = r.kept.join(';');
    r.note = `${r.kept.map((k) => CAT_NAME[k]).join('・')}は据え置き`;
  }
  if (st === '適用日変更') {
    r.apply = d0('2026-11-01');
    r.note = '11月出荷分から';
  }
  if (st === '見送り' || st === '協議中') {
    r.apply = null;
    r.note = st === '協議中' ? rngF.pick(['先方決裁待ち', '再提示中']) : rngF.pick(['据え置き', '他社比較中']);
  }
  c.r4 = r;
}
const master = new Map(); // key -> {cust, prod, eff, newP, curP}
for (const c of active) {
  const r = c.r4;
  if (!r || r.status === '見送り' || r.status === '協議中') continue;
  const eff = r.apply ?? D.R4;
  const bought = new Set(saleLines.filter((l) => l.cust === c && l.date >= D.L12_START).map((l) => l.prod));
  for (const p of [...bought].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    if (p.histFu.length === p.hist.length) continue;
    if (r.kept.includes(p.cat)) continue;
    if (M.specialAt(c, p, D.R4 - 1) || M.specialAt(c, p, eff)) continue;
    const cur = M.ctx(c, p, D.R4 - 1, 'A').ref;
    const newP = M.mul(p.histFu[p.histFu.length - 1].price, c.rate10);
    if (newP <= cur) throw new Error('新単価が現単価以下');
    master.set(key(c, p), { cust: c, prod: p, eff, newP, curP: cur });
  }
}
let fuSlips = genSlips(D.FU_START, D.FU_END, rngF, true);
fuSlips = addReturns(fuSlips, rngF, D.FU_END, true, 0.008);
const fuLines = fuSlips.flatMap((s) => s.lines);
// 反映漏れの埋め込み
const fuCands = active.filter((c) => c.r4 && c.r4.status === '合意' && c.r4.apply === D.R4).map((c) => ({ c, n: [...master.values()].filter((m) => m.cust === c).length, f: fuLines.filter((l) => l.cust === c && l.kind === 'sale' && master.has(key(c, l.prod))).length })).filter((x) => x.f >= 8).sort((a, b) => b.f - a.f || (a.c.code < b.c.code ? -1 : 1));
const F1 = fuCands[Math.min(3, fuCands.length - 1)].c;
const F2 = fuCands[Math.min(6, fuCands.length - 1)].c;
const fuMissPairs = new Set(rngF.shuffle([...master.keys()].filter((k) => !k.startsWith(`${F1.code}|`) && !k.startsWith(`${F2.code}|`)).sort()).slice(0, Math.round(master.size * 0.09)));
for (const l of fuLines) {
  if (l.kind === 'freight' || l.kind === 'sample') {
    l.kubun = l.kind === 'freight' ? '標準' : '手入力';
    l.pattern = l.kind === 'freight' ? 'non_product' : 'sample';
    continue;
  }
  if (l.kind === 'return') continue;
  const k = key(l.cust, l.prod);
  const m = master.get(k);
  if (!m) {
    const x = M.ctx(l.cust, l.prod, l.date, 'A', true);
    l.billed = l.vol ? Math.floor((x.ref * (10000 - l.vol)) / 10000) : x.ref;
    l.kubun = l.vol ? '手入力' : x.special || x.ref !== M.mul(x.sys, l.cust.rate10) ? '得意先' : '標準';
    l.pattern = 'not_in_master';
    continue;
  }
  if (l.date < m.eff) {
    Object.assign(l, { billed: m.curP, kubun: '得意先', pattern: 'deferred_customer', vol: null, remark: '' });
  } else if (l.cust === F1) {
    Object.assign(l, { billed: m.curP, kubun: '得意先', pattern: 'customer_wide_all_month', vol: null, remark: '' });
  } else if (l.cust === F2 && l.date < d0('2026-10-09')) {
    Object.assign(l, { billed: m.curP, kubun: '得意先', pattern: 'customer_wide_until_1008', vol: null, remark: '' });
  } else if (fuMissPairs.has(k)) {
    Object.assign(l, { billed: m.curP, kubun: '得意先', pattern: 'pair_missed', vol: null, remark: '' });
  } else if (l.vol) {
    Object.assign(l, { billed: Math.floor((m.newP * (10000 - l.vol)) / 10000), kubun: '手入力', pattern: 'vol_discount' });
  } else Object.assign(l, { billed: m.newP, kubun: '得意先', pattern: 'normal' });
}
for (const l of fuLines) {
  if (l.kind !== 'return') continue;
  l.billed = l.orig.billed;
  l.kubun = l.orig.kubun;
  l.pattern = 'return';
}

writeAll({ DATA, SEALED, M, products, customers, specials, slips, fuSlips, master, intent, ROLE, F1, F2 });
