// 架空の世界を作る：商品（定価・原価の履歴）、得意先、改定の合意状況、特値、請求の仕組み（漏れの種）。
import { RNG, hashStr, dn, bizDays, isBiz, mulRate } from './util.mjs';
import {
  CATS, FAMILIES, DISC_ITEMS, TIERS, CTYPES, NAME_STEMS, SALES_REPS, OFFICES, PREFS, DEPTS, SPECIAL_REASONS,
} from './catalog.mjs';

export const SEED = 3030;
export const INF = dn(9999, 12, 31);
export const K = {
  INIT: dn(2023, 4, 1),
  R0: dn(2024, 10, 1),
  R1: dn(2025, 10, 1),
  R2: dn(2026, 4, 1), // 前回の改定（合意状況ファイルが答えている改定）
  R3: dn(2026, 11, 1), // 次回の改定（next/ の反映チェック用）
  S_START: dn(2025, 1, 6),
  S_END: dn(2026, 9, 30),
  W_START: dn(2025, 10, 1),
  NOV_FROM: dn(2026, 11, 1),
  NOV_TO: dn(2026, 11, 30),
};

const unitFor = (p) => (p < 1000 ? 10 : p < 10000 ? 50 : 100);
const roundNear = (p) => {
  const u = unitFor(p);
  return Math.max(u, Math.round(p / u) * u);
};
const roundUp = (x) => {
  const u = unitFor(x);
  return Math.ceil(x / u - 1e-9) * u;
};

export const REVS = [
  { id: 'R0', date: K.R0, pct: { WD: 6, IN: 5, EX: 4, HW: 7, PA: 5, EL: 3 }, cov: 0.6 },
  { id: 'R1', date: K.R1, pct: { WD: 5, IN: 4, EX: 6, IT: 5, WH: 6, SN: 4, KB: 5, HW: 5 }, cov: 0.6 },
  { id: 'R2', date: K.R2, pct: { WD: 7, IN: 6, EX: 5, IT: 6, HW: 8, WH: 5, SN: 6, PA: 7 }, cov: 0.65 },
  { id: 'R3', date: K.R3, pct: { WD: 6, IN: 5, EX: 4, IT: 5, HW: 6, WH: 7, SN: 5, KB: 6, EL: 4, PA: 5 }, cov: 0.55 },
];

// 仕入先ごとの仕入値上げ（原単価の改定）
export const COST_EVENTS = [
  { date: dn(2024, 12, 1), sup: { S01: 5, S02: 4, S10: 3 } },
  { date: dn(2025, 2, 1), sup: { S03: 6, S04: 5 } },
  { date: dn(2025, 8, 1), sup: { S05: 4, S06: 6, S07: 5, S12: 3 } },
  { date: dn(2025, 12, 1), sup: { S01: 6, S02: 5, S08: 4 } },
  { date: dn(2026, 2, 1), sup: { S10: 5, S11: 4, S09: 3, S13: 7 } },
  { date: dn(2026, 7, 1), sup: { S03: 5, S04: 5, S06: 4, S07: 6 } },
];

function lastDayOfMonth(n) {
  const t = new Date(n * 86400000);
  return Math.round(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0) / 86400000);
}
function firstDayOfMonth(n) {
  const t = new Date(n * 86400000);
  return Math.round(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) / 86400000);
}

