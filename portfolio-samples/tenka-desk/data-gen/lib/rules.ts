/**
 * Diagnosis rules that define the ground truth.
 *
 * The generator prices every line through these functions and asserts that the
 * label it intended (injected leak, legitimate noise, clean) is what the rules
 * return. verify.ts runs the same rules on the parsed CSV files. An app that
 * implements these rules on the sample files should reproduce truth/ exactly.
 *
 * All money is integer yen, cost is integer sen (1/100 yen), rates are permille.
 */

export type TierRange = { min: number; max: number };
export type ListRow = { price: number; start: string; end: string | null };
export type AgreementRow = { status: string; eff: string | null; excluded: Set<string> };
export type SpecialRow = { price: number; start: string; end: string | null };

export type Ctx = {
  floorPct: number;
  /** Date of the past list price revision (前回改定日). */
  revisionDate: string;
  tiers: Map<string, TierRange>;
  customers: Map<string, { rank: string; ratePm: number }>;
  productCat: Map<string, string>;
  listHist: Map<string, ListRow[]>;
  agreements: Map<string, AgreementRow>;
  /** key `${cust}|${sku}` */
  specials: Map<string, SpecialRow[]>;
};

export type Line = {
  date: string;
  cust: string;
  /** canonical 商品コード, or null / unknown for non-product lines (運賃) */
  sku: string | null;
  qty: number;
  billed: number;
  costSen: number;
  remark: string;
  isReturn: boolean;
};

export type HistoryLabel =
  | 'ok'
  | 'ok_special'
  | 'ok_deferred'
  | 'ok_declined'
  | 'ok_volume_discount'
  | 'ok_return'
  | 'ok_sample'
  | 'ok_non_product'
  | 'leak_old_price'
  | 'leak_expired_special'
  | 'leak_rate_out_of_tier'
  | 'leak_below_margin_floor'
  | 'unexplained'
  | 'overcharge';

export const LABEL_JA: Record<string, string> = {
  ok: '正常',
  ok_special: '特値(期間内)',
  ok_deferred: '旧価格(適用日前・後ろ倒し合意)',
  ok_declined: '旧価格(改定見送り・対象外カテゴリ)',
  ok_volume_discount: '数量値引(備考あり)',
  ok_return: '返品',
  ok_sample: '見本品(無償)',
  ok_non_product: '商品以外(運賃)',
  leak_old_price: '反映漏れ(旧価格のまま)',
  leak_expired_special: '特値の期限切れ',
  leak_rate_out_of_tier: '掛率ランク外',
  leak_below_margin_floor: '粗利下限割れ',
  unexplained: '原因不明の価格差',
  overcharge: '基準より高い請求(漏れに含めない)',
  ok_new_price: '新価格で請求',
  ok_before_effective: '適用日前(旧価格で正しい)',
  still_old_price: '旧価格のまま(反映漏れ)',
  not_in_master: '新単価マスタの対象外',
  other_diff: 'その他の差異',
};

export const LEAK_TYPES = [
  'leak_old_price',
  'leak_expired_special',
  'leak_rate_out_of_tier',
  'leak_below_margin_floor',
] as const;

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function pairKey(cust: string, sku: string): string {
  return `${cust}|${sku}`;
}

/** 単価 = 定価 × 掛率 (円未満切り捨て) */
export function priceAtRate(list: number, ratePm: number): number {
  return floorDiv(list * ratePm, 1000);
}

/** 粗利率 < floorPct ⇔ price × (100 − f) < cost(sen) */
export function isBelowFloor(price: number, costSen: number, floorPct: number): boolean {
  return price * (100 - floorPct) < costSen;
}

/** Smallest yen price whose margin is at least floorPct. */
export function floorPrice(costSen: number, floorPct: number): number {
  return Math.ceil(costSen / (100 - floorPct));
}

/**
 * Volume discount written in 備考 (e.g. "数量値引3%", "まとめ買い5%引", "大口数量割引(5%)").
 * Returns the percent, or null.
 */
