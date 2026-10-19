// 架空の会社のマスタ（商品・得意先）と、文書のルールにもとづく「正しい単価」と判定。
import { CATEGORIES, CLOSING, CUSTOMER_TYPES, DEPTS, NAME_STEMS, PREFS, STAFF, BRANCHES, TIERS, productTemplates } from './catalog.mjs';
import { ceilDiv, d, roundListUp } from './util.mjs';

export const D = {
  HIST_START: d('2023-10-01'),
  R1: d('2024-10-01'),
  R2: d('2025-07-01'), // 合意状況ファイルが答えている改定
  R3: d('2026-04-01'), // 切削工具だけの改定（合意状況ファイルなし）
  R4: d('2026-10-01'), // 次回改定（next/）
  SALES_START: d('2024-09-01'),
  SALES_END: d('2026-08-31'),
  L12_START: d('2025-09-01'),
  FU_START: d('2026-10-01'),
  FU_END: d('2026-10-31'),
};
export const FLOOR_PCT = 10;
const INF = 1e9;

const R1_CATS = new Set(['BR', 'CT', 'HT', 'FS', 'PN', 'TR', 'LB']);
export const R2_CATS = new Set(['BR', 'CT', 'FS', 'TR', 'PN', 'HT']);
export const R4_CATS = new Set(['FS', 'TR', 'PN', 'HT', 'LB']);

function roundNear(x) {
  const unit = x < 1000 ? 10 : x < 10000 ? 50 : 100;
  return Math.max(unit, Math.round(x / unit) * unit);
}
const U = (rng, a, b) => a + rng.next() * (b - a);

export function buildProducts(rng) {
  const T = productTemplates();
  const products = [];
  for (const [cat, , ...cs] of CATEGORIES) {
    T[cat].forEach((t, i) => {
      const [name, unit, pmin, pmax, qmin, qmax, sup] = t;
      const base = roundNear(pmin + rng.next() * (pmax - pmin));
      const shares = cs.slice(0, 4).map((v) => Math.max(5, v + rng.int(-4, 4)));
      const sum = shares.reduce((a, b) => a + b, 0);
      const sh = shares.map((v) => Math.round((v * 100) / sum));
      sh[3] = 100 - sh[0] - sh[1] - sh[2];
      products.push({
        code: `${cat}-${1001 + i}`,
        name,
        unit,
        cat,
        base,
        qmin,
        qmax,
        sup,
        shares: sh,
        pop: U(rng, 0.3, 3.0),
        intro: null,
        lastSale: INF,
      });
    });
  }
  // 売れない商品・新商品・廃番
  const idx = rng.shuffle(products.map((_, i) => i));
  let k = 0;
  for (let n = 0; n < 34; n++) products[idx[k++]].pop = 0.004;
  const intro = [
    ...Array(6).fill(d('2025-02-01')),
    ...Array(10).fill(d('2025-10-01')),
    ...Array(8).fill(d('2026-01-15')),
  ];
  for (const day of intro) {
    const p = products[idx[k++]];
    p.intro = day;
    p.pop = Math.max(p.pop, 1.2);
  }
  for (let n = 0; n < 8; n++) products[idx[k++]].lastSale = d('2025-06-30');

  for (const p of products) {
    const s0 = p.intro ?? D.HIST_START;
    const h = [{ start: s0, price: p.base }];
    const last = () => h[h.length - 1].price;
    if (s0 < D.R1 && R1_CATS.has(p.cat) && rng.chance(0.92)) h.push({ start: D.R1, price: roundListUp(last() * (1 + U(rng, 0.03, 0.06))) });
    if (s0 < D.R2 && R2_CATS.has(p.cat) && rng.chance(0.95)) h.push({ start: D.R2, price: roundListUp(last() * (1 + U(rng, 0.05, 0.09))) });
    if (s0 < D.R3 && p.cat === 'CT') h.push({ start: D.R3, price: roundListUp(last() * (1 + U(rng, 0.06, 0.08))) });
    p.hist = h;
    p.histFu = h.slice();
    if (R4_CATS.has(p.cat) && p.lastSale === INF && rng.chance(0.9)) p.histFu.push({ start: D.R4, price: roundListUp(last() * (1 + U(rng, 0.04, 0.07))) });
    // 原単価（銭）
    const ratio = p.sup === 'S09' ? U(rng, 0.455, 0.48) : U(rng, 0.36, 0.45);
    const c = [{ start: s0, sen: Math.round(p.base * ratio * 100) }];
    const lc = () => c[c.length - 1].sen;
    const bump = (day, a, b) => {
      if (s0 < day) c.push({ start: day, sen: Math.round(lc() * (1 + U(rng, a, b))) });
    };
    if (p.cat !== 'MS' && rng.chance(0.9)) bump(d('2024-09-01'), 0.025, 0.05);
    if (R2_CATS.has(p.cat)) bump(d('2025-06-01'), 0.04, 0.075);
    else if (rng.chance(0.8)) bump(d('2025-06-01'), 0.01, 0.03);
    if (p.cat === 'CT') bump(d('2026-02-01'), 0.05, 0.07);
    if (p.sup === 'S09') bump(d('2026-03-01'), 0.115, 0.125);
    if (p.histFu.length > p.hist.length) bump(d('2026-09-01'), 0.03, 0.05);
    p.cost = c;
  }
  return products;
}