// ---------------------------------------------------------------- 商品
function buildProducts() {
  const rng = new RNG(hashStr('catalog:' + SEED));
  const products = [];
  for (const cat of CATS) {
    let counter = 0;
    let famIdx = 0;
    for (const fam of FAMILIES[cat.code]) {
      for (const [label, mult] of fam[3]) {
        counter += rng.int(1, 3);
        const base = roundNear(fam[2] * mult * rng.range(0.97, 1.03));
        const ratio = rng.range(cat.ratio[0], cat.ratio[1]);
        const sh = cat.shares.map((s) => s + rng.int(-3, 3));
        sh[3] += 100 - sh.reduce((a, b) => a + b, 0);
        products.push({
          code: `${cat.code}-${cat.base + counter}`,
          name: `${fam[0]} ${label}`,
          unit: fam[1],
          cat: cat.code,
          sup: cat.sup[famIdx % cat.sup.length],
          base,
          ratio,
          shares: sh,
          pop: rng.lognormal(0.9),
          launch: null,
          disc: null,
          inMaster: true,
        });
      }
      famIdx++;
    }
  }
  // 新商品（期間中に発売）
  const order = rng.shuffle(products.map((_, i) => i));
  const days = bizDays(dn(2025, 2, 3), dn(2026, 8, 17));
  for (let k = 0; k < 14; k++) products[order[k]].launch = days[rng.int(0, days.length - 1)];
  const isNew = new Set(order.slice(0, 14));
  // 個別の定価訂正（改定ではない）
  const adhoc = new Map();
  const adhocDays = bizDays(dn(2025, 2, 3), dn(2026, 2, 27));
  let cnt = 0;
  for (const idx of order.slice(14)) {
    if (cnt >= 14) break;
    adhoc.set(idx, { date: adhocDays[rng.int(0, adhocDays.length - 1)], pct: (rng.chance(0.7) ? 1 : -1) * rng.range(3, 6) });
    cnt++;
  }
  products.forEach((p, idx) => {
    const start = p.launch ?? K.INIT;
    let price0 = p.base;
    if (p.launch) {
      let g = 1;
      for (const rev of REVS) if (rev.date < p.launch && rev.pct[p.cat]) g *= 1 + (rev.pct[p.cat] * 0.6) / 100;
      price0 = roundUp(p.base * g);
    }
    const evs = [];
    for (const rev of REVS) {
      const r1 = rng.next();
      const r2 = rng.range(0.75, 1.3);
      if (start < rev.date && rev.pct[p.cat] && r1 < rev.cov) evs.push({ date: rev.date, pct: rev.pct[p.cat] * r2, rev: rev.id });
    }
    if (adhoc.has(idx)) evs.push({ date: adhoc.get(idx).date, pct: adhoc.get(idx).pct, rev: null });
    evs.sort((a, b) => a.date - b.date);
    const versions = [{ start, price: price0 }];
    let cur = price0;
    for (const ev of evs) {
      const x = cur * (1 + ev.pct / 100);
      let np = ev.pct > 0 ? roundUp(x) : roundNear(x);
      if (np === cur) np = cur + (ev.pct > 0 ? unitFor(cur) : -unitFor(cur));
      versions.push({ start: ev.date, price: np, rev: ev.rev });
      cur = np;
    }
    p.versionsAll = versions;
    p.versions = versions.filter((v) => v.start <= K.S_END);
    p.start = start;
    p.revAt = {};
    for (const v of versions) if (v.rev) p.revAt[v.rev] = true;
    // 原単価の履歴
    const costs = [{ start, c100: Math.round(price0 * p.ratio * 100) }];
    for (const ev of COST_EVENTS) {
      const pc = ev.sup[p.sup];
      const r1 = rng.next();
      const r2 = rng.range(0.6, 1.4);
      if (ev.date > start && pc && r1 < 0.92) {
        const last = costs[costs.length - 1].c100;
        let c = Math.round(last * (1 + (pc * r2) / 100));
        if (c <= last) c = last + 1;
        costs.push({ start: ev.date, c100: c });
      }
    }
    p.costs = costs;
  });
  // 廃番（商品マスタから消えた旧品）
  const ghosts = [];
  const gdays = bizDays(dn(2025, 3, 31), dn(2025, 11, 28));
  DISC_ITEMS.forEach((it, i) => {
    const cat = CATS.find((c) => c.code === it[0]);
    const price = roundNear(it[3]);
    const ratio = rng.range(0.42, 0.5);
    ghosts.push({
      code: `${cat.code}-${cat.base + 90 + i}`,
      name: it[1],
      unit: it[2],
      cat: cat.code,
      sup: cat.sup[0],
      base: price,
      ratio,
      shares: cat.shares,
      pop: rng.lognormal(0.9) * 1.3,
      launch: null,
      disc: gdays[rng.int(0, gdays.length - 1)],
      inMaster: false,
      versionsAll: [{ start: K.INIT, price }],
      versions: [{ start: K.INIT, price }],
      start: K.INIT,
      revAt: {},
      costs: [{ start: K.INIT, c100: Math.round(price * ratio * 100) }],
    });
  });
  return { products, ghosts };
}