export function parseVolumeDiscount(remark: string): number | null {
  const r = remark.normalize('NFKC');
  if (!/(値引|割引|%引)/.test(r)) return null;
  const m = /(\d+)\s*%/.exec(r);
  return m ? Number(m[1]) : null;
}

/** 無償品: 単価0 with 「見本」「サンプル」「無償」「試供」 in the remark (the same words as the app). */
export function isSampleRemark(remark: string): boolean {
  return /(見本|サンプル|無償|試供)/.test(remark.normalize('NFKC'));
}

export type ListInfo = {
  /** 定価 that applies to this customer on this date */
  list: number;
  /** pre-revision 定価 when the customer should already be on the new one */
  prevList: number | null;
  /** why the customer is legitimately still on the previous 定価 */
  kept: 'deferred' | 'declined' | null;
};

export function listRowAt(rows: ListRow[], date: string): { row: ListRow; prev: ListRow | null } {
  let idx = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i].start <= date) idx = i;
  if (idx < 0) throw new Error(`no list price on ${date}`);
  return { row: rows[idx], prev: idx > 0 ? rows[idx - 1] : null };
}

export function listInfo(ctx: Ctx, cust: string, sku: string, date: string): ListInfo {
  const rows = ctx.listHist.get(sku);
  if (!rows) throw new Error(`no list price history for ${sku}`);
  const { row, prev } = listRowAt(rows, date);
  if (!prev || row.start !== ctx.revisionDate) return { list: row.price, prevList: null, kept: null };
  const ag = ctx.agreements.get(cust);
  const cat = ctx.productCat.get(sku) ?? '';
  if (!ag || ag.status.startsWith('対象外')) return { list: row.price, prevList: prev.price, kept: null };
  if (ag.status === '見送り' || ag.excluded.has(cat)) return { list: prev.price, prevList: null, kept: 'declined' };
  if (ag.eff && date < ag.eff) return { list: prev.price, prevList: null, kept: 'deferred' };
  return { list: row.price, prevList: prev.price, kept: null };
}

export function validSpecial(ctx: Ctx, cust: string, sku: string, date: string): SpecialRow | null {
  const list = ctx.specials.get(pairKey(cust, sku));
  if (!list) return null;
  for (const sp of list) {
    if (sp.start <= date && (sp.end === null || date <= sp.end)) return sp;
  }
  return null;
}

export type HistoryResult = {
  label: HistoryLabel;
  /** 正しい単価 (valid 特値, or 定価 × 掛率 under the customer's agreement) */
  reference: number;
  refKind: 'special' | 'standard' | 'deferred' | 'declined' | 'none';
  /** (reference − billed) × qty for the billing leaks, (floor price − billed) × qty for 粗利下限割れ */
  shortfall: number;
  belowFloor: boolean;
  floorPrice: number;
  /** (floor price − billed) × qty whenever the line is below the floor (also for other leaks) */
  floorGap: number;
};

const NONE: Omit<HistoryResult, 'label'> = {
  reference: 0, refKind: 'none', shortfall: 0, belowFloor: false, floorPrice: 0, floorGap: 0,
};