export function buildCustomers(rng) {
  const counts = [46, 26, 15, 9, 14];
  const types = [];
  counts.forEach((n, ti) => {
    for (let i = 0; i < n; i++) types.push(ti);
  });
  const order = rng.shuffle(types);
  const stems = rng.shuffle(NAME_STEMS);
  const customers = [];
  let code = 10010;
  order.forEach((ti, i) => {
    const [typeName, sufs, rw] = CUSTOMER_TYPES[ti];
    const stem = stems[i];
    const suf = rng.pick(sufs);
    let formal;
    let abbr;
    const small = ti === 0 || ti === 4;
    if (small && rng.chance(0.14)) {
      formal = `有限会社${stem}${suf}`;
      abbr = `(有)${stem}${suf}`;
    } else if (rng.chance(0.55)) {
      formal = `株式会社${stem}${suf}`;
      abbr = `(株)${stem}${suf}`;
    } else {
      formal = `${stem}${suf}株式会社`;
      abbr = `${stem}${suf}(株)`;
    }
    const rank = rng.weighted(['S', 'A', 'B', 'C', 'D'], rw);
    const tier = TIERS.find((t) => t[0] === rank);
    let rate10 = Math.round(tier[2] * 10);
    if (rng.chance(0.2)) rate10 += rng.pick([-10, -5, 5, 10]);
    rate10 = Math.max(Math.round(tier[3] * 10), Math.min(Math.round(tier[4] * 10), rate10));
    const branch = rng.weighted(BRANCHES, [5, 3, 3]);
    const startYear = rng.int(1996, 2023);
    const start = d(`${startYear}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`);
    const spm = { S: U(rng, 10, 16), A: U(rng, 7, 13), B: U(rng, 3.5, 8), C: U(rng, 1.4, 4.5), D: U(rng, 0.5, 1.8) }[rank];
    code += rng.pick([10, 10, 10, 20, 30]);
    customers.push({
      code: String(code).padStart(6, '0'),
      name: formal,
      abbr,
      type: typeName,
      ti,
      rank,
      rate10,
      tier: { low10: Math.round(tier[3] * 10), high10: Math.round(tier[4] * 10) },
      branch,
      staff: rng.pick(STAFF[branch]),
      pref: rng.pick(PREFS[branch]),
      closing: rng.pick(CLOSING),
      dept: rng.pick(DEPTS),
      start,
      firstOrder: D.SALES_START,
      lastOrder: INF,
      spm,
      vol: (rank === 'S' || rank === 'A') ? rng.chance(0.5) : rank === 'B' ? rng.chance(0.25) : false,
      r2: null,
      r4: null,
    });
  });
  // 新規（改定後に取引開始）と取引停止
  const pool = rng.shuffle(customers.filter((c) => c.ti === 0 || c.ti === 1).filter((c) => c.rank !== 'A'));
  const newStarts = ['2025-08-04', '2025-09-16', '2025-11-04', '2026-01-13', '2026-02-02', '2026-03-02'];
  newStarts.forEach((s, i) => {
    const c = pool[i];
    c.start = d(s) - 10;
    c.firstOrder = d(s);
  });
  const stops = ['2025-03-31', '2025-05-31', '2025-08-31', '2025-10-31'];
  stops.forEach((s, i) => {
    pool[10 + i].lastOrder = d(s);
  });
  return customers;
}