export function priceAt(p, d) {
  let r = null;
  for (const v of p.versionsAll) if (v.start <= d) r = v.price;
  return r;
}
export function costAt(p, d) {
  let r = p.costs[0].c100;
  for (const c of p.costs) if (c.start <= d) r = c.c100;
  return r;
}
export function available(p, d) {
  if (d < p.start) return false;
  if (p.disc !== null && d > p.disc) return false;
  return true;
}

// ---------------------------------------------------------------- 得意先
function buildCustomers(products) {
  const rng = new RNG(hashStr('cust:' + SEED));
  const stems = rng.shuffle(NAME_STEMS);
  let si = 0;
  const customers = [];
  const seq = { 1: 0, 2: 0, 3: 0 };
  const tierMult = { S: 1.7, A: 1.9, B: 1.2, C: 0.8, D: 0.5 };
  for (const type of CTYPES) {
    const tiersList = type.tiers.length === 1 ? Array(type.n).fill(type.tiers[0]) : type.tiers;
    if (tiersList.length !== type.n) throw new Error(`tiers length mismatch ${type.key}: ${tiersList.length}/${type.n}`);
    const group = [];
    for (let i = 0; i < type.n; i++) group.push({ size: type.size * rng.lognormal(0.5) });
    group.sort((a, b) => b.size - a.size);
    group.forEach((g, i) => {
      const stem = stems[si++];
      const suffix = rng.pick(type.suf);
      const baseName = stem + suffix;
      let form = '';
      let formStyle = 0;
      if (type.key !== '一人親方') {
        form = rng.pick(['株式会社', '株式会社', '株式会社', '有限会社', '有限会社', '合同会社']);
        formStyle = rng.chance(0.12) ? 1 : 0;
      }
      const ab = form === '株式会社' ? '株' : form === '有限会社' ? '有' : form === '合同会社' ? '合' : '';
      const name = !form ? baseName : formStyle ? baseName + form : form + baseName;
      const abbr = !form ? baseName : formStyle ? `${baseName}(${ab})` : `(${ab})${baseName}`;
      const office = OFFICES[rng.weightedIndex([0.5, 0.28, 0.22])];
      const bd = OFFICES.indexOf(office) + 1;
      seq[bd] += rng.int(3, 29);
      const code = `${bd}${String(seq[bd]).padStart(4, '0')}`;
      const tier = tiersList[i];
      const T = TIERS[tier];
      let rate1000 = T.std + rng.pick([-10, -5, 0, 0, 0, 5, 10]);
      rate1000 = Math.min(T.hi, Math.max(T.lo, rate1000));
      const prefList = PREFS[office];
      customers.push({
        code,
        code6: code.padStart(6, '0'),
        name,
        abbr,
        type: type.key,
        tier,
        rate1000,
        office,
        rep: rng.pick(SALES_REPS),
        pref: rng.pick(prefList),
        closing: rng.pick(['20日', '末日', '末日', '25日', '15日']),
        dept: rng.pick(DEPTS),
        size: g.size,
        freq: Math.pow(g.size, 0.8) * tierMult[tier] * rng.lognormal(0.35),
        pref_w: type.pref,
        tradeStart: dn(2008, 1, 1) + rng.int(0, dn(2023, 12, 31) - dn(2008, 1, 1)),
        first: K.S_START,
        last: dn(2027, 12, 31),
        regPct: { S: 85, A: 75, B: 55, C: 25, D: 8 }[tier],
        ghost: false,
        surname: stem,
      });
    });
  }
  // 取引の始まりと終わり
  const byIdx = rng.shuffle(customers.map((_, i) => i));
  let k = 0;
  const newDays = [dn(2025, 3, 10), dn(2025, 6, 2), dn(2025, 11, 17), dn(2026, 2, 9), dn(2026, 4, 20), dn(2026, 5, 18), dn(2026, 7, 6)];
  for (const d of newDays) {
    const c = customers[byIdx[k++]];
    c.tradeStart = d;
    c.first = d;
  }
  const endDays = [dn(2025, 5, 30), dn(2025, 9, 12), dn(2025, 12, 19), dn(2026, 3, 13)];
  for (const d of endDays) {
    const c = customers[byIdx[k++]];
    c.last = d;
  }
  // 商品の取扱い（得意先ごとのレパートリー）
  const universe = products.concat([]);
  for (const c of customers) buildRep(c, universe, rng);
  customers.sort((a, b) => (a.code < b.code ? -1 : 1));
  return customers;
}

