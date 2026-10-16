/**
 * 転嫁デスク — deterministic generator of the fictional (架空) sample data.
 *
 *   node data-gen/generate.ts            # Node >= 22.18 (type stripping), or: npx tsx data-gen/generate.ts
 *   node data-gen/generate.ts --out DIR  # write DIR/public/sample and DIR/data-gen/truth instead
 *
 * Story (all fictional): 架空商事株式会社, a wholesaler of packaging materials and
 * factory consumables. 300 customers, 2,000 SKUs in 8 categories, sales lines for
 * 2024-10 .. 2026-09 from its 販売管理 system, exported in two layouts (A and B).
 * List prices of 6 categories were revised on 2025-04-01 after negotiation with
 * each customer. Billing mistakes are injected on purpose (see README) and the
 * ground truth is written to data-gen/truth/, which the app never reads.
 *
 * Nothing here depends on the clock, the locale or Math.random: rerunning gives
 * byte-identical files.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BRANCHES, BUSINESS_TYPES, CATEGORIES, KANA_MORPHS, NAME_MORPHS, SUPPLIERS, TIERS, expandCategory,
} from './lib/catalog.ts';
import type { Category } from './lib/catalog.ts';
import { STANDARD, writeCsv, writeText } from './lib/csv.ts';
import type { CsvOptions } from './lib/csv.ts';
import {
  addBusinessDays, addDays, addMonths, businessDays, compactDate, dayNum, isBusinessDay, isoFromDay,
  monthsBetween, warekiLong, warekiShort,
} from './lib/dates.ts';
import { stream } from './lib/rng.ts';
import type { Rng } from './lib/rng.ts';
import {
  LABEL_JA, LEAK_TYPES, classifyFollowupLine, classifyHistoryLine, floorDiv, isBelowFloor, listInfo, pairKey,
  priceAtRate, validSpecial,
} from './lib/rules.ts';
import type { Ctx, FollowupResult, HistoryResult, Line, MasterEntry, SpecialRow } from './lib/rules.ts';
import { senToYen, toHankaku, toZenkaku, withCommas } from './lib/text.ts';

/* ------------------------------------------------------------------ parameters */

const HIST_START = '2024-10-01';
const HIST_END = '2026-09-30';
const LAST12_START = '2025-10-01';
const REV1 = '2025-04-01';
const COST_UP_KG = '2026-04-01';
const REV2 = '2026-12-01';
const REV2_DEFERRED = '2027-01-01';
const FOLLOW_MONTH = { y: 2026, m: 12 };
const FLOOR_PCT = 10;
const SPECIAL_MIN_MARGIN = 12;

const SEASON = [0.85, 0.95, 1.15, 0.95, 0.95, 1.0, 1.0, 0.85, 1.05, 1.0, 1.05, 1.15];

/** Future supplier price increases (仕入先からの値上げ通知). */
const NOTICES: { supplier: string; ratePct: number; notified: string; eff: string; reason: string }[] = [
  { supplier: 'S12', ratePct: 12, notified: '2026-02-10', eff: COST_UP_KG, reason: '鋼材価格・エネルギーコストの上昇' },
  { supplier: 'S01', ratePct: 10, notified: '2026-08-25', eff: '2026-12-01', reason: '段ボール原紙価格の改定' },
  { supplier: 'S03', ratePct: 8, notified: '2026-09-01', eff: '2026-11-01', reason: 'ポリエチレン樹脂価格・物流費の上昇' },
  { supplier: 'S05', ratePct: 9, notified: '2026-09-10', eff: '2026-12-01', reason: '原材料・エネルギーコストの上昇' },
  { supplier: 'S11', ratePct: 7, notified: '2026-08-28', eff: '2026-11-01', reason: '原材料・人件費・物流費の上昇' },
  { supplier: 'S06', ratePct: 5, notified: '2026-09-25', eff: '2027-01-01', reason: '原材料・物流費の上昇' },
];
/** Demo outcome of the next revision (used only for the 反映チェック fixture in next/). */
const REV2_LIST_PCT: Record<string, number> = { S01: 9, S03: 8, S05: 8, S11: 7, S12: 12 };

/* ------------------------------------------------------------------ output paths */

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const ROOT = outArg >= 0 ? resolve(process.argv[outArg + 1]) : resolve(HERE, '..');
const SAMPLE_DIR = join(ROOT, 'public', 'sample');
const TRUTH_DIR = join(ROOT, 'data-gen', 'truth');

/* ------------------------------------------------------------------ helpers */

function niceRound(x: number): number {
  const unit = x < 1000 ? 10 : x < 10000 ? 50 : 100;
  return Math.max(300, Math.round(x / unit) * unit);
}
function niceCeil(x: number): number {
  const unit = x < 1000 ? 10 : x < 10000 ? 50 : 100;
  return Math.ceil(x / unit - 1e-9) * unit;
}
/** Round half away from zero of a / 100 (cost amount in yen from sen × qty). */
function senTimesQtyToYen(costSen: number, qty: number): number {
  const v = costSen * qty;
  const s = v < 0 ? -1 : 1;
  return s * Math.floor((Math.abs(v) + 50) / 100);
}
function randomDay(rng: Rng, fromIso: string, toIso: string): string {
  return isoFromDay(rng.int(dayNum(fromIso), dayNum(toIso)));
}
function randomBusinessDay(rng: Rng, fromIso: string, toIso: string, maxDayOfMonth = 31): string {
  for (let i = 0; i < 1000; i++) {
    const d = randomDay(rng, fromIso, toIso);
    if (isBusinessDay(d) && Number(d.slice(8, 10)) <= maxDayOfMonth) return d;
  }
  throw new Error('no business day found');
}
function fail(msg: string): never {
  throw new Error(msg);
}

/* ------------------------------------------------------------------ products */

type CostPoint = { start: string; sen: number; kind: '実績' | '予定' };
type Product = {
  code: string;
  name: string;
  cat: Category;
  unit: string;
  supplier: string;
  list0: number;
  list1: number | null;
  list2: number | null;
  costs: CostPoint[];
  shares: number[];
  qty: [number, number];
  qtyFactor: number;
  pop: number;
  costUp: boolean;
};

function buildProducts(): Product[] {
  const out: Product[] = [];
  for (const cat of CATEGORIES) {
    const rng = stream(`products:${cat.code}`);
    const variants = expandCategory(cat);
    if (variants.length < cat.target) fail(`${cat.code}: only ${variants.length} variants`);
    const idx = rng.shuffle(variants.map((_, i) => i)).slice(0, cat.target).sort((a, b) => a - b);
    const groupNo = new Map<string, number>();
    let next = 1001;
    const catProducts: Product[] = [];
    for (const i of idx) {
      const v = variants[i];
      let code: string;
      if (v.sizeLabel !== null) {
        let n = groupNo.get(v.groupKey);
        if (n === undefined) {
          n = next++;
          groupNo.set(v.groupKey, n);
        }
        code = `${cat.code}-${n}-${v.sizeLabel}`;
      } else {
        code = `${cat.code}-${next++}`;
      }
      const list0 = niceRound(v.family.base * v.factor * (0.92 + 0.16 * rng.next()));
      const costUp = v.family.supplier === 'S12';
      const ratioPm = costUp ? rng.int(460, 490) : rng.int(400, 490);
      const costs: CostPoint[] = [{ start: '2024-04-01', sen: Math.round((list0 * ratioPm) / 10), kind: '実績' }];
      let list1: number | null = null;
      if (cat.rev1) {
        list1 = niceCeil((list0 * (100 + cat.rev1.price)) / 100);
        const pm = 1000 + cat.rev1.cost * 10 + rng.int(-8, 8);
        costs.push({ start: REV1, sen: Math.round((costs[0].sen * pm) / 1000), kind: '実績' });
      }
      const s0 = cat.shares[0] + rng.int(-4, 4);
      const s1 = cat.shares[1] + rng.int(-4, 4);
      const s2 = cat.shares[2] + rng.int(-3, 3);
      catProducts.push({
        code, name: v.name, cat, unit: v.unit, supplier: v.family.supplier, list0, list1, list2: null, costs,
        shares: [s0, s1, s2, 100 - s0 - s1 - s2], qty: v.family.qty, qtyFactor: v.qtyFactor, pop: 0, costUp,
      });
    }
    const order = rng.shuffle(catProducts.map((_, i) => i));
    order.forEach((pi, rank) => {
      catProducts[pi].pop = 1 / (rank + 3);
    });
    out.push(...catProducts);
  }
  // supplier price increases (past one for S12, future notices for the others)
  const rng = stream('notices');
  for (const n of NOTICES) {
    for (const p of out) {
      if (p.supplier !== n.supplier) continue;
      const last = p.costs[p.costs.length - 1];
      const pm = 1000 + n.ratePct * 10 + rng.int(-10, 10);
      p.costs.push({ start: n.eff, sen: Math.round((last.sen * pm) / 1000), kind: n.eff <= HIST_END ? '実績' : '予定' });
    }
  }
  // demo outcome of the next revision (新定価 from 2026-12-01)
  for (const p of out) {
    const pct = REV2_LIST_PCT[p.supplier];
    if (pct !== undefined) p.list2 = niceCeil(((p.list1 ?? p.list0) * (100 + pct)) / 100);
  }
  const keys = new Set<string>();
  for (const p of out) {
    const k = p.code.replace(/-/g, '');
    if (keys.has(k)) fail(`duplicate code key ${k}`);
    keys.add(k);
    if (p.name.normalize('NFKC') !== p.name) fail(`name not NFKC-stable: ${p.name}`);
  }
  return out;
}