export function classifyHistoryLine(ctx: Ctx, ln: Line): HistoryResult {
  if (!ln.sku || !ctx.productCat.has(ln.sku)) return { label: 'ok_non_product', ...NONE };
  if (ln.isReturn || ln.qty < 0) return { label: 'ok_return', ...NONE };
  if (ln.billed === 0 && isSampleRemark(ln.remark)) return { label: 'ok_sample', ...NONE };

  const c = ctx.customers.get(ln.cust);
  if (!c) throw new Error(`unknown customer ${ln.cust}`);
  const tier = ctx.tiers.get(c.rank);
  if (!tier) throw new Error(`unknown rank ${c.rank}`);
  const li = listInfo(ctx, ln.cust, ln.sku, ln.date);
  const sp = validSpecial(ctx, ln.cust, ln.sku, ln.date);
  const reference = sp ? sp.price : priceAtRate(li.list, c.ratePm);
  const refKind = sp ? 'special' : li.kept ?? 'standard';
  const fp = floorPrice(ln.costSen, ctx.floorPct);
  const below = isBelowFloor(ln.billed, ln.costSen, ctx.floorPct);
  const floorGap = below ? (fp - ln.billed) * ln.qty : 0;
  const base = { reference, refKind, belowFloor: below, floorPrice: fp, floorGap } as const;
  const gap = (reference - ln.billed) * ln.qty;

  if (ln.billed === reference) {
    if (below) return { label: 'leak_below_margin_floor', ...base, shortfall: floorGap };
    const label: HistoryLabel = sp ? 'ok_special' : li.kept === 'deferred' ? 'ok_deferred' : li.kept === 'declined' ? 'ok_declined' : 'ok';
    return { label, ...base, shortfall: 0 };
  }
  const disc = parseVolumeDiscount(ln.remark);
  if (disc !== null && ln.billed === floorDiv(reference * (100 - disc), 100)) {
    return { label: 'ok_volume_discount', ...base, shortfall: 0 };
  }
  // billing above the correct price is not a profit leak (only the margin floor can still count)
  if (ln.billed > reference)
    return below
      ? { label: 'leak_below_margin_floor', ...base, shortfall: floorGap }
      : { label: 'overcharge', ...base, shortfall: 0 };
  if (li.prevList !== null && ln.billed === priceAtRate(li.prevList, c.ratePm)) {
    return { label: 'leak_old_price', ...base, shortfall: gap };
  }
  for (const old of ctx.specials.get(pairKey(ln.cust, ln.sku)) ?? []) {
    if (old.end !== null && old.end < ln.date && ln.billed === old.price) {
      return { label: 'leak_expired_special', ...base, shortfall: gap };
    }
  }
  // bills above the correct price have returned above: the upper limit counts only when
  // the correct price itself is above the range (a 掛率 or 特値 above the rank)
  if (ln.billed < priceAtRate(li.list, tier.min) || ln.billed > priceAtRate(li.list, tier.max)) {
    return { label: 'leak_rate_out_of_tier', ...base, shortfall: gap };
  }
  return { label: 'unexplained', ...base, shortfall: gap };
}

/* ---------- 反映チェック (later month against the new price master) ---------- */

export type MasterEntry = { eff: string; newPrice: number; curPrice: number };

export type FollowupLabel =
  | 'ok_new_price'
  | 'ok_before_effective'
  | 'ok_volume_discount'
  | 'still_old_price'
  | 'not_in_master'
  | 'ok_return'
  | 'ok_sample'
  | 'ok_non_product'
  | 'other_diff';

export type FollowupResult = { label: FollowupLabel; expected: number; shortfall: number };

export function classifyFollowupLine(
  master: Map<string, MasterEntry>,
  productCat: Map<string, string>,
  ln: Line,
): FollowupResult {
  if (!ln.sku || !productCat.has(ln.sku)) return { label: 'ok_non_product', expected: 0, shortfall: 0 };
  if (ln.isReturn || ln.qty < 0) return { label: 'ok_return', expected: 0, shortfall: 0 };
  if (ln.billed === 0 && isSampleRemark(ln.remark)) return { label: 'ok_sample', expected: 0, shortfall: 0 };
  const m = master.get(pairKey(ln.cust, ln.sku));
  if (!m) return { label: 'not_in_master', expected: 0, shortfall: 0 };
  const effective = ln.date >= m.eff;
  const expected = effective ? m.newPrice : m.curPrice;
  if (ln.billed === expected) {
    return { label: effective ? 'ok_new_price' : 'ok_before_effective', expected, shortfall: 0 };
  }
  const disc = parseVolumeDiscount(ln.remark);
  if (disc !== null && ln.billed === floorDiv(expected * (100 - disc), 100)) {
    return { label: 'ok_volume_discount', expected, shortfall: 0 };
  }
  if (effective && ln.billed === m.curPrice) {
    return { label: 'still_old_price', expected, shortfall: (expected - ln.billed) * ln.qty };
  }
  return { label: 'other_diff', expected, shortfall: (expected - ln.billed) * ln.qty };
}