function buildRep(c, universe, rng, forceN) {
  const catF = {};
  for (const cat of CATS) catF[cat.code] = (c.pref_w[cat.code] ?? 0.5) * rng.lognormal(0.4);
  const ws = universe.map((p) => p.pop * catF[p.cat]);
  const n = forceN ?? Math.max(8, Math.min(95, Math.round(9 + c.size * 13 * rng.lognormal(0.3))));
  const rep = [];
  for (let i = 0; i < n; i++) {
    const idx = rng.weightedIndex(ws);
    rep.push({ p: universe[idx], w: universe[idx].pop * rng.lognormal(0.5) });
    ws[idx] = 0;
    if (ws.every((x) => x === 0)) break;
  }
  c.items = rep;
  c.itemW = rep.map((r) => r.w);
}

function buildExtraCustomers(products, ghosts) {
  const rng = new RNG(hashStr('extra:' + SEED));
  const out = [];
  const mk = (code, name, abbr, first, last, freq, nrep) => {
    const c = {
      code, code6: code.padStart(6, '0'), name, abbr, type: '', tier: 'C', rate1000: 780, office: '本社営業部', size: 0.7,
      freq, pref_w: {}, first, last, regPct: 0, ghost: true, surname: '',
    };
    buildRep(c, products.concat(ghosts), rng, nrep);
    out.push(c);
  };
  mk('10990', '株式会社旧村田建設', '(株)旧村田建設', K.S_START, dn(2025, 7, 25), 0.5, 20);
  mk('20877', '有限会社旧岡崎工務店', '(有)旧岡崎工務店', K.S_START, dn(2025, 4, 30), 0.45, 15);
  mk('31504', '旧藤本内装', '旧藤本内装', K.S_START, dn(2025, 10, 31), 0.4, 14);
  mk('99999', '現金売上', '現金売上', K.S_START, dn(2027, 1, 31), 0.55, 60);
  return out;
}

// ---------------------------------------------------------------- 改定の合意状況
const R2_CATS = Object.keys(REVS[2].pct);
const R3_CATS = Object.keys(REVS[3].pct);