function costAt(p: Product, date: string): number {
  let sen = p.costs[0].sen;
  for (const c of p.costs) if (c.start <= date) sen = c.sen;
  return sen;
}
function systemList(p: Product, date: string): number {
  if (p.list2 !== null && date >= REV2) return p.list2;
  if (p.list1 !== null && date >= REV1) return p.list1;
  return p.list0;
}

/* ------------------------------------------------------------------ customers */

type Size = '大' | '中' | '小';
type Customer = {
  code: string;
  name: string;
  short: string;
  type: string;
  rank: string;
  ratePm: number;
  branch: (typeof BRANCHES)[number];
  rep: string;
  pref: string;
  closing: string;
  dept: string;
  since: string;
  activeFrom: string;
  activeTo: string;
  ended: boolean;
  size: Size;
  registered: boolean;
  basket: Product[];
  slipMean: number;
  lines: [number, number];
  qtyMult: number;
};

function buildCustomers(products: Product[]): Customer[] {
  const rng = stream('customers');
  const ranks: string[] = [];
  const counts: [string, number][] = [['S', 30], ['A', 45], ['B', 120], ['C', 75], ['D', 30]];
  for (const [r, n] of counts) for (let i = 0; i < n; i++) ranks.push(r);
  rng.shuffle(ranks);

  const byCat = new Map<string, Product[]>();
  for (const p of products) {
    const a = byCat.get(p.cat.code) ?? [];
    a.push(p);
    byCat.set(p.cat.code, a);
  }
  const usedNames = new Set<string>();
  const morphUse = new Map<string, number>();
  const nonAgency = BUSINESS_TYPES.filter((t) => t.type !== '代理店・二次卸');
  const typeWeights = [30, 18, 14, 14, 14, 10];
  const out: Customer[] = [];

  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const tier = TIERS.find((t) => t.rank === rank) ?? fail('tier');
    const bt = rank === 'S' ? BUSINESS_TYPES[0] : rng.weighted(nonAgency, typeWeights);
    const size: Size =
      rank === 'S' ? (rng.chance(0.4) ? '大' : '中')
      : rank === 'A' ? rng.weighted<Size>(['大', '中', '小'], [30, 60, 10])
      : rank === 'B' ? rng.weighted<Size>(['大', '中', '小'], [5, 35, 60])
      : rank === 'C' ? (rng.chance(0.1) ? '中' : '小')
      : '小';
    const branch = rng.weighted(BRANCHES, BRANCHES.map((b) => b.share));
    let core = '';
    let name = '';
    let short = '';
    for (let tries = 0; tries < 200; tries++) {
      const useKana = bt.type === '小売・EC' || bt.type === '医療・介護' ? rng.chance(0.45) : rng.chance(0.08);
      const morph = useKana ? rng.pick(KANA_MORPHS) : rng.pick(NAME_MORPHS);
      if ((morphUse.get(morph) ?? 0) >= 2 && tries < 150) continue;
      core = morph + rng.pick(bt.suffixes);
      const lf = rng.next();
      if (lf < 0.5) {
        name = `株式会社${core}`;
        short = `(株)${core}`;
      } else if (lf < 0.85) {
        name = `${core}株式会社`;
        short = `${core}(株)`;
      } else if (lf < 0.97) {
        name = `有限会社${core}`;
        short = `(有)${core}`;
      } else {
        name = `合同会社${core}`;
        short = `(同)${core}`;
      }
      if (!usedNames.has(core)) {
        morphUse.set(morph, (morphUse.get(morph) ?? 0) + 1);
        break;
      }
    }
    if (usedNames.has(core)) fail('could not make a unique customer name');
    usedNames.add(core);

    const since = randomDay(rng, '2008-04-01', '2024-06-30');
    let slipMean: number;
    let lines: [number, number];
    let basketSize: number;
    let qtyMult: number;
    if (rank === 'D') {
      slipMean = 0.15 + 0.25 * rng.next();
      lines = [1, 3];
      basketSize = rng.int(3, 10);
      qtyMult = 0.8 + 0.4 * rng.next();
    } else if (size === '大') {
      slipMean = 4 + 3 * rng.next();
      lines = [3, 8];
      basketSize = rng.int(50, 100);
      qtyMult = 2.5 + rng.next();
    } else if (size === '中') {
      slipMean = 1.8 + 1.6 * rng.next();
      lines = [2, 6];
      basketSize = rng.int(20, 50);
      qtyMult = 1.3 + 0.6 * rng.next();
    } else {
      slipMean = 0.4 + 0.8 * rng.next();
      lines = [1, 4];
      basketSize = rng.int(6, 20);
      qtyMult = 0.8 + 0.4 * rng.next();
    }
    // basket: category by business type, SKU by popularity, without replacement
    const catCodes = Object.keys(bt.cats);
    const catW = catCodes.map((k) => bt.cats[k]);
    const taken = new Set<string>();
    const basket: Product[] = [];
    for (let k = 0; k < basketSize; k++) {
      const cc = rng.weighted(catCodes, catW);
      const pool = (byCat.get(cc) ?? []).filter((p) => !taken.has(p.code));
      if (pool.length === 0) continue;
      const p = rng.weighted(pool, pool.map((q) => q.pop));
      taken.add(p.code);
      basket.push(p);
    }
    const regP = size === '大' ? 0.5 : size === '中' ? 0.25 : 0.05;
    out.push({
      code: String(1001 + i).padStart(6, '0'),
      name, short, type: bt.type, rank, ratePm: rng.pick(tier.choices), branch,
      rep: rng.pick(branch.reps), pref: rng.pick(branch.prefs),
      closing: rng.chance(0.4) ? '20日' : '末日', dept: rng.pick(bt.depts),
      since, activeFrom: HIST_START, activeTo: '2099-12-31', ended: false, size,
      registered: rng.chance(regP), basket, slipMean, lines, qtyMult,
    });
  }
  // lifecycle: 12 new customers during the history, 8 that stop ordering
  const life = stream('lifecycle');
  const newOnes = life.shuffle(out.filter((c) => ['B', 'C', 'D'].includes(c.rank)).map((c) => c.code)).slice(0, 12);
  for (const code of newOnes) {
    const c = out.find((x) => x.code === code) ?? fail('c');
    c.since = randomBusinessDay(life, '2024-12-01', '2026-06-30');
    c.activeFrom = c.since;
  }
  const endOnes = life
    .shuffle(out.filter((c) => ['B', 'C', 'D'].includes(c.rank) && !newOnes.includes(c.code)).map((c) => c.code))
    .slice(0, 8);
  for (const code of endOnes) {
    const c = out.find((x) => x.code === code) ?? fail('c');
    c.activeTo = randomDay(life, '2025-06-01', '2026-06-30');
    c.ended = true;
  }
  return out;
}

/* ------------------------------------------------------------------ order events */

type Kind = 'sale' | 'return' | 'sample' | 'freight';
type PriceType = '標準' | '得意先' | '手入力';
type Ev = {
  kind: Kind;
  date: string;
  cust: Customer;
  sku: Product | null;
  qty: number;
  big: boolean;
  orig: Ev | null;
  seq: number;
  slip: number;
  line: number;
  billed: number;
  list: number;
  costSen: number;
  priceType: PriceType;
  remark: string;
  intent: string;
  injId: string;
  result: HistoryResult | null;
  follow: FollowupResult | null;
};
type Slip = { date: string; cust: Customer; seq: number; lines: Ev[] };

function newEv(kind: Kind, date: string, cust: Customer, sku: Product | null, qty: number): Ev {
  return {
    kind, date, cust, sku, qty, big: false, orig: null, seq: 0, slip: 0, line: 0, billed: 0, list: 0, costSen: 0,
    priceType: '標準', remark: '', intent: '', injId: '', result: null, follow: null,
  };
}

function generateOrders(customers: Customer[], months: { y: number; m: number }[], label: string, lastDay: string): Slip[] {
  const slips: Slip[] = [];
  let seq = 0;
  const firstMonth = months[0];
  for (const c of customers) {
    const rng = stream(`${label}:${c.code}`);
    for (const { y, m } of months) {
      const all = businessDays(y, m);
      const days = all.filter((d) => d >= c.activeFrom && d <= c.activeTo && d <= lastDay);
      if (days.length === 0) continue;
      const idx = (y - firstMonth.y) * 12 + (m - firstMonth.m) + (label === 'orders' ? 0 : 26);
      const mean = c.slipMean * SEASON[m - 1] * (1 + (0.02 * idx) / 12) * (days.length / all.length);
      const n = rng.stochRound(mean * (0.75 + 0.5 * rng.next()));
      for (let k = 0; k < n; k++) {
        const date = rng.pick(days);
        const slip: Slip = { date, cust: c, seq: seq++, lines: [] };
        const want = Math.min(c.basket.length, rng.int(c.lines[0], c.lines[1]));
        const pool = c.basket.slice();
        const weights = pool.map((_, i) => 1 / (i + 2));
        for (let l = 0; l < want; l++) {
          const j = rng.weighted(pool.map((_, i) => i), weights);
          const p = pool[j];
          pool.splice(j, 1);
          weights.splice(j, 1);
          let qty = Math.max(1, Math.round(rng.int(p.qty[0], p.qty[1]) * p.qtyFactor * c.qtyMult * (0.6 + 0.8 * rng.next())));
          const ev = newEv('sale', date, c, p, qty);
          if (rng.chance(0.012)) {
            qty = Math.max(qty * 4, 6);
            ev.qty = qty;
            ev.big = true;
          }
          slip.lines.push(ev);
        }
        slip.lines.sort((a, b) => ((a.sku?.code ?? '') < (b.sku?.code ?? '') ? -1 : 1));
        if (rng.chance(0.006)) {
          const p = rng.pick(c.basket);
          slip.lines.push(newEv('sample', date, c, p, rng.int(1, 2)));
        }
        if (c.size === '小' && slip.lines.length <= 2 && rng.chance(0.5)) {
          slip.lines.push(newEv('freight', date, c, null, 1));
        }
        slips.push(slip);
        for (const ev of slip.lines) {
          if (ev.kind !== 'sale' || !rng.chance(0.004)) continue;
          const rd = addBusinessDays(date, rng.int(3, 15));
          if (rd > c.activeTo || rd > lastDay) continue;
          const back = Math.min(ev.qty, rng.int(1, Math.max(1, Math.floor(ev.qty / 3))));
          const ret = newEv('return', rd, c, ev.sku, -back);
          ret.orig = ev;
          slips.push({ date: rd, cust: c, seq: seq++, lines: [ret] });
        }
      }
    }
  }
  slips.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.cust.code !== b.cust.code ? (a.cust.code < b.cust.code ? -1 : 1) : a.seq - b.seq));
  return slips;
}