// ---- 価格のルール ----
export function createModel(world) {
  const { specialsByPair } = world;
  const histAt = (h, day) => {
    let r = null;
    for (const e of h) if (e.start <= day) r = e;
    return r;
  };
  const sysList = (p, day, fu) => histAt(fu ? p.histFu : p.hist, day)?.price ?? null;
  const costAt = (p, day) => {
    let r = p.cost[0].sen;
    for (const e of p.cost) if (e.start <= day) r = e.sen;
    return r;
  };
  function resp(c, rev, reading) {
    const r = rev === 'R2' ? c.r2 : c.r4;
    const R = rev === 'R2' ? D.R2 : D.R4;
    if (!r) return { agreed: true, apply: R, kept: new Set() };
    let st = r.status;
    if (st === '回答待ち') st = reading === 'B' ? '合意' : '協議中';
    if (st === '見送り' || st === '協議中') return { agreed: false };
    let kept = r.kept;
    if (r.amb === 'AMB2' && reading === 'B') kept = [];
    return { agreed: true, apply: r.apply ?? R, kept: new Set(kept) };
  }
  function chain(c, p, reading, fu) {
    const H = fu ? p.histFu : p.hist;
    const el = [];
    for (const e of H) {
      if (el.length === 0) {
        el.push({ from: e.start, price: e.price, reason: 'std' });
        continue;
      }
      const held = el[el.length - 1].price;
      const rev = e.start === D.R2 ? 'R2' : fu && e.start === D.R4 ? 'R4' : null;
      if (rev) {
        const r = resp(c, rev, reading);
        if (!r.agreed) el.push({ from: e.start, price: held, reason: 'declined', marker: true });
        else if (r.kept.has(p.cat)) el.push({ from: e.start, price: held, reason: 'kept', marker: true });
        else if (r.apply > e.start) {
          el.push({ from: e.start, price: held, reason: 'deferred', marker: true });
          el.push({ from: r.apply, price: e.price, reason: 'std' });
        } else el.push({ from: e.start, price: e.price, reason: 'std' });
      } else el.push({ from: e.start, price: e.price, reason: 'std' });
    }
    return el;
  }
  function listFor(c, p, day, reading = 'A', fu = false) {
    const el = chain(c, p, reading, fu);
    let cur = -1;
    for (let i = 0; i < el.length; i++) if (el[i].from <= day) cur = i;
    if (cur < 0) return null;
    let nm = cur;
    while (nm >= 0 && el[nm].marker) nm--;
    let pv = nm - 1;
    while (pv >= 0 && el[pv].marker) pv--;
    return { list: el[cur].price, reason: el[cur].reason, prev: pv >= 0 ? el[pv].price : null };
  }
  function specialAt(c, p, day) {
    const arr = specialsByPair.get(`${c.code}|${p.code}`) || [];
    let best = null;
    for (const s of arr) if (s.start <= day && day <= (s.end ?? INF) && (!best || s.start > best.start)) best = s;
    return best;
  }
  const mul = (list, rate10) => Math.floor((list * rate10) / 1000);
  function ctx(c, p, day, reading = 'A', fu = false) {
    const lf = listFor(c, p, day, reading, fu);
    if (!lf) return null;
    const sp = specialAt(c, p, day);
    const ref = sp ? sp.price : mul(lf.list, c.rate10);
    const refKind = sp ? 'special' : lf.reason === 'std' ? 'list_x_rate' : 'old_list_x_rate';
    return { sys: sysList(p, day, fu), ...lf, special: sp, ref, refKind };
  }
  const SAMPLE_RE = /見本|サンプル|無償|試供/;
  const VOL_RE = /(値引|引)/;
  function volPct100(remark) {
    if (!remark || !VOL_RE.test(remark)) return null;
    const m = remark.normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*%/);
    if (!m) return null;
    return Math.round(Number(m[1]) * 100);
  }
  // 1行の判定（文書のルールの順番どおり）
  function judge(line, reading = 'A') {
    const { cust: c, prod: p, qty, billed, remark, date } = line;
    const out = { label: '', ref: '', refKind: '', shortfall: 0, below: 0, floorPrice: '', floorGap: 0 };
    if (!p) return { ...out, label: 'ok_non_product', refKind: 'other' };
    const x = ctx(c, p, date, reading);
    if (qty < 0) return { ...out, label: 'ok_return', ref: x.ref, refKind: x.refKind };
    if (billed === 0 && SAMPLE_RE.test(remark || '')) return { ...out, label: 'ok_sample', ref: x.sys, refKind: 'list' };
    const costSen = costAt(p, date);
    const floorPrice = ceilDiv(costSen * 100, 100 * (100 - FLOOR_PCT)); // 粗利率10%になる最小の単価（円）
    const below = billed * (100 - FLOOR_PCT) < costSen ? 1 : 0;
    out.floorPrice = floorPrice;
    out.below = below;
    out.floorGap = below ? (floorPrice - billed) * qty : 0;
    out.ref = x.ref;
    out.refKind = x.refKind;
    const floorLeak = () => ({ ...out, label: 'leak_below_margin_floor', shortfall: (floorPrice - billed) * qty });
    if (billed === x.ref) {
      if (below) return floorLeak();
      const lab = x.special ? 'ok_special' : x.reason === 'declined' || x.reason === 'kept' ? 'ok_declined' : x.reason === 'deferred' ? 'ok_deferred' : 'ok';
      return { ...out, label: lab };
    }
    if (billed > x.ref) {
      if (below) return floorLeak();
      return { ...out, label: 'overcharge' };
    }
    const vp = volPct100(remark);
    if (vp !== null) {
      const disc = Math.floor((x.ref * (10000 - vp)) / 10000);
      if (billed === disc) {
        out.ref = disc;
        if (below) return floorLeak();
        return { ...out, label: 'ok_volume_discount' };
      }
    }
    const leak = (label) => ({ ...out, label, shortfall: (x.ref - billed) * qty });
    if (x.prev !== null && x.prev !== x.list && billed === mul(x.prev, c.rate10)) return leak('leak_old_price');
    const arr = specialsByPair.get(`${c.code}|${p.code}`) || [];
    if (arr.some((s) => s.end !== null && s.end < date && s.price === billed)) return leak('leak_expired_special');
    const lo = mul(x.list, c.tier.low10);
    const hi = mul(x.list, c.tier.high10);
    if (billed < lo || billed > hi) return leak('leak_rate_out_of_tier');
    return { ...out, label: 'unexplained' };
  }
  return { sysList, costAt, listFor, specialAt, ctx, judge, mul, volPct100, resp };
}