function assignAgreements(customers, rev, revCats, cfg, rng) {
  const ag = new Map();
  const elig = customers.filter((c) => !c.ghost && c.tradeStart < cfg.maxStart && c.last >= cfg.minLast);
  for (const c of elig) {
    const big = c.size > 1.8;
    const ws = [
      big ? 0.28 : 0.36, // agree_blank
      0.15, // agree_date
      big ? 0.2 : 0.14, // deferred
      0.02, // deferred_status
      big ? 0.16 : 0.08, // partial
      0.08, // declined
      big ? 0.1 : 0.06, // negotiating
      0.11, // none
    ];
    const kind = ['agree_blank', 'agree_date', 'deferred', 'deferred_status', 'partial', 'declined', 'negotiating', 'none'][rng.weightedIndex(ws)];
    if (kind === 'none') continue;
    const askDay = cfg.askFrom + rng.int(0, cfg.askSpan);
    const rec = { c, kind, status: 'agreed', text: '合意', apply: null, excl: new Set(), note: '', ask: askDay, ans: Math.min(cfg.ansMax, askDay + rng.int(5, 45)) };
    if (kind === 'agree_date') rec.apply = rev;
    else if (kind === 'deferred') {
      rec.apply = cfg.deferDates[rng.weightedIndex(cfg.deferW)];
      rec.note = rng.pick(['年度切替に合わせて', '現場の都合で', '']);
    } else if (kind === 'deferred_status') {
      rec.apply = cfg.deferDates[rng.int(0, 1)];
      rec.text = '適用日変更';
      rec.note = '';
    } else if (kind === 'partial') {
      rec.status = 'partial';
      rec.text = '一部合意';
      const n = rng.int(1, 3);
      const cs = rng.shuffle(revCats).slice(0, n);
      cs.forEach((x) => rec.excl.add(x));
      rec.note = cs.map((x) => CATS.find((t) => t.code === x).name).join('・') + 'は据え置き';
      if (rng.chance(0.4)) rec.apply = rev;
    } else if (kind === 'declined') {
      rec.status = 'declined';
      rec.text = rng.pick(['見送り', '見送り', '見送り', '合意に至らず']);
      rec.note = rng.pick(['今期は見送りたいとの回答', '先方の予算の都合', '現行価格で継続']);
    } else if (kind === 'negotiating') {
      rec.status = 'negotiating';
      rec.text = '協議中';
      rec.ans = null;
      rec.note = rng.pick(['再見積り依頼中', '社長面談待ち', '', '条件調整中']);
    } else if (kind === 'agree_blank') {
      rec.apply = null;
    }
    ag.set(c.code, rec);
  }
  return ag;
}

// ---------------------------------------------------------------- 全体
export function buildWorld() {
  const w = {};
  const { products, ghosts } = buildProducts();
  w.products = products;
  w.ghosts = ghosts;
  w.allProducts = products.concat(ghosts);
  w.prodByCode = new Map(w.allProducts.map((p) => [p.code, p]));
  const cust = buildCustomers(products);
  const extra = buildExtraCustomers(products, ghosts);
  w.masterCustomers = cust;
  w.customers = cust.concat(extra).sort((a, b) => (a.code < b.code ? -1 : 1));
  w.custByCode = new Map(w.customers.map((c) => [c.code, c]));

  const rngA = new RNG(hashStr('agree:' + SEED));
  // 前回改定（R2）の合意状況
  const ag2 = assignAgreements(cust, K.R2, R2_CATS, {
    maxStart: dn(2026, 2, 1), minLast: K.R2, askFrom: dn(2026, 1, 14), askSpan: 40, ansMax: dn(2026, 3, 27),
    deferDates: [dn(2026, 5, 1), dn(2026, 6, 1), dn(2026, 7, 1), dn(2026, 10, 1)], deferW: [3, 2, 2, 1],
  }, rngA);
  // 判断が分かれる部分合意：対象外カテゴリが書かれていない2社（大きめの agree_blank から）
  const cands = cust.filter((c) => ag2.get(c.code)?.kind === 'agree_blank' && c.size > 1.0 && c.tier !== 'S').sort((a, b) => b.freq - a.freq);
  w.ambigPartial = [cands[2], cands[5]];
  for (const c of w.ambigPartial) {
    const r = ag2.get(c.code);
    r.kind = 'partial_nocat';
    r.status = 'partial';
    r.text = '一部合意';
    r.note = '一部商品は据え置き（品目は別途連絡）';
    r.excl = new Set();
    r.apply = null;
  }
  w.ag2 = ag2;
  // 次回改定（R3）の協議結果（next/ 用）
  const rngB = new RNG(hashStr('agree3:' + SEED));
  w.ag3 = assignAgreements(cust, K.R3, R3_CATS, {
    maxStart: dn(2026, 9, 1), minLast: dn(2026, 11, 1), askFrom: dn(2026, 7, 6), askSpan: 40, ansMax: dn(2026, 10, 20),
    deferDates: [dn(2026, 12, 1), dn(2027, 1, 1), dn(2026, 11, 16), dn(2027, 2, 1)], deferW: [4, 5, 1, 1],
  }, rngB);
  w.negotiated = [{ date: K.R2, ag: ag2 }, { date: K.R3, ag: w.ag3 }];

  w.segCache = new Map();
  buildSpecials(w);
  buildRegimes(w);
  return w;
}