function numberSlips(slips: Slip[], firstNo: number): Ev[] {
  const evs: Ev[] = [];
  let no = firstNo;
  for (const s of slips) {
    s.lines.forEach((ev, i) => {
      ev.slip = no;
      ev.line = i + 1;
      evs.push(ev);
    });
    no++;
  }
  return evs;
}

/* ------------------------------------------------------------------ agreements (前回改定) */

type Agreement = {
  cust: string;
  status: string;
  eff: string | null;
  excluded: string[];
  offered: string;
  answered: string;
  note: string;
};

function buildRev1Agreements(customers: Customer[]): Map<string, Agreement> {
  const rng = stream('agreements-rev1');
  const revCats = CATEGORIES.filter((c) => c.rev1).map((c) => c.code);
  const out = new Map<string, Agreement>();
  for (const c of customers) {
    if (c.since >= REV1) {
      out.set(c.code, { cust: c.code, status: '対象外(改定後に取引開始)', eff: null, excluded: [], offered: '', answered: '', note: '' });
      continue;
    }
    const offered = randomBusinessDay(rng, '2025-01-15', '2025-01-31');
    const answered = randomBusinessDay(rng, '2025-02-03', '2025-03-25');
    const r = c.rank === 'S' ? 0 : rng.next();
    let a: Agreement;
    if (r < 0.8) {
      a = { cust: c.code, status: '合意', eff: REV1, excluded: [], offered, answered, note: '' };
    } else if (r < 0.88) {
      const eff = rng.pick(['2025-05-01', '2025-06-01']);
      a = { cust: c.code, status: '合意(適用日変更)', eff, excluded: [], offered, answered, note: '先方の期初に合わせて適用日を変更' };
    } else if (r < 0.95) {
      const bt = BUSINESS_TYPES.find((t) => t.type === c.type) ?? fail('type');
      const mine = revCats.filter((k) => (bt.cats[k] ?? 0) >= 1);
      const ex = rng.shuffle(mine.slice()).slice(0, rng.int(1, 2)).sort();
      const names = ex.map((k) => CATEGORIES.find((x) => x.code === k)?.name).join('・');
      a = { cust: c.code, status: '一部合意', eff: REV1, excluded: ex, offered, answered, note: `${names}は据え置き` };
    } else {
      a = { cust: c.code, status: '見送り', eff: null, excluded: [], offered, answered, note: '次回改定時に再協議' };
    }
    out.set(c.code, a);
  }
  return out;
}

/* ------------------------------------------------------------------ specials (特値) */

type Special = SpecialRow & { cust: string; sku: string; reason: string; lowMargin: boolean; renewed: boolean };