// ---------------------------------------------------------------- 得意先別の定価
export function segsOf(w, c, p) {
  const key = c.code + '|' + p.code;
  let s = w.segCache.get(key);
  if (s) return s;
  const vs = p.versionsAll.map((v) => ({ start: v.start, price: v.price, drop: false }));
  for (const rev of w.negotiated) {
    const i = vs.findIndex((v, idx) => idx > 0 && v.start === rev.date);
    if (i < 0) continue;
    const ag = rev.ag.get(c.code);
    if (!ag) continue;
    const kept = ag.status === 'declined' || ag.status === 'negotiating' || (ag.status === 'partial' && ag.excl.has(p.cat));
    if (kept) vs[i].drop = true;
    else if (ag.apply && ag.apply > rev.date) vs[i].start = ag.apply;
  }
  const out = [];
  for (const v of vs) {
    if (v.drop) continue;
    if (out.length && out[out.length - 1].price === v.price) continue;
    out.push({ start: v.start, price: v.price });
  }
  w.segCache.set(key, out);
  return out;
}
export function listFor(w, c, p, d) {
  const s = segsOf(w, c, p);
  let r = null;
  for (const x of s) if (x.start <= d) r = x.price;
  return r;
}
export function prevListFor(w, c, p, d) {
  const s = segsOf(w, c, p);
  let idx = -1;
  for (let i = 0; i < s.length; i++) if (s[i].start <= d) idx = i;
  return idx > 0 ? s[idx - 1].price : null;
}

// ---------------------------------------------------------------- 特値
function buildSpecials(w) {
  const rng = new RNG(hashStr('special:' + SEED));
  const specials = [];
  const used = new Set();
  const cs = w.masterCustomers.filter((c) => c.size > 0.8 && c.first <= dn(2026, 4, 1));
  const cw = cs.map((c) => c.size * c.size);
  let attempts = 0;
  while (specials.length < 220 && attempts < 6000) {
    attempts++;
    const c = cs[rng.weightedIndex(cw)];
    const e = c.items[rng.weightedIndex(c.itemW)];
    const p = e.p;
    if (!p.inMaster) continue;
    if (p.base > 100000 && !rng.chance(0.2)) continue;
    const key = c.code + '|' + p.code;
    if (used.has(key)) continue;
    let start = dn(2024, 7, 1) + rng.int(0, dn(2026, 6, 30) - dn(2024, 7, 1));
    if (rng.chance(0.6)) start = firstDayOfMonth(start);
    if (start < p.start) continue;
    let end = start + rng.int(60, 420);
    if (rng.chance(0.6)) end = lastDayOfMonth(end);
    if (rng.chance(0.08)) end = INF;
    const L = listFor(w, c, p, start);
    if (!L) continue;
    const normal = mulRate(L, c.rate1000);
    const cost = costAt(p, start);
    const kind = rng.next();
    let price;
    if (kind < 0.86) price = Math.floor(normal * (1 - rng.range(0.04, 0.13)));
    else if (kind < 0.9) price = Math.ceil(cost / 100 / (1 - rng.range(0.06, 0.09)));
    else price = Math.ceil(cost / 100 / (1 - rng.range(0.115, 0.135)));
    if (kind < 0.86 && price < Math.ceil(cost / 100 / 0.88)) continue;
    if (price >= normal || price < 20) continue;
    used.add(key);
    specials.push({ c, p, price, start, end, reason: rng.pick(SPECIAL_REASONS) });
  }
  // 期間が重なる特値（新しい開始日のほうが有効）
  const base = specials.filter((s) => s.end !== INF && s.end - s.start >= 150);
  for (let i = 0; i < 5 && i < base.length; i++) {
    const s = base[i * 3 < base.length ? i * 3 : i];
    const st = s.start + rng.int(40, 100);
    const en = Math.min(s.end - 10, st + rng.int(30, 90));
    specials.push({ c: s.c, p: s.p, price: Math.floor(s.price * rng.range(0.93, 0.97)), start: st, end: en, reason: '現場特値', overlap: true });
  }
  specials.sort((a, b) => (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : a.p.code < b.p.code ? -1 : a.p.code > b.p.code ? 1 : a.start - b.start));
  specials.forEach((s, i) => (s.id = i + 1));
  w.specials = specials;
  w.specialMap = new Map();
  for (const s of specials) {
    const k = s.c.code + '|' + s.p.code;
    if (!w.specialMap.has(k)) w.specialMap.set(k, []);
    w.specialMap.get(k).push(s);
  }
}
export function specialAt(w, c, p, d) {
  const arr = w.specialMap.get(c.code + '|' + p.code);
  if (!arr) return null;
  let best = null;
  for (const s of arr) if (s.start <= d && d <= s.end) if (!best || s.start > best.start || (s.start === best.start && s.id > best.id)) best = s;
  return best;
}

// ---------------------------------------------------------------- 請求の仕組み（漏れの種）
export const PST = { r0: 0.08, r1: 0.1, r2: 0.11, manual: 32, unexp: 6, inf: 0.08 };
function buildRegimes(w) {
  const rng = new RNG(hashStr('regime:' + SEED));
  const reg = new Map();
  w.custRegimes = new Map(); // 得意先全体
  const add = (c, p, r) => {
    const k = c.code + '|' + p.code;
    if (!reg.has(k)) reg.set(k, []);
    reg.get(k).push(r);
  };
  const mc = w.masterCustomers;
  // 得意先まるごと更新漏れ
  const pickBy = (filter, rank) => mc.filter(filter).sort((a, b) => b.freq - a.freq)[rank];
  const ag2 = w.ag2;
  const cA = pickBy((c) => ag2.get(c.code)?.kind === 'agree_blank' && c.tier === 'B' && c.first <= K.R2 && !w.ambigPartial.includes(c), 3);
  const cB = pickBy((c) => c.tier === 'C' && c.first <= K.R1 && c.last >= dn(2026, 3, 1), 4);
  const cC = pickBy((c) => c.tier === 'C' && c.first <= K.R1 && c.last >= K.S_END && c !== cB, 8);
  w.staleAll = [
    { c: cA, from: K.R2, to: dn(2026, 10, 20) },
    { c: cB, from: K.R1, to: dn(2026, 2, 20) },
    { c: cC, from: K.R1, to: dn(2026, 10, 15) },
  ];
  for (const sa of w.staleAll) {
    for (const e of sa.c.items) {
      const p = e.p;
      if (!p.inMaster) continue;
      const segs = segsOf(w, sa.c, p);
      const idx = segs.findIndex((s, i) => i > 0 && s.start === sa.from);
      if (idx < 0) continue;
      add(sa.c, p, { type: 'stale', from: sa.from, to: sa.to, frozen: segs[idx - 1].price, tag: 'cust' });
    }
  }
  // 得意先マスタの掛率の誤り
  const cD = pickBy((c) => c.tier === 'C' && c.first <= K.S_START && c !== cB && c !== cC, 24);
  const cE = pickBy((c) => c.tier === 'B' && c.first <= dn(2025, 8, 1) && c !== cA, 14);
  const cF = pickBy((c) => c.tier === 'D' && c.rate1000 >= TIERS.D.std - 10 && c.first <= dn(2025, 5, 1), 2);
  w.custRate = [
    { c: cD, from: K.S_START, to: dn(2026, 10, 12), rate1000: TIERS.B.std },
    { c: cE, from: dn(2025, 9, 1), to: dn(2026, 2, 28), rate1000: TIERS.S.std + 20 },
  ];
  w.custUnexp = [{ c: cF, from: dn(2025, 6, 1), to: dn(2026, 10, 5), delta10: 10 }];
  for (const r of [...w.custRate, ...w.custUnexp]) {
    if (!w.custRegimes.has(r.c.code)) w.custRegimes.set(r.c.code, []);
    w.custRegimes.get(r.c.code).push(r.rate1000 !== undefined ? { type: 'custrate', from: r.from, to: r.to, rate1000: r.rate1000 } : { type: 'custunexp', from: r.from, to: r.to, delta10: r.delta10 });
  }
  // 商品ごとの更新漏れ
  for (const c of mc) {
    if (w.staleAll.some((s) => s.c === c)) continue;
    for (const e of c.items) {
      const p = e.p;
      if (!p.inMaster) continue;
      const segs = segsOf(w, c, p);
      for (let i = 1; i < segs.length; i++) {
        const T = segs[i].start;
        const rv = T === K.R0 && p.revAt.R0 ? 'r0' : T === K.R1 && p.revAt.R1 ? 'r1' : T >= K.R2 && T <= K.S_END && p.revAt.R2 ? 'r2' : null;
        if (!rv) continue;
        if (c.tradeStart >= T) continue;
        const ambig = w.ambigPartial.includes(c) && rv === 'r2';
        const prob = PST[rv];
        const hit = ambig ? rng.chance(0.45) : rng.chance(prob);
        if (!hit) continue;
        const inf = ambig || rng.chance(PST.inf);
        let to;
        if (inf) to = INF;
        else if (rv === 'r0') to = K.S_START + rng.int(10, 270);
        else to = T + (rv === 'r2' ? rng.int(20, 170) : rng.int(20, 330));
        add(c, p, { type: 'stale', from: T, to, frozen: segs[i - 1].price, tag: ambig ? 'ambig' : 'pair' });
      }
    }
  }
  // 手入力単価（掛率ランク外）・原因不明の差
  const pairs = [];
  for (const c of mc) for (const e of c.items) if (e.p.inMaster) pairs.push([c, e.p, c.freq * e.w]);
  const pw = pairs.map((x) => x[2]);
  const usedPair = new Set();
  const takePair = (filter) => {
    for (let t = 0; t < 400; t++) {
      const x = pairs[rng.weightedIndex(pw)];
      const k = x[0].code + '|' + x[1].code;
      if (usedPair.has(k) || w.specialMap.has(k) || reg.has(k) || w.custRegimes.has(x[0].code) || w.staleAll.some((s) => s.c === x[0])) continue;
      if (filter && !filter(x[0], x[1])) continue;
      usedPair.add(k);
      return x;
    }
    return null;
  };
  for (let i = 0; i < PST.manual; i++) {
    const x = takePair();
    if (!x) continue;
    const from = K.S_START + rng.int(0, K.S_END - K.S_START - 30);
    const to = rng.chance(0.15) ? INF : from + rng.int(30, 300);
    add(x[0], x[1], { type: 'manual', from: Math.max(from, x[1].start), to, delta10: rng.int(55, 110) });
  }
  for (let i = 0; i < PST.unexp; i++) {
    const x = takePair((c) => c.rate1000 - TIERS[c.tier].lo >= 15);
    if (!x) continue;
    const from = K.S_START + rng.int(0, K.S_END - K.S_START - 30);
    const to = rng.chance(0.3) ? INF : from + rng.int(30, 300);
    const maxd = Math.min(12, x[0].rate1000 - TIERS[x[0].tier].lo - 3);
    add(x[0], x[1], { type: 'unexp', from: Math.max(from, x[1].start), to, delta10: rng.int(6, maxd) });
  }
  // 期限切れの特値のまま請求
  for (const s of w.specials) {
    if (s.end === INF || s.end > dn(2026, 6, 30) || s.overlap) continue;
    if (rng.chance(0.42)) {
      const to = rng.chance(0.1) ? INF : s.end + rng.int(15, 150);
      add(s.c, s.p, { type: 'expired', from: s.end + 1, to, price: s.price });
    }
  }
  w.regimes = reg;
  w.addRegime = add;
}

export function regimeAt(w, c, p, d) {
  const arr = w.regimes.get(c.code + '|' + p.code);
  if (arr) for (const r of arr) if (r.from <= d && d <= r.to) return r;
  const ca = w.custRegimes.get(c.code);
  if (ca) for (const r of ca) if (r.from <= d && d <= r.to) return r;
  return null;
}