function buildSpecials(
  customers: Customer[], ctx: Ctx, salesByPair: Map<string, Ev[]>,
): Special[] {
  const rng = stream('specials');
  const out: Special[] = [];
  const has = new Set<string>();
  const add = (s: Special): void => {
    out.push(s);
    const k = pairKey(s.cust, s.sku);
    has.add(k);
    const arr = ctx.specials.get(k) ?? [];
    arr.push(s);
    ctx.specials.set(k, arr);
  };
  const refAt = (c: Customer, p: Product, d: string): number => priceAtRate(listInfo(ctx, c.code, p.code, d).list, c.ratePm);
  const eventsIn = (c: Customer, p: Product, from: string, to: string | null): number =>
    (salesByPair.get(pairKey(c.code, p.code)) ?? []).filter((e) => e.date >= from && (to === null || e.date <= to)).length;
  const stable = customers.filter((c) => c.since < HIST_START && !c.ended);

  // 12 特値 set below the margin floor (競合対抗, no end date)
  const lowCands: { c: Customer; p: Product; start: string }[] = [];
  for (const c of stable) {
    if (c.rank !== 'A' && c.rank !== 'B') continue;
    for (const p of c.basket) {
      if (p.costUp) continue;
      const start = ['2025-04-01', '2025-07-01', '2025-10-01'][(Number(c.code) + Number(p.code.slice(3, 7))) % 3];
      if (eventsIn(c, p, start, null) >= 4) lowCands.push({ c, p, start });
    }
  }
  const perCust = new Map<string, number>();
  for (const cand of rng.shuffle(lowCands)) {
    if (out.length >= 12) break;
    const n = perCust.get(cand.c.code) ?? 0;
    if (n >= 1) continue;
    const m = rng.int(3, 8);
    const price = Math.ceil(costAt(cand.p, cand.start) / (100 - m));
    if (price >= refAt(cand.c, cand.p, cand.start)) continue;
    perCust.set(cand.c.code, n + 1);
    add({ cust: cand.c.code, sku: cand.p.code, price, start: cand.start, end: null, reason: '競合対抗', lowMargin: true, renewed: false });
  }

  type Pattern = { w: number; chain: [string, string | null][]; renewP: number[] };
  const patterns: Pattern[] = [
    { w: 25, chain: [['2024-04-01', '2025-03-31'], ['2025-04-01', '2026-03-31'], ['2026-04-01', '2027-03-31']], renewP: [0.5, 0.3] },
    { w: 20, chain: [['2024-10-01', '2025-09-30'], ['2025-10-01', '2026-09-30'], ['2026-10-01', '2027-09-30']], renewP: [0.5, 0.4] },
    { w: 15, chain: [['2025-04-01', '2026-03-31'], ['2026-04-01', '2027-03-31']], renewP: [0.5] },
    { w: 12, chain: [['2023-07-01', null]], renewP: [] },
    { w: 10, chain: [['2025-10-01', '2026-03-31']], renewP: [] },
    { w: 8, chain: [['2026-01-01', '2026-12-31']], renewP: [] },
    { w: 10, chain: [], renewP: [] },
  ];
  const reasons = ['年間契約', '競合対抗', '新規獲得', '大口継続', '物件対応'];
  const sizeP: Record<Size, number> = { 大: 0.7, 中: 0.3, 小: 0.08 };
  for (const c of customers) {
    if (c.rank === 'D' || c.since >= '2025-10-01') continue;
    if (!rng.chance(sizeP[c.size] * (c.rank === 'S' ? 0.3 : 1))) continue;
    const cands = c.basket
      .filter((p) => !p.costUp && !has.has(pairKey(c.code, p.code)))
      .map((p) => ({ p, n: eventsIn(c, p, HIST_START, null) }))
      .filter((x) => x.n >= 4)
      .sort((a, b) => b.n - a.n || (a.p.code < b.p.code ? -1 : 1));
    const k = c.size === '大' ? rng.int(3, 12) : c.size === '中' ? rng.int(2, 6) : rng.int(1, 3);
    for (const { p } of cands.slice(0, k)) {
      const pat = rng.weighted(patterns, patterns.map((x) => x.w));
      let chain = pat.chain;
      if (chain.length === 0) {
        const s = randomBusinessDay(rng, '2024-11-01', '2025-12-31', 28);
        chain = [[s, addDays(addMonths(s, rng.pick([6, 9])), -1)]];
      }
      const reason = rng.pick(reasons);
      let prev: Special | null = null;
      for (let i = 0; i < chain.length; i++) {
        if (i > 0 && !rng.chance(pat.renewP[i - 1])) break;
        const [start, end] = chain[i];
        if (c.since > start) break;
        const ref = refAt(c, p, start < HIST_START ? HIST_START : start);
        let ok = false;
        let price = 0;
        const oldPrice = p.list1 !== null ? priceAtRate(p.list0, c.ratePm) : -1;
        const first = rng.int(3, 10);
        for (const d of [first, first + 1, 3, 4]) {
          price = floorDiv(ref * (100 - d), 100);
          // a 特値 equal to the pre-revision price would be ambiguous once it expires
          if (price === oldPrice) continue;
          const to = end === null || end > '2026-12-31' ? '2026-12-31' : end;
          let maxCost = costAt(p, start < HIST_START ? HIST_START : start);
          for (const cp of p.costs) if (cp.start >= start && cp.start <= to) maxCost = Math.max(maxCost, cp.sen);
          if (price * (100 - SPECIAL_MIN_MARGIN) >= maxCost && price < ref) {
            ok = true;
            break;
          }
        }
        if (!ok) break;
        if (prev) prev.renewed = true;
        const sp: Special = { cust: c.code, sku: p.code, price, start, end, reason: i > 0 ? '契約更新' : reason, lowMargin: false, renewed: false };
        add(sp);
        prev = sp;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ injections */

type InjType = 'leak_old_price' | 'leak_expired_special' | 'leak_rate_out_of_tier';
type Inj = {
  id: string;
  type: InjType;
  cust: string;
  sku: string | null;
  from: string;
  to: string | null;
  badPm: number;
  special: Special | null;
  group: string;
  cause: string;
  priceType: PriceType;
  remark: string;
};

function active(inj: Inj, d: string): boolean {
  return d >= inj.from && (inj.to === null || d < inj.to);
}

function chooseInjections(
  customers: Customer[], ctx: Ctx, agreements: Map<string, Agreement>, specials: Special[],
  salesByPair: Map<string, Ev[]>,
): { byPair: Map<string, Inj[]>; tierWhole: Map<string, Inj>; all: Inj[] } {
  const rng = stream('inject');
  const byPair = new Map<string, Inj[]>();
  const tierWhole = new Map<string, Inj>();
  const all: Inj[] = [];
  const used = new Set<string>();
  const wholeCust = new Set<string>();
  const hasSpecial = (c: string, s: string): boolean => ctx.specials.has(pairKey(c, s));
  const events = (c: string, s: string): Ev[] => salesByPair.get(pairKey(c, s)) ?? [];
  const countFrom = (c: string, s: string, from: string, to: string | null = null): number =>
    events(c, s).filter((e) => e.date >= from && (to === null || e.date < to)).length;
  const addPair = (inj: Inj): void => {
    const k = pairKey(inj.cust, inj.sku ?? '');
    const arr = byPair.get(k) ?? [];
    arr.push(inj);
    byPair.set(k, arr);
    used.add(k);
    all.push(inj);
  };
  const monthStarts = (from: string, to: string): string[] =>
    monthsBetween(from, to).map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}-01`);
  const pickFix = (c: string, s: string, from: string, earliest: string, latest: string): string | null => {
    const opts = monthStarts(earliest, latest).filter((f) => countFrom(c, s, from, f) >= 2 && countFrom(c, s, f) >= 1);
    return opts.length ? rng.pick(opts) : null;
  };
  const stable = customers.filter((c) => c.since < HIST_START && !c.ended);
  const rev1Std = (c: Customer): boolean => {
    const a = agreements.get(c.code);
    return !!a && a.status === '合意' && a.eff === REV1;
  };

  // 1) 反映漏れ, whole customer: 得意先単価 never updated after the 2025-04 revision
  const affected = (c: Customer): number =>
    c.basket.filter((p) => p.cat.rev1 && !hasSpecial(c.code, p.code)).reduce((s, p) => s + countFrom(c.code, p.code, REV1), 0);
  const revWholeCands = stable
    .filter((c) => ['A', 'B'].includes(c.rank) && c.size !== '小' && rev1Std(c))
    .map((c) => ({ c, n: affected(c) }))
    .sort((a, b) => b.n - a.n || (a.c.code < b.c.code ? -1 : 1))
    .slice(0, 6)
    .map((x) => x.c);
  const revWhole = rng.shuffle(revWholeCands).slice(0, 2);
  revWhole.forEach((c, i) => {
    wholeCust.add(c.code);
    c.registered = true;
    const to = i === 0 ? null : '2026-02-01';
    for (const p of c.basket) {
      if (!p.cat.rev1 || hasSpecial(c.code, p.code) || countFrom(c.code, p.code, REV1) === 0) continue;
      addPair({
        id: '', type: 'leak_old_price', cust: c.code, sku: p.code, from: REV1, to, badPm: 0, special: null,
        group: `W-REV-${i + 1}`, cause: '前回改定時に得意先単価を一括で更新し忘れ(得意先単位)', priceType: '得意先', remark: '',
      });
    }
  });

  // 2) 掛け率ランク外, whole customer: wrong 掛率 in the 販売管理's customer master
  const tierWholeCands = stable.filter(
    (c) => ['B', 'C'].includes(c.rank) && c.size !== '小' && rev1Std(c) && !c.registered && !wholeCust.has(c.code),
  );
  const tw = rng.shuffle(tierWholeCands.slice()).slice(0, 2);
  tw.forEach((c, i) => {
    wholeCust.add(c.code);
    const tier = ctx.tiers.get(c.rank) ?? fail('tier');
    let badPm = tier.min - (i === 0 ? 90 : 70);
    // avoid a bad price that happens to equal the old price of some SKU
    for (let guard = 0; guard < 10; guard++) {
      const clash = c.basket.some((p) => p.list1 !== null && priceAtRate(p.list1, badPm) === priceAtRate(p.list0, c.ratePm));
      if (!clash) break;
      badPm -= 10;
    }
    const inj: Inj = {
      id: '', type: 'leak_rate_out_of_tier', cust: c.code, sku: null, from: i === 0 ? '2025-07-01' : '2025-10-01', to: null,
      badPm, special: null, group: `W-TIER-${i + 1}`, cause: '販売管理の得意先マスタに誤った掛率が登録(得意先単位)', priceType: '標準', remark: '',
    };
    tierWhole.set(c.code, inj);
    all.push(inj);
  });

  // 3) 反映漏れ, single customer × SKU (得意先単価 not updated)
  const revCands: { c: Customer; p: Product; eff: string }[] = [];
  for (const c of customers) {
    if (wholeCust.has(c.code)) continue;
    const a = agreements.get(c.code);
    if (!a || !(a.status === '合意' || a.status === '合意(適用日変更)' || a.status === '一部合意') || !a.eff) continue;
    for (const p of c.basket) {
      if (!p.cat.rev1 || a.excluded.includes(p.cat.code) || hasSpecial(c.code, p.code)) continue;
      if (countFrom(c.code, p.code, a.eff) >= 3) revCands.push({ c, p, eff: a.eff });
    }
  }
  const perCust = new Map<string, number>();
  let revN = 0;
  for (const { c, p, eff } of rng.shuffle(revCands)) {
    if (revN >= 80) break;
    const k = pairKey(c.code, p.code);
    if (used.has(k) || (perCust.get(c.code) ?? 0) >= 3) continue;
    let to: string | null = null;
    if (revN < 15) {
      to = pickFix(c.code, p.code, eff, addMonths(eff, 4), '2026-06-01');
      if (to === null) continue;
    }
    perCust.set(c.code, (perCust.get(c.code) ?? 0) + 1);
    addPair({
      id: '', type: 'leak_old_price', cust: c.code, sku: p.code, from: eff, to, badPm: 0, special: null, group: '',
      cause: to ? '得意先単価の更新漏れ(途中で修正済み)' : '得意先単価の更新漏れ', priceType: '得意先', remark: '',
    });
    revN++;
  }

  // 4) 特値の期限切れ後も特値のまま
  const isRenewedLater = (s: Special): boolean =>
    specials.some((o) => o.cust === s.cust && o.sku === s.sku && o.start > s.start);
  const expCands = specials.filter(
    (s) => !s.lowMargin && s.end !== null && s.end >= HIST_START && s.end <= '2026-06-30' && !isRenewedLater(s) &&
      !wholeCust.has(s.cust) && countFrom(s.cust, s.sku, addDays(s.end, 1)) >= 2,
  );
  perCust.clear();
  let expN = 0;
  for (const s of rng.shuffle(expCands.slice())) {
    if (expN >= 30) break;
    const k = pairKey(s.cust, s.sku);
    if (used.has(k) || (perCust.get(s.cust) ?? 0) >= 2) continue;
    const from = addDays(s.end ?? fail('end'), 1);
    let to: string | null = null;
    if (expN < 5) {
      to = pickFix(s.cust, s.sku, from, addMonths(`${from.slice(0, 7)}-01`, 3), '2026-07-01');
      if (to === null) continue;
    }
    perCust.set(s.cust, (perCust.get(s.cust) ?? 0) + 1);
    addPair({
      id: '', type: 'leak_expired_special', cust: s.cust, sku: s.sku, from, to, badPm: 0, special: s, group: '',
      cause: to ? '特値の期限切れ後も特値のまま請求(途中で修正済み)' : '特値の期限切れ後も特値のまま請求', priceType: '得意先', remark: '',
    });
    expN++;
  }

  // 5) 掛け率ランク外, single customer × SKU (手入力の単価)
  const tierCands: { c: Customer; p: Product; from: string }[] = [];
  const starts = monthStarts('2025-01-01', '2026-03-01');
  for (const c of customers) {
    if (wholeCust.has(c.code) || c.rank === 'D') continue;
    const a = agreements.get(c.code);
    if (a && a.status === '見送り') continue;
    for (const p of c.basket) {
      if (hasSpecial(c.code, p.code) || used.has(pairKey(c.code, p.code))) continue;
      const from = starts[(p.code.charCodeAt(3) + p.code.charCodeAt(p.code.length - 1) + Number(c.code)) % starts.length];
      if (countFrom(c.code, p.code, from) >= 3) tierCands.push({ c, p, from });
    }
  }
  perCust.clear();
  let tierN = 0;
  const tierRemarks = ['', '', '', '担当者指示', '前回同様', '特別対応'];
  for (const { c, p, from } of rng.shuffle(tierCands)) {
    if (tierN >= 35) break;
    const k = pairKey(c.code, p.code);
    if (used.has(k) || (perCust.get(c.code) ?? 0) >= 2) continue;
    let to: string | null = null;
    if (tierN < 8) {
      to = pickFix(c.code, p.code, from, addMonths(from, 3), '2026-07-01');
      if (to === null) continue;
    }
    const tier = ctx.tiers.get(c.rank) ?? fail('tier');
    let badPm = tier.min - (c.rank === 'S' ? rng.int(2, 4) : rng.int(3, 10)) * 10;
    for (let guard = 0; guard < 10; guard++) {
      if (p.list1 === null || priceAtRate(p.list1, badPm) !== priceAtRate(p.list0, c.ratePm)) break;
      badPm -= 10;
    }
    perCust.set(c.code, (perCust.get(c.code) ?? 0) + 1);
    addPair({
      id: '', type: 'leak_rate_out_of_tier', cust: c.code, sku: p.code, from, to, badPm, special: null, group: '',
      cause: to ? '受注入力時の手入力単価(途中で修正済み)' : '受注入力時の手入力単価', priceType: '手入力', remark: rng.pick(tierRemarks),
    });
    tierN++;
  }
  return { byPair, tierWhole, all };
}

/* ------------------------------------------------------------------ pricing (history) */

const NOISE_REMARKS = ['午前着指定', '分納', '直送', '至急', '次回まとめて請求', '納品書2部'];
const DISCOUNT_TEXT = (d: number, v: number): string =>
  [`数量値引${d}%`, `数量値引き ${d}%`, `まとめ買い${d}%引`, `大口数量割引(${d}%)`][v];

function systemPrice(
  ctx: Ctx, c: Customer, p: Product, d: string, inj: { byPair: Map<string, Inj[]>; tierWhole: Map<string, Inj> },
): { price: number; priceType: PriceType; inj: Inj | null; special: boolean; kept: string | null } {
  const li = listInfo(ctx, c.code, p.code, d);
  const sp = validSpecial(ctx, c.code, p.code, d);
  for (const x of inj.byPair.get(pairKey(c.code, p.code)) ?? []) {
    if (!active(x, d)) continue;
    if (x.type === 'leak_old_price') return { price: priceAtRate(p.list0, c.ratePm), priceType: x.priceType, inj: x, special: false, kept: null };
    if (x.type === 'leak_expired_special') return { price: (x.special ?? fail('sp')).price, priceType: x.priceType, inj: x, special: false, kept: null };
    return { price: priceAtRate(li.list, x.badPm), priceType: x.priceType, inj: x, special: false, kept: null };
  }
  const tw = inj.tierWhole.get(c.code);
  if (tw && active(tw, d) && !sp) return { price: priceAtRate(li.list, tw.badPm), priceType: '標準', inj: tw, special: false, kept: null };
  if (sp) return { price: sp.price, priceType: '得意先', inj: null, special: true, kept: null };
  const price = priceAtRate(li.list, c.ratePm);
  return { price, priceType: li.kept || c.registered ? '得意先' : '標準', inj: null, special: false, kept: li.kept };
}

function toLine(ev: Ev): Line {
  return {
    date: ev.date, cust: ev.cust.code, sku: ev.sku && ev.kind !== 'freight' ? ev.sku.code : ev.kind === 'freight' ? '9999' : null,
    qty: ev.qty, billed: ev.billed, costSen: ev.costSen, remark: ev.remark, isReturn: ev.kind === 'return',
  };
}

function priceHistory(
  evs: Ev[], ctx: Ctx, inj: { byPair: Map<string, Inj[]>; tierWhole: Map<string, Inj> }, lowMarginPairs: Set<string>,
): void {
  const rng = stream('pricing');
  for (const ev of evs) {
    const c = ev.cust;
    if (ev.kind === 'freight') {
      ev.billed = c.branch.freight;
      ev.list = ev.billed;
      ev.costSen = 65000;
      ev.intent = 'ok_non_product';
    } else if (ev.kind === 'return') {
      const o = ev.orig ?? fail('orig');
      ev.billed = o.billed;
      ev.list = o.list;
      ev.costSen = o.costSen;
      ev.priceType = o.priceType;
      ev.remark = `返品(伝票No.${o.slip})`;
      ev.intent = 'ok_return';
    } else if (ev.kind === 'sample') {
      const p = ev.sku ?? fail('sku');
      ev.billed = 0;
      ev.list = systemList(p, ev.date);
      ev.costSen = costAt(p, ev.date);
      ev.priceType = '手入力';
      ev.remark = rng.pick(['見本品', 'サンプル(無償)']);
      ev.intent = 'ok_sample';
    } else {
      const p = ev.sku ?? fail('sku');
      const sys = systemPrice(ctx, c, p, ev.date, inj);
      ev.list = systemList(p, ev.date);
      ev.costSen = costAt(p, ev.date);
      ev.billed = sys.price;
      ev.priceType = sys.priceType;
      if (sys.inj) {
        ev.intent = sys.inj.type;
        ev.remark = sys.inj.remark;
        ev.injId = sys.inj.group || `${sys.inj.type}:${sys.inj.cust}:${sys.inj.sku}`;
      } else {
        ev.intent = sys.special ? 'ok_special' : sys.kept === 'deferred' ? 'ok_deferred' : sys.kept === 'declined' ? 'ok_declined' : 'ok';
        if (ev.big && !sys.special && sys.kept === null) {
          const d = rng.pick([3, 5]);
          const disc = floorDiv(sys.price * (100 - d), 100);
          if (!isBelowFloor(disc, ev.costSen, FLOOR_PCT + 2)) {
            ev.billed = disc;
            ev.priceType = '手入力';
            ev.remark = DISCOUNT_TEXT(d, rng.int(0, 3));
            ev.intent = 'ok_volume_discount';
          }
        }
      }
      if (ev.remark === '' && rng.chance(0.025)) ev.remark = rng.pick(NOISE_REMARKS);
    }
    const res = classifyHistoryLine(ctx, toLine(ev));
    ev.result = res;
    // the rules must agree with what was injected
    let okIntent = res.label === ev.intent;
    if (!okIntent && res.label === 'leak_below_margin_floor' && ev.kind === 'sale' && ev.sku) {
      const designed = lowMarginPairs.has(pairKey(c.code, ev.sku.code)) || (ev.sku.costUp && ev.date >= COST_UP_KG);
      okIntent = designed && ['ok', 'ok_special'].includes(ev.intent);
    }
    if (!okIntent) {
      fail(`intent ${ev.intent} but rules say ${res.label}: ${ev.date} ${c.code} ${ev.sku?.code} billed=${ev.billed} ref=${res.reference} cost=${ev.costSen}`);
    }
    if (res.label === 'unexplained') fail('unexplained line');
  }
}

/* ------------------------------------------------------------------ next revision (demo) + 反映チェック month */

type Outcome = { cust: string; status: string; eff: string | null; excluded: string[]; note: string };

function buildRev2Outcomes(customers: Customer[]): Map<string, Outcome> {
  const rng = stream('rev2-outcomes');
  const rev2Cats = [...new Set(CATEGORIES.flatMap((c) => c.families.filter((f) => REV2_LIST_PCT[f.supplier] !== undefined).map(() => c.code)))].sort();
  const out = new Map<string, Outcome>();
  for (const c of customers) {
    if (c.ended) continue;
    const r = rng.next();
    let o: Outcome;
    if (c.rank === 'S') {
      o = r < 0.9 ? { cust: c.code, status: '合意', eff: REV2, excluded: [], note: '' } : { cust: c.code, status: '協議中', eff: null, excluded: [], note: '回答待ち' };
    } else if (r < 0.74) {
      o = { cust: c.code, status: '合意', eff: REV2, excluded: [], note: '' };
    } else if (r < 0.84) {
      o = { cust: c.code, status: '合意(適用日変更)', eff: REV2_DEFERRED, excluded: [], note: '先方の締め日に合わせて1月から適用' };
    } else if (r < 0.9) {
      const ex = [rng.pick(rev2Cats)];
      o = { cust: c.code, status: '一部合意', eff: REV2, excluded: ex, note: `${CATEGORIES.find((k) => k.code === ex[0])?.name}は据え置き` };
    } else if (r < 0.94) {
      o = { cust: c.code, status: '見送り', eff: null, excluded: [], note: '次回あらためて協議' };
    } else {
      o = { cust: c.code, status: '協議中', eff: null, excluded: [], note: '回答待ち' };
    }
    out.set(c.code, o);
  }
  return out;
}

type MasterRow = MasterEntry & { cust: Customer; sku: Product };

function buildMaster(
  customers: Customer[], ctx: Ctx, outcomes: Map<string, Outcome>, salesByPair: Map<string, Ev[]>,
  inj: { byPair: Map<string, Inj[]>; tierWhole: Map<string, Inj> },
): MasterRow[] {
  const rows: MasterRow[] = [];
  for (const c of customers) {
    const o = outcomes.get(c.code);
    if (!o || !o.eff || !['合意', '合意(適用日変更)', '一部合意'].includes(o.status)) continue;
    const skus = [...new Set((c.basket.map((p) => p.code)))].sort();
    for (const code of skus) {
      const p = c.basket.find((x) => x.code === code) ?? fail('p');
      if (p.list2 === null || o.excluded.includes(p.cat.code)) continue;
      const recent = (salesByPair.get(pairKey(c.code, p.code)) ?? []).some((e) => e.date >= LAST12_START);
      if (!recent) continue;
      if (validSpecial(ctx, c.code, p.code, o.eff) || validSpecial(ctx, c.code, p.code, REV2)) continue;
      const newPrice = priceAtRate(p.list2, c.ratePm);
      const curPrice = systemPrice(ctx, c, p, '2026-11-30', inj).price;
      if (newPrice <= curPrice) continue;
      rows.push({ cust: c, sku: p, eff: o.eff, newPrice, curPrice });
    }
  }
  return rows;
}

function priceFollowup(
  evs: Ev[], ctx: Ctx, outcomes: Map<string, Outcome>, master: Map<string, MasterRow>,
  inj: { byPair: Map<string, Inj[]>; tierWhole: Map<string, Inj> }, stuck: (c: string, s: string, d: string) => boolean,
  productCat: Map<string, string>,
): void {
  const rng = stream('pricing-followup');
  for (const ev of evs) {
    const c = ev.cust;
    if (ev.kind === 'freight') {
      ev.billed = c.branch.freight;
      ev.list = ev.billed;
      ev.costSen = 65000;
      ev.intent = 'ok_non_product';
    } else if (ev.kind === 'return') {
      const o = ev.orig ?? fail('orig');
      ev.billed = o.billed;
      ev.list = o.list;
      ev.costSen = o.costSen;
      ev.priceType = o.priceType;
      ev.remark = `返品(伝票No.${o.slip})`;
      ev.intent = 'ok_return';
    } else if (ev.kind === 'sample') {
      const p = ev.sku ?? fail('sku');
      ev.billed = 0;
      ev.list = systemList(p, ev.date);
      ev.costSen = costAt(p, ev.date);
      ev.priceType = '手入力';
      ev.remark = rng.pick(['見本品', 'サンプル(無償)']);
      ev.intent = 'ok_sample';
    } else {
      const p = ev.sku ?? fail('sku');
      ev.list = systemList(p, ev.date);
      ev.costSen = costAt(p, ev.date);
      const m = master.get(pairKey(c.code, p.code));
      if (m) {
        if (ev.date < m.eff) {
          ev.billed = m.curPrice;
          ev.priceType = '得意先';
          ev.intent = 'ok_before_effective';
        } else if (stuck(c.code, p.code, ev.date)) {
          ev.billed = m.curPrice;
          ev.priceType = '得意先';
          ev.intent = 'still_old_price';
        } else {
          ev.billed = m.newPrice;
          ev.priceType = c.registered ? '得意先' : '標準';
          ev.intent = 'ok_new_price';
          if (ev.big) {
            const d = rng.pick([3, 5]);
            const disc = floorDiv(m.newPrice * (100 - d), 100);
            if (!isBelowFloor(disc, ev.costSen, FLOOR_PCT + 2)) {
              ev.billed = disc;
              ev.priceType = '手入力';
              ev.remark = DISCOUNT_TEXT(d, rng.int(0, 3));
              ev.intent = 'ok_volume_discount';
            }
          }
        }
      } else {
        ev.intent = 'not_in_master';
        const o = outcomes.get(c.code);
        const sp = validSpecial(ctx, c.code, p.code, ev.date);
        const applies = !!o && !!o.eff && ev.date >= o.eff && ['合意', '合意(適用日変更)', '一部合意'].includes(o.status) && !o.excluded.includes(p.cat.code);
        if (sp) {
          ev.billed = sp.price;
          ev.priceType = '得意先';
        } else if (p.list2 !== null && applies) {
          ev.billed = priceAtRate(p.list2, c.ratePm);
          ev.priceType = c.registered ? '得意先' : '標準';
        } else {
          const sys = systemPrice(ctx, c, p, ev.date, inj);
          ev.billed = sys.price;
          ev.priceType = sys.priceType;
        }
      }
      if (ev.remark === '' && rng.chance(0.025)) ev.remark = rng.pick(NOISE_REMARKS);
    }
    const res = classifyFollowupLine(master as Map<string, MasterEntry>, productCat, toLine(ev));
    if (res.label !== ev.intent) fail(`followup intent ${ev.intent} but rules say ${res.label}: ${ev.date} ${c.code} ${ev.sku?.code}`);
    ev.follow = res;
  }
}

/* ------------------------------------------------------------------ layouts */

const A_OPT: CsvOptions = { bom: true, eol: '\r\n', quoteAll: true };
const B_OPT: CsvOptions = { bom: false, eol: '\n', quoteAll: false };

function codeA(code: string, style: 'hyphen' | 'nohyphen' | 'chouon'): string {
  if (style === 'nohyphen') return toZenkaku(code.replace(/-/g, ''));
  const z = toZenkaku(code);
  return style === 'chouon' ? z.replace(/－/g, 'ー') : z;
}
function codeB(code: string, rng: Rng): string {
  const r = rng.next();
  if (r < 0.85) return code;
  if (r < 0.9) return code.replace(/-/g, '');
  if (r < 0.94) return code.toLowerCase();
  if (r < 0.97) return `${code} `;
  return code.replace(/-/g, '－');
}
const PRICE_TYPE_B: Record<PriceType, string> = { 標準: '0', 得意先: '1', 手入力: '9' };

const A_HEADER = ['売上日', '伝票番号', '行', '取引区分', '部門', '得意先コード', '得意先名', '商品コード', '商品名', '数量', '単位', '定価', '掛率(%)', '単価', '金額', '原単価', '原価金額', '粗利額', '単価区分', '備考'];
const B_HEADER = ['伝票日付', '伝票No', '明細No', '得意先CD', '得意先略称', '品番', '品名', '売上区分', '数量', '単位', '標準価格', '掛率', '売単価', '売上金額', '原価単価', '原価金額', '単価種別', '摘要'];

function salesRows(evs: Ev[], label: string): { a: string[][]; b: string[][] } {
  const rng = stream(`layoutB:${label}`);
  const a: string[][] = [];
  const b: string[][] = [];
  for (const ev of evs) {
    const c = ev.cust;
    const isFreight = ev.kind === 'freight';
    const code = isFreight ? '9999' : (ev.sku ?? fail('sku')).code;
    const name = isFreight ? '運賃' : (ev.sku ?? fail('sku')).name;
    const unit = isFreight ? '式' : (ev.sku ?? fail('sku')).unit;
    const amount = ev.billed * ev.qty;
    const costAmt = senTimesQtyToYen(ev.costSen, ev.qty);
    const rateA = ev.list > 0 ? ((ev.billed * 100) / ev.list).toFixed(1) : '0.0';
    const rateB = ev.list > 0 ? (ev.billed / ev.list).toFixed(3) : '0.000';
    a.push([
      warekiShort(ev.date), String(ev.slip), String(ev.line), ev.kind === 'return' ? '返品' : '売上', c.branch.name,
      toZenkaku(c.code), c.name, isFreight ? toZenkaku(code) : codeA(code, c.branch.style), toZenkaku(name),
      String(ev.qty), unit, withCommas(ev.list), rateA, withCommas(ev.billed), withCommas(amount),
      senToYen(ev.costSen, true), withCommas(costAmt), withCommas(amount - costAmt), ev.priceType, toZenkaku(ev.remark),
    ]);
    b.push([
      compactDate(ev.date), String(ev.slip), String(ev.line), String(Number(c.code)), toHankaku(c.short),
      isFreight ? code : codeB(code, rng), toHankaku(name), ev.kind === 'return' ? '2' : '1', String(ev.qty),
      toHankaku(unit), String(ev.list), rateB, String(ev.billed), String(amount), senToYen(ev.costSen, false),
      String(costAmt), PRICE_TYPE_B[ev.priceType], toHankaku(ev.remark),
    ]);
  }
  return { a, b };
}

/* ------------------------------------------------------------------ main */

function main(): void {
  const products = buildProducts();
  const productBy = new Map(products.map((p) => [p.code, p]));
  const customers = buildCustomers(products);
  const custBy = new Map(customers.map((c) => [c.code, c]));
  const agreements = buildRev1Agreements(customers);

  const ctx: Ctx = {
    floorPct: FLOOR_PCT,
    revisionDate: REV1,
    tiers: new Map(TIERS.map((t) => [t.rank, { min: t.min, max: t.max }])),
    customers: new Map(customers.map((c) => [c.code, { rank: c.rank, ratePm: c.ratePm }])),
    productCat: new Map(products.map((p) => [p.code, p.cat.code])),
    listHist: new Map(products.map((p) => [
      p.code,
      p.list1 === null
        ? [{ price: p.list0, start: '2024-04-01', end: null }]
        : [{ price: p.list0, start: '2024-04-01', end: addDays(REV1, -1) }, { price: p.list1, start: REV1, end: null }],
    ])),
    agreements: new Map([...agreements.values()].map((a) => [a.cust, { status: a.status, eff: a.eff, excluded: new Set(a.excluded) }])),
    specials: new Map(),
  };

  // orders (history)
  const histMonths = monthsBetween(HIST_START, HIST_END);
  const histSlips = generateOrders(customers, histMonths, 'orders', HIST_END);
  const histEvs = numberSlips(histSlips, 1000001);
  const salesByPair = new Map<string, Ev[]>();
  for (const ev of histEvs) {
    if (ev.kind !== 'sale' || !ev.sku) continue;
    const k = pairKey(ev.cust.code, ev.sku.code);
    const arr = salesByPair.get(k) ?? [];
    arr.push(ev);
    salesByPair.set(k, arr);
  }

  const specials = buildSpecials(customers, ctx, salesByPair);
  const lowMarginPairs = new Set(specials.filter((s) => s.lowMargin).map((s) => pairKey(s.cust, s.sku)));
  const inj = chooseInjections(customers, ctx, agreements, specials, salesByPair);
  priceHistory(histEvs, ctx, inj, lowMarginPairs);

  // next revision demo + 反映チェック month
  const outcomes = buildRev2Outcomes(customers);
  const masterRows = buildMaster(customers, ctx, outcomes, salesByPair, inj);
  const master = new Map(masterRows.map((r) => [pairKey(r.cust.code, r.sku.code), r]));
  const followCustomers = customers.filter((c) => !c.ended);
  const followSlips = generateOrders(followCustomers, [FOLLOW_MONTH], 'orders-dec', '2026-12-28');
  const lastSlip = histEvs[histEvs.length - 1].slip;
  const followEvs = numberSlips(followSlips, Math.ceil((lastSlip + 5000) / 1000) * 1000 + 1);

  const stuckRng = stream('stuck');
  const decPairs = new Map<string, Set<string>>();
  for (const ev of followEvs) {
    if (ev.kind !== 'sale' || !ev.sku) continue;
    const m = master.get(pairKey(ev.cust.code, ev.sku.code));
    if (!m || ev.date < m.eff) continue;
    const s = decPairs.get(ev.cust.code) ?? new Set<string>();
    s.add(ev.sku.code);
    decPairs.set(ev.cust.code, s);
  }
  const bigStuck = [...decPairs.entries()]
    .filter(([code, s]) => s.size >= 8 && outcomes.get(code)?.status === '合意')
    .map(([code]) => code)
    .sort();
  stuckRng.shuffle(bigStuck);
  const stuckWhole = bigStuck[0];
  const stuckPartial = bigStuck[1];
  const stuckPairs = new Set<string>();
  for (const [code, s] of [...decPairs.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (code === stuckWhole || code === stuckPartial) continue;
    for (const sku of [...s].sort()) if (stuckRng.chance(0.06)) stuckPairs.add(pairKey(code, sku));
  }
  const stuck = (c: string, s: string, d: string): boolean =>
    c === stuckWhole || (c === stuckPartial && d <= '2026-12-10') || stuckPairs.has(pairKey(c, s));
  priceFollowup(followEvs, ctx, outcomes, master, inj, stuck, ctx.productCat);

  /* ---------------- write public/sample ---------------- */
  const files: { path: string; rows: number }[] = [];
  const w = (rel: string, header: string[], rows: (string | number)[][], opt: CsvOptions = STANDARD): void => {
    writeCsv(join(SAMPLE_DIR, rel), header, rows, opt);
    files.push({ path: join(SAMPLE_DIR, rel), rows: rows.length });
  };

  writeText(join(SAMPLE_DIR, 'company.json'), `${JSON.stringify({
    note: 'すべて架空のデータです。実在の企業・団体・人物とは関係ありません。',
    name: '架空商事株式会社',
    business: '包装資材・工場用消耗品の卸売(一部自社加工)',
    address: '〒000-0000 架空県見本市中央1-2-3',
    tel: '000-000-0000',
    representative: '代表取締役 見本 太郎',
    branches: BRANCHES.map((b) => b.name),
  }, null, 2)}\n`);
  files.push({ path: join(SAMPLE_DIR, 'company.json'), rows: 1 });

  writeText(join(SAMPLE_DIR, 'demo_settings.json'), `${JSON.stringify({
    note: 'デモの初期設定です(架空)。アプリ側で変更できる前提の値です。',
    marginFloorPct: FLOOR_PCT,
    unitPriceRounding: 'floor',
    unitPriceRoundingNote: '単価 = 定価 × 掛率、円未満切り捨て',
    listPriceRounding: { below1000: 10, below10000: 50, otherwise: 100 },
    historyStart: HIST_START,
    historyEnd: HIST_END,
    previousRevisionDate: REV1,
    demoNextRevisionDate: REV2,
    salesLayouts: ['A', 'B'],
  }, null, 2)}\n`);
  files.push({ path: join(SAMPLE_DIR, 'demo_settings.json'), rows: 1 });

  writeText(join(SAMPLE_DIR, 'README.md'), [
    '# サンプルデータ(架空)',
    '',
    'このフォルダのファイルはすべて架空のデータです。実在の企業・団体・人物・取引とは関係ありません(名前が一致しても無関係です)。',
    '1社(架空商事株式会社)の自社データという想定で、他社の価格データは含みません。',
    '',
    '`data-gen/generate.ts` が固定シードで作ります(`cd data-gen && npm run gen`)。何度作っても同じファイルになります。',
    'ファイルと列の説明は `data-gen/README.md` にあります。',
    '',
    `- 得意先 ${customers.length}社 / 商品 ${withCommas(products.length)}点 / 特値 ${specials.length}件`,
    `- 売上明細 ${HIST_START.slice(0, 7)}〜${HIST_END.slice(0, 7)}: ${withCommas(histEvs.length)}行(販売管理A形式・B形式で同じ内容)`,
    `- 反映チェック用(next/): ${FOLLOW_MONTH.y}年${FOLLOW_MONTH.m}月分の売上明細 ${withCommas(followEvs.length)}行と、デモ用の新単価マスタ ${withCommas(masterRows.length)}行`,
    '',
  ].join('\n'));
  files.push({ path: join(SAMPLE_DIR, 'README.md'), rows: 0 });

  w('rate_tiers.csv', ['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明'],
    TIERS.map((t) => [t.rank, t.label, (t.std / 10).toFixed(1), (t.min / 10).toFixed(1), (t.max / 10).toFixed(1), t.note]));

  w('categories.csv', ['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料'],
    CATEGORIES.map((c) => [c.code, c.name, c.shares[0], c.shares[1], c.shares[2], c.shares[3], c.material]));

  w('suppliers.csv', ['仕入先コード', '仕入先名', '主な取扱カテゴリ'],
    SUPPLIERS.map((s) => [s.code, s.name, [...new Set(products.filter((p) => p.supplier === s.code).map((p) => p.cat.code))].join(';')]));

  w('customers.csv', ['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日'],
    customers.map((c) => [c.code, c.name, c.short, c.type, c.rank, (c.ratePm / 10).toFixed(1), c.branch.name, c.rep, c.pref, c.closing, c.dept, c.since]));

  w('products.csv', ['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)'],
    products.map((p) => [p.code, p.name, p.cat.code, p.unit, systemList(p, HIST_END), senToYen(costAt(p, HIST_END), false), p.supplier, ...p.shares]));

  w('list_price_history.csv', ['商品コード', '定価(円)', '適用開始日', '適用終了日'],
    products.flatMap((p) => (ctx.listHist.get(p.code) ?? []).map((r) => [p.code, r.price, r.start, r.end ?? ''])));

  w('cost_history.csv', ['商品コード', '原単価(円)', '適用開始日', '適用終了日'],
    products.flatMap((p) => {
      const pts = p.costs.filter((c) => c.kind === '実績');
      return pts.map((c, i) => [p.code, senToYen(c.sen, false), c.start, i + 1 < pts.length ? addDays(pts[i + 1].start, -1) : '']);
    }));

  const noticeRows: (string | number)[][] = [];
  for (const n of NOTICES) {
    const sup = SUPPLIERS.find((s) => s.code === n.supplier) ?? fail('sup');
    for (const p of products) {
      if (p.supplier !== n.supplier) continue;
      const i = p.costs.findIndex((c) => c.start === n.eff);
      const before = p.costs[i - 1].sen;
      const after = p.costs[i].sen;
      noticeRows.push([n.notified, sup.code, sup.name, p.code, p.name, senToYen(before, false), senToYen(after, false),
        ((after * 100) / before - 100).toFixed(1), n.eff, n.reason, n.eff <= HIST_END ? '適用済み' : '予定']);
    }
  }
  w('supplier_notices.csv', ['通知日', '仕入先コード', '仕入先名', '商品コード', '商品名', '現行仕入単価(円)', '改定後仕入単価(円)', '改定率(%)', '適用日', '主な理由', '状態'], noticeRows);

  w('revision_2025-04_agreements.csv', ['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考'],
    customers.map((c) => {
      const a = agreements.get(c.code) ?? fail('ag');
      return [c.code, c.name, a.offered, a.answered, a.status, a.eff ?? '', a.excluded.join(';'), a.note];
    }));

  const spSorted = specials.slice().sort((x, y) => (x.cust !== y.cust ? (x.cust < y.cust ? -1 : 1) : x.sku !== y.sku ? (x.sku < y.sku ? -1 : 1) : x.start < y.start ? -1 : 1));
  w('special_prices_A.csv', ['得意先コード', '得意先名', '商品コード', '商品名', '特値単価', '開始日', '終了日', '登録理由'],
    spSorted.map((s) => {
      const c = custBy.get(s.cust) ?? fail('c');
      const p = productBy.get(s.sku) ?? fail('p');
      return [toZenkaku(c.code), c.name, codeA(p.code, 'hyphen'), toZenkaku(p.name), withCommas(s.price), warekiLong(s.start), s.end ? warekiLong(s.end) : '', s.reason];
    }), A_OPT);
  w('special_prices_B.csv', ['得意先CD', '品番', '特価', '有効開始日', '有効終了日', '摘要'],
    spSorted.map((s) => [String(Number(s.cust)), s.sku, String(s.price), compactDate(s.start), s.end ? compactDate(s.end) : '99991231', toHankaku(s.reason)]), B_OPT);

  const hist = salesRows(histEvs, 'history');
  w('sales_A_202410-202609.csv', A_HEADER, hist.a, A_OPT);
  w('sales_B_202410-202609.csv', B_HEADER, hist.b, B_OPT);

  // next/: demo outcome of the next revision and the 反映チェック month
  w('next/list_prices_20261201.csv', ['商品コード', '商品名', '現定価(円)', '新定価(円)', '適用日'],
    products.filter((p) => p.list2 !== null).map((p) => [p.code, p.name, p.list1 ?? p.list0, p.list2 ?? 0, REV2]));
  w('next/revision_2026-12_outcomes.csv', ['得意先コード', '得意先名', '協議結果', '適用日', '対象外カテゴリ', '備考'],
    customers.filter((c) => outcomes.has(c.code)).map((c) => {
      const o = outcomes.get(c.code) ?? fail('o');
      return [c.code, c.name, o.status, o.eff ?? '', o.excluded.join(';'), o.note];
    }));
  w('next/price_master_A_20261201.csv', ['得意先コード', '得意先名', '商品コード', '商品名', '適用開始日', '新単価', '現単価'],
    masterRows.map((r) => [toZenkaku(r.cust.code), r.cust.name, codeA(r.sku.code, r.cust.branch.style), toZenkaku(r.sku.name), warekiShort(r.eff), withCommas(r.newPrice), withCommas(r.curPrice)]), A_OPT);
  w('next/price_master_B_20261201.csv', ['得意先CD', '品番', '適用開始日', '売単価', '旧売単価'],
    masterRows.map((r) => [String(Number(r.cust.code)), r.sku.code, compactDate(r.eff), String(r.newPrice), String(r.curPrice)]), B_OPT);
  const fol = salesRows(followEvs, 'followup');
  w('next/sales_A_202612.csv', A_HEADER, fol.a, A_OPT);
  w('next/sales_B_202612.csv', B_HEADER, fol.b, B_OPT);

  /* ---------------- write truth ---------------- */
  const truthFiles: { path: string; rows: number }[] = [];
  const t = (rel: string, header: string[], rows: (string | number)[][]): void => {
    writeCsv(join(TRUTH_DIR, rel), header, rows, STANDARD);
    truthFiles.push({ path: join(TRUTH_DIR, rel), rows: rows.length });
  };

  // issues: one row per (type, customer, SKU)
  type Agg = { type: string; cust: string; sku: string; cause: string; group: string; fixed: boolean; lines: number; first: string; last: string; total: number; last12: number; floorLast12: number; ongoing: boolean };
  const agg = new Map<string, Agg>();
  const injCause = new Map<string, Inj>();
  for (const x of inj.all) injCause.set(x.group || `${x.type}:${x.cust}:${x.sku}`, x);
  for (const ev of histEvs) {
    const r = ev.result ?? fail('result');
    if (!(LEAK_TYPES as readonly string[]).includes(r.label) || !ev.sku) continue;
    const key = `${r.label}|${ev.cust.code}|${ev.sku.code}`;
    let a = agg.get(key);
    if (!a) {
      let cause = '';
      let group = '';
      let fixed = false;
      if (r.label === 'leak_below_margin_floor') {
        cause = lowMarginPairs.has(pairKey(ev.cust.code, ev.sku.code)) ? '特値の設定が粗利下限を下回る' : '仕入値上げ(2026年4月)後も定価を据え置き';
      } else {
        const x = injCause.get(ev.injId) ?? fail(`no injection ${ev.injId}`);
        cause = x.cause;
        group = x.group;
        fixed = x.to !== null;
      }
      a = { type: r.label, cust: ev.cust.code, sku: ev.sku.code, cause, group, fixed, lines: 0, first: ev.date, last: ev.date, total: 0, last12: 0, floorLast12: 0, ongoing: false };
      agg.set(key, a);
    }
    a.lines++;
    a.last = ev.date;
    a.total += r.shortfall;
    if (ev.date >= LAST12_START) {
      a.last12 += r.shortfall;
      a.floorLast12 += r.floorGap;
    }
  }
  // "ongoing" = not fixed, and the pair's last sale in the history is still affected
  const lastSale = new Map<string, string>();
  for (const [k, arr] of salesByPair) lastSale.set(k, arr[arr.length - 1].date);
  const typeOrder = new Map<string, number>(LEAK_TYPES.map((x, i) => [x, i]));
  const issues = [...agg.values()].sort((x, y) =>
    (typeOrder.get(x.type) ?? 0) - (typeOrder.get(y.type) ?? 0) || (x.cust < y.cust ? -1 : x.cust > y.cust ? 1 : x.sku < y.sku ? -1 : 1));
  const prefix: Record<string, string> = { leak_old_price: 'REV', leak_expired_special: 'EXP', leak_rate_out_of_tier: 'TIER', leak_below_margin_floor: 'FLOOR' };
  const counters: Record<string, number> = {};
  const issueId = new Map<string, string>();
  for (const a of issues) {
    a.ongoing = !a.fixed && a.last === lastSale.get(pairKey(a.cust, a.sku));
    counters[a.type] = (counters[a.type] ?? 0) + 1;
    issueId.set(`${a.type}|${a.cust}|${a.sku}`, `${prefix[a.type]}-${String(counters[a.type]).padStart(4, '0')}`);
  }
  t('issues.csv', ['issue_id', 'type', 'type_ja', 'cause', 'group', 'cust', 'cust_name', 'sku', 'sku_name', 'first_date', 'last_date', 'ongoing', 'lines', 'shortfall_total_yen', 'shortfall_last12m_yen', 'floor_gap_last12m_yen'],
    issues.map((a) => [issueId.get(`${a.type}|${a.cust}|${a.sku}`) ?? '', a.type, LABEL_JA[a.type], a.cause, a.group, a.cust, (custBy.get(a.cust) ?? fail('c')).name,
      a.sku, (productBy.get(a.sku) ?? fail('p')).name, a.first, a.last, a.ongoing ? 1 : 0, a.lines, a.total, a.last12, a.floorLast12]));

  t('lines.csv', ['line_id', 'date', 'cust', 'sku', 'qty', 'billed', 'reference', 'reference_kind', 'label', 'issue_id', 'shortfall_yen', 'below_floor', 'floor_price', 'floor_gap_yen', 'last12m'],
    histEvs.map((ev) => {
      const r = ev.result ?? fail('result');
      const sku = ev.kind === 'freight' ? '9999' : ev.sku?.code ?? '';
      return [`${ev.slip}-${ev.line}`, ev.date, ev.cust.code, sku, ev.qty, ev.billed, r.reference, r.refKind, r.label,
        issueId.get(`${r.label}|${ev.cust.code}|${sku}`) ?? '', r.shortfall, r.belowFloor ? 1 : 0, r.floorPrice, r.floorGap, ev.date >= LAST12_START ? 1 : 0];
    }));

  t('followup_lines.csv', ['line_id', 'date', 'cust', 'sku', 'qty', 'billed', 'expected', 'label', 'shortfall_yen'],
    followEvs.map((ev) => {
      const f = ev.follow ?? fail('follow');
      return [`${ev.slip}-${ev.line}`, ev.date, ev.cust.code, ev.kind === 'freight' ? '9999' : ev.sku?.code ?? '', ev.qty, ev.billed, f.expected, f.label, f.shortfall];
    }));

  /* ---------------- summary ---------------- */
  const countBy = <T>(arr: T[], key: (x: T) => string): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const x of arr) o[key(x)] = (o[key(x)] ?? 0) + 1;
    return Object.fromEntries(Object.entries(o).sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  };
  const leakSummary = LEAK_TYPES.map((type) => {
    const rows = issues.filter((a) => a.type === type);
    return {
      type, type_ja: LABEL_JA[type],
      pairs: rows.length,
      customers: new Set(rows.map((a) => a.cust)).size,
      lines: rows.reduce((s, a) => s + a.lines, 0),
      lines_last12m: histEvs.filter((ev) => ev.result?.label === type && ev.date >= LAST12_START).length,
      ongoing_pairs: rows.filter((a) => a.ongoing).length,
      shortfall_total_yen: rows.reduce((s, a) => s + a.total, 0),
      shortfall_last12m_yen: rows.reduce((s, a) => s + a.last12, 0),
    };
  });
  const followLabels = countBy(followEvs, (ev) => (ev.follow ?? fail('f')).label);
  const stuckShort = followEvs.reduce((s, ev) => s + (ev.follow?.label === 'still_old_price' ? ev.follow.shortfall : 0), 0);
  const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
  const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');
  const sales = histEvs.filter((e) => e.kind === 'sale');
  const summary = {
    note: '正解データ(架空)。アプリからは読みません。',
    seed: 'tenka-desk-sample-v1',
    params: {
      historyStart: HIST_START, historyEnd: HIST_END, last12mStart: LAST12_START, previousRevision: REV1,
      kgCostUp: COST_UP_KG, demoNextRevision: REV2, marginFloorPct: FLOOR_PCT,
    },
    counts: {
      customers: customers.length,
      products: products.length,
      specials: specials.length,
      specialsLowMargin: specials.filter((s) => s.lowMargin).length,
      historyLines: histEvs.length,
      historySlips: new Set(histEvs.map((e) => e.slip)).size,
      followupLines: followEvs.length,
      masterRows: masterRows.length,
      salesAmountLast12mYen: sales.filter((e) => e.date >= LAST12_START).reduce((s, e) => s + e.billed * e.qty, 0),
    },
    historyLabels: countBy(histEvs, (e) => (e.result ?? fail('r')).label),
    leaks: leakSummary,
    wholeCustomerGroups: inj.all.filter((x) => x.group).map((x) => ({ group: x.group, cust: x.cust, from: x.from, to: x.to, cause: x.cause }))
      .filter((x, i, arr) => arr.findIndex((y) => y.group === x.group) === i),
    followup: { labels: followLabels, stuckWholeCustomer: stuckWhole, stuckUntil20261210Customer: stuckPartial, stillOldPriceShortfallYen: stuckShort },
    files: [...files, ...truthFiles].map((f) => ({ path: rel(f.path), rows: f.rows, sha256: sha(f.path) })),
  };
  writeText(join(TRUTH_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  // console report
  console.log(`customers=${customers.length} products=${products.length} specials=${specials.length}`);
  console.log(`history lines=${histEvs.length} followup lines=${followEvs.length} master rows=${masterRows.length}`);
  for (const l of leakSummary) {
    console.log(`${l.type.padEnd(24)} pairs=${String(l.pairs).padStart(4)} lines=${String(l.lines).padStart(5)} last12m=¥${withCommas(l.shortfall_last12m_yen)}`);
  }
  console.log('history labels', JSON.stringify(summary.historyLabels));
  console.log('followup labels', JSON.stringify(followLabels));
}

main();
