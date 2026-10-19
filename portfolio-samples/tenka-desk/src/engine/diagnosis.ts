/**
 * 利益漏れの診断.
 *
 * Every sales line is compared with the unit price the customer should pay
 * (Dataset.expectedPrice: a valid 特値, else 定価 × 掛率 under the customer's
 * revision answers). Lines that do not match are explained by checking, in order:
 *
 *  1. 反映漏れ — billed at the previous 定価 × 掛率 after the customer should have moved
 *  2. 特値の期限切れ — billed at a 特値 whose period has ended
 *  3. 掛率ランク外 — billed outside 定価 × the customer's rank range (下限〜上限)
 *  4. otherwise 価格差（原因不明） for a person to look at
 *
 * A bill above the expected price is never a profit leak: it is counted as
 * 基準より高い請求 (overcharge) for a person to check, and left out of the leak
 * amounts and rollups (billing the old, higher 定価 after a 定価 cut, or above the
 * rank's upper limit).
 *
 * Independently, every line is checked against the 粗利率の下限 (粗利下限割れ).
 * A line can carry several flags; its primary type follows the order above, with
 * 粗利下限割れ last. Excluded from the check: returns, codes that are not in the
 * product master (運賃 etc.), and free goods (無償品): lines with 単価0 and one of
 * 「見本」「サンプル」「無償」「試供」 in the remark (text.ts isSampleRemark). Free
 * goods are not leaks; they are counted apart, at 定価 (freeGoods). A 0-yen line
 * without those words is judged like any other line.
 *
 * The yearly impact (年間影響額) is the actual shortfall over the last 12 calendar
 * months of the data, not a forecast.
 */

import type { ApplicableList, Dataset, ExpectedPrice } from './dataset.ts';
import { pairKey } from './dataset.ts';
import { type IsoDate, toWareki, trailingMonths } from './dates.ts';
import { divide, isBelowMarginFloor, marginBp, marginFloorPrice, priceAtRate } from './money.ts';
import {
  formatBp,
  formatPm,
  formatRatioPct,
  formatSen,
  formatYen,
  isSampleRemark,
  parseRemarkDiscount,
} from './text.ts';
import type { SalesLine, SpecialPrice } from './types.ts';

export type LeakType = 'old_price' | 'expired_special' | 'rate_out_of_tier' | 'below_margin_floor';

export const LEAK_TYPES: readonly LeakType[] = [
  'old_price',
  'expired_special',
  'rate_out_of_tier',
  'below_margin_floor',
];

export const LEAK_LABEL_JA: Record<LeakType, string> = {
  old_price: '反映漏れ（旧価格のまま）',
  expired_special: '特値の期限切れ',
  rate_out_of_tier: '掛率ランク外',
  below_margin_floor: '粗利下限割れ',
};

/** Short labels for tables (the long ones explain; these fit one line). */
export const LEAK_SHORT_JA: Record<LeakType, string> = {
  old_price: '反映漏れ',
  expired_special: '特値期限切れ',
  rate_out_of_tier: '掛率ランク外',
  below_margin_floor: '粗利下限割れ',
};

export type LineStatus =
  | 'ok'
  | 'ok_special'
  | 'ok_kept_price'
  | 'ok_volume_discount'
  | 'leak'
  | 'price_mismatch'
  | 'overcharge'
  | 'excluded_return'
  | 'excluded_sample'
  | 'excluded_non_product'
  | 'excluded_unknown_customer'
  | 'excluded_no_list_price';

export const LINE_STATUS_JA: Record<LineStatus, string> = {
  ok: '正常',
  ok_special: '特値（期間内）',
  ok_kept_price: '旧定価のまま（合意どおり）',
  ok_volume_discount: '数量値引（備考あり）',
  leak: '利益漏れの可能性',
  price_mismatch: '価格差（原因不明・要確認）',
  overcharge: '基準より高い請求（要確認・漏れには含めない）',
  excluded_return: '対象外：返品',
  excluded_sample: '対象外：見本品（無償）',
  excluded_non_product: '対象外：商品マスタにないコード（運賃など）',
  excluded_unknown_customer: '対象外：得意先マスタにない得意先',
  excluded_no_list_price: '対象外：その日の定価がない',
};

export interface TierBounds {
  rank: string;
  minPm: number;
  maxPm: number;
  minPrice: number;
  maxPrice: number;
}

export interface LineDiagnosis {
  line: SalesLine;
  status: LineStatus;
  /** primary leak type when status is 'leak' */
  leak: LeakType | null;
  /** every leak check the line fails */
  flags: LeakType[];
  expected: ExpectedPrice | null;
  /** (expected − billed) × qty; for 粗利下限割れ alone, (floor price − billed) × qty */
  shortfallYen: number;
  /** price at the previous 定価 (for 反映漏れ) */
  oldPrice: number | null;
  /** the ended 特値 the bill matches */
  expiredSpecial: SpecialPrice | null;
  tier: TierBounds | null;
  costSen: number | null;
  marginBp: number | null;
  floorPrice: number | null;
  /** 粗利率の下限 used for the check (bp) */
  floorBp: number;
  /** volume discount stated in the remark (bp) */
  discountBp: number | null;
  /** the bill differs from the expected price for no known reason (要確認) */
  mismatch: boolean;
  /** billed above the expected price with no stated reason: not a leak, shown for checking */
  overcharge: boolean;
  /** leak types this line could have shown (used to tell customer-wide problems) */
  eligible: LeakType[];
}

export interface DiagnosisOptions {
  /** last day of the data; default: the latest line date */
  asOf?: IsoDate;
  /** months for the yearly impact; default from settings (12) */
  windowMonths?: number;
}

export interface Finding {
  id: string;
  type: LeakType;
  cust: string;
  custName: string;
  sku: string;
  itemName: string;
  firstDate: IsoDate;
  lastDate: IsoDate;
  /** the pair's latest checked line still has this problem */
  ongoing: boolean;
  lineIds: string[];
  lines: number;
  linesInWindow: number;
  shortfallTotalYen: number;
  /** 年間影響額: shortfall over the window (直近12か月) */
  annualImpactYen: number;
  /** for 掛率ランク外: billed below the range (under) or above it (over) */
  direction: 'under' | 'over';
  explanation: string[];
  latest: LineDiagnosis;
}

/**
 * One customer and one leak type. The share compares the affected items with
 * the items the customer bought while the problem lasted (first to last
 * affected line) and that could show it.
 */
export interface CustomerRollup {
  cust: string;
  custName: string;
  type: LeakType;
  affectedPairs: number;
  eligiblePairs: number;
  shareBp: number;
  /** most of the customer's items show the same problem: likely a customer-level cause (e.g. the customer master) */
  wholeCustomer: boolean;
  firstDate: IsoDate;
  lastDate: IsoDate;
  annualImpactYen: number;
}

export interface TypeSummary {
  type: LeakType;
  label: string;
  pairs: number;
  customers: number;
  ongoingPairs: number;
  lines: number;
  linesInWindow: number;
  shortfallTotalYen: number;
  annualImpactYen: number;
}

export interface DiagnosisResult {
  window: { start: IsoDate; end: IsoDate };
  lines: LineDiagnosis[];
  findings: Finding[];
  summary: TypeSummary[];
  customers: CustomerRollup[];
  statusCounts: Record<LineStatus, number>;
  /** sales amount (positive lines, in the window) to put the impact in proportion */
  salesInWindowYen: number;
  /** bills above the expected price (not leaks; shown for checking) */
  overcharges: OverchargeSummary;
  /** free goods (無償品, excluded_sample): not leaks, counted apart at 定価 */
  freeGoods: FreeGoodsSummary;
}

export interface FreeGoodsSummary {
  lines: number;
  linesInWindow: number;
  pairs: number;
  customers: number;
  /** Σ 定価 on the day × qty over all lines (a line without a 定価 that day adds 0) */
  listAmountYen: number;
  /** the same over the window (直近12か月) */
  listAmountInWindowYen: number;
}

export interface OverchargeSummary {
  lines: number;
  pairs: number;
  customers: number;
  /** Σ (billed − expected) × qty over all lines */
  amountYen: number;
  /** the same over the window (直近12か月) */
  amountInWindowYen: number;
}

const PRIMARY_ORDER: readonly LeakType[] = LEAK_TYPES;

function emptyDiagnosis(line: SalesLine, status: LineStatus): LineDiagnosis {
  return {
    line,
    status,
    leak: null,
    flags: [],
    expected: null,
    shortfallYen: 0,
    oldPrice: null,
    expiredSpecial: null,
    tier: null,
    costSen: null,
    marginBp: null,
    floorPrice: null,
    floorBp: 0,
    discountBp: null,
    mismatch: false,
    overcharge: false,
    eligible: [],
  };
}

/** Diagnose one sales line (its `sku` must be resolved; see Dataset.resolveLines). */
export function diagnoseLine(ds: Dataset, line: SalesLine): LineDiagnosis {
  const sku = line.sku ?? ds.resolveSku(line.skuKey);
  if (sku === null) return emptyDiagnosis(line, 'excluded_non_product');
  if (line.isReturn || line.qty < 0) return emptyDiagnosis(line, 'excluded_return');
  if (line.unitPrice === 0 && isSampleRemark(line.remark)) return emptyDiagnosis(line, 'excluded_sample');
  const customer = ds.customers.get(line.cust);
  if (!customer) return emptyDiagnosis(line, 'excluded_unknown_customer');
  const expected = ds.expectedPrice(line.cust, sku, line.date);
  if (!expected) return emptyDiagnosis(line, 'excluded_no_list_price');

  const rounding = ds.settings.unitRounding;
  const billed = line.unitPrice;
  const list = expected.list;
  const tierDef = ds.tierOf(line.cust);
  const tier: TierBounds | null = tierDef
    ? {
        rank: tierDef.rank,
        minPm: tierDef.minPm,
        maxPm: tierDef.maxPm,
        minPrice: priceAtRate(list.price, tierDef.minPm, rounding),
        maxPrice: priceAtRate(list.price, tierDef.maxPm, rounding),
      }
    : null;
  const costSen = line.costSen ?? ds.costAt(sku, line.date);
  const floorBp = ds.settings.marginFloorBp;
  const below = costSen !== null && isBelowMarginFloor(billed, costSen, floorBp);
  const floorPrice = costSen !== null ? marginFloorPrice(costSen, floorBp) : null;
  const oldPrice =
    list.previousPrice !== null ? priceAtRate(list.previousPrice, expected.ratePm, rounding) : null;
  const expiredList = ds.expiredSpecials(line.cust, sku, line.date);
  const discountBp = parseRemarkDiscount(line.remark);

  const eligible: LeakType[] = ['below_margin_floor'];
  if (oldPrice !== null) eligible.push('old_price');
  if (expiredList.length > 0) eligible.push('expired_special');
  if (expected.kind === 'list_rate') eligible.push('rate_out_of_tier');

  const d: LineDiagnosis = {
    line: { ...line, sku },
    status: 'ok',
    leak: null,
    flags: [],
    expected,
    shortfallYen: 0,
    oldPrice,
    expiredSpecial: null,
    tier,
    costSen,
    marginBp: costSen !== null ? marginBp(billed, costSen) : null,
    floorPrice,
    floorBp,
    discountBp,
    mismatch: false,
    overcharge: false,
    eligible,
  };

  let explained: LineStatus | null = null;
  if (billed === expected.price) {
    explained =
      expected.kind === 'special' ? 'ok_special' : list.basis === 'current' ? 'ok' : 'ok_kept_price';
  } else if (discountBp !== null) {
    // the discounted price is rounded like every unit price (設定の単価の端数処理, default 切り捨て)
    if (divide(expected.price * (10000 - discountBp), 10000, rounding) === billed)
      explained = 'ok_volume_discount';
  }

  if (explained === null) {
    if (oldPrice !== null && billed === oldPrice) d.flags.push('old_price');
    const exp = expiredList.find((sp) => sp.price === billed);
    if (exp) {
      d.flags.push('expired_special');
      d.expiredSpecial = exp;
    }
    if (tier && (billed < tier.minPrice || billed > tier.maxPrice)) d.flags.push('rate_out_of_tier');
  }
  if (below) d.flags.push('below_margin_floor');
  d.overcharge = explained === null && billed > expected.price;
  d.mismatch = explained === null && d.flags.every((f) => f === 'below_margin_floor');

  // billing above the expected price is not a leak: only the margin floor can still count
  const leakFlags = d.overcharge ? d.flags.filter((f) => f === 'below_margin_floor') : d.flags;
  const primary = PRIMARY_ORDER.find((t) => leakFlags.includes(t)) ?? null;
  if (primary === null) {
    d.status = explained ?? (d.overcharge ? 'overcharge' : 'price_mismatch');
    d.shortfallYen = explained === null ? (expected.price - billed) * line.qty : 0;
  } else {
    d.status = 'leak';
    d.leak = primary;
    d.shortfallYen =
      primary === 'below_margin_floor'
        ? ((floorPrice ?? billed) - billed) * line.qty
        : (expected.price - billed) * line.qty;
  }
  return d;
}

function listBasisText(list: ApplicableList): string {
  const ag = list.agreement;
  switch (list.basis) {
    case 'kept_declined':
      return `前回の定価改定を見送った得意先のため、旧定価 ${formatYen(list.price)} が基準です`;
    case 'kept_negotiating':
      return `定価改定の協議中のため、旧定価 ${formatYen(list.price)} が基準です`;
    case 'kept_excluded_category':
      return `一部合意で据え置いたカテゴリのため、旧定価 ${formatYen(list.price)} が基準です`;
    case 'kept_before_agreed_date':
      if (!ag?.effective && ag?.effectiveUndecided !== undefined)
        return `合意したものの適用日が「${ag.effectiveUndecided}」で、新しい定価はまだ適用していないため、旧定価 ${formatYen(list.price)} が基準です`;
      return `合意した適用日（${ag?.effective ? toWareki(ag.effective) : '-'}）より前のため、旧定価 ${formatYen(list.price)} が基準です`;
    case 'current':
      // a product without a 定価 history has one open row from the beginning of time: no date to show
      return list.since > '1873-01-01'
        ? `定価 ${formatYen(list.price)}（${toWareki(list.since)}から）が基準です`
        : `定価 ${formatYen(list.price)} が基準です`;
  }
}

/** Plain-Japanese explanation of one diagnosed line. */
export function explainLine(d: LineDiagnosis): string[] {
  const out: string[] = [];
  const e = d.expected;
  const billed = d.line.unitPrice;
  if (!e) return [LINE_STATUS_JA[d.status]];
  const basis =
    e.kind === 'special' && e.special
      ? `特値 ${formatYen(e.special.price)}（${toWareki(e.special.start)}〜${e.special.end ? toWareki(e.special.end) : '期限なし'}）が基準です。`
      : `${listBasisText(e.list)}。基準単価は 定価 ${formatYen(e.list.price)} × 掛率 ${formatPm(e.ratePm)} ＝ ${formatYen(e.price)} です。`;
  for (const f of d.flags) {
    if (f === 'old_price' && d.oldPrice !== null && e.list.previousPrice !== null) {
      out.push(
        `${toWareki(e.list.since)}から定価が ${formatYen(e.list.previousPrice)} → ${formatYen(e.list.price)} に変わっていますが、請求単価 ${formatYen(billed)} は旧定価 ${formatYen(e.list.previousPrice)} × 掛率 ${formatPm(e.ratePm)} と同じです。新しい単価が反映されていない可能性があります。`,
      );
    } else if (f === 'expired_special' && d.expiredSpecial) {
      const sp = d.expiredSpecial;
      out.push(
        `特値 ${formatYen(sp.price)}（${toWareki(sp.start)}〜${sp.end ? toWareki(sp.end) : ''}）の期間が終わった後も、同じ単価で請求しています。`,
      );
    } else if (f === 'rate_out_of_tier' && d.tier) {
      const t = d.tier;
      const dir =
        billed < t.minPrice
          ? `下限 ${formatYen(t.minPrice)} を下回っています`
          : `上限 ${formatYen(t.maxPrice)} を上回っています`;
      out.push(
        `請求単価 ${formatYen(billed)} は、定価 ${formatYen(e.list.price)} に掛率ランク${t.rank}の範囲（${formatPm(t.minPm)}〜${formatPm(t.maxPm)}）を掛けた ${formatYen(t.minPrice)}〜${formatYen(t.maxPrice)} の外で、${dir}。`,
      );
    } else if (f === 'below_margin_floor' && d.costSen !== null && d.floorPrice !== null) {
      out.push(
        `粗利率が ${formatRatioPct(billed * 100 - d.costSen, billed * 100)} で、下限 ${formatBp(d.floorBp)} を下回っています（原単価 ${formatSen(d.costSen)}円、下限を満たす単価は ${formatYen(d.floorPrice)} 以上）。`,
      );
    }
  }
  if (d.overcharge) {
    out.push(
      `請求単価 ${formatYen(billed)} は基準単価 ${formatYen(e.price)} より高くなっています。定価の値下げが反映されていない、または取り決めと違う単価の可能性があります。利益漏れではないため影響額には含めませんが、過大な請求になっていないか確認してください。`,
    );
  } else if (d.mismatch) {
    out.push(
      `請求単価 ${formatYen(billed)} が基準単価 ${formatYen(e.price)} と一致しませんが、旧定価・期限切れの特値・掛率ランク外のどれにも当てはまりません。`,
    );
  }
  if (d.status === 'ok_volume_discount' && d.discountBp !== null) {
    out.push(
      `備考に数量値引 ${formatBp(d.discountBp, 0)} の記載があり、基準単価から値引した単価と一致します。`,
    );
  }
  out.push(basis);
  if (d.shortfallYen !== 0 && d.status !== 'ok_volume_discount') {
    out.push(
      d.shortfallYen > 0
        ? `この行の不足額は ${formatYen(d.shortfallYen)}（数量 ${d.line.qty}）です。`
        : `この行は基準より ${formatYen(-d.shortfallYen)} 多く請求しています（数量 ${d.line.qty}）。`,
    );
  }
  return out;
}

function emptyCounts(): Record<LineStatus, number> {
  return Object.fromEntries(Object.keys(LINE_STATUS_JA).map((k) => [k, 0])) as Record<LineStatus, number>;
}

/** Diagnose a whole sales export and group the results. */
export function diagnose(
  ds: Dataset,
  lines: readonly SalesLine[],
  options: DiagnosisOptions = {},
): DiagnosisResult {
  const resolved = ds.resolveLines(lines);
  let asOf = options.asOf;
  if (asOf === undefined) {
    asOf = '0001-01-01';
    for (const l of resolved) if (l.date > asOf) asOf = l.date;
  }
  const period = trailingMonths(asOf, options.windowMonths ?? ds.settings.windowMonths);
  const inWindow = (d: IsoDate) => d >= period.start && d <= period.end;

  const sorted = [...resolved].sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.slip !== b.slip
        ? a.slip < b.slip
          ? -1
          : 1
        : a.line - b.line,
  );
  const results = sorted.map((l) => diagnoseLine(ds, l));
  const statusCounts = emptyCounts();
  let salesInWindowYen = 0;

  type Acc = { type: LeakType; cust: string; sku: string; items: LineDiagnosis[] };
  const groups = new Map<string, Acc>();
  /** latest checked line per pair */
  const lastByPair = new Map<string, LineDiagnosis>();
  /** dates on which a customer's product could show a leak type: `${cust}|${type}` -> sku -> dates */
  const eligibleDates = new Map<string, Map<string, IsoDate[]>>();

  for (const d of results) {
    statusCounts[d.status]++;
    const l = d.line;
    if (!l.isReturn && l.qty > 0 && inWindow(l.date)) salesInWindowYen += l.amount ?? l.unitPrice * l.qty;
    if (l.sku === null || d.expected === null) continue;
    const pk = pairKey(l.cust, l.sku);
    lastByPair.set(pk, d);
    for (const t of d.eligible) {
      const k = `${l.cust}|${t}`;
      let bySku = eligibleDates.get(k);
      if (!bySku) {
        bySku = new Map();
        eligibleDates.set(k, bySku);
      }
      const dates = bySku.get(l.sku);
      if (dates) dates.push(l.date);
      else bySku.set(l.sku, [l.date]);
    }
    if (d.leak === null) continue;
    const gk = `${d.leak}|${pk}`;
    const acc = groups.get(gk) ?? { type: d.leak, cust: l.cust, sku: l.sku, items: [] };
    acc.items.push(d);
    groups.set(gk, acc);
  }

  const findings: Finding[] = [];
  for (const acc of groups.values()) {
    const first = acc.items[0] as LineDiagnosis;
    const latest = acc.items[acc.items.length - 1] as LineDiagnosis;
    const last = lastByPair.get(pairKey(acc.cust, acc.sku));
    const windowItems = acc.items.filter((x) => inWindow(x.line.date));
    const customer = ds.customers.get(acc.cust);
    const product = ds.products.get(acc.sku);
    const shortfallTotalYen = acc.items.reduce((s, x) => s + x.shortfallYen, 0);
    const annualImpactYen = windowItems.reduce((s, x) => s + x.shortfallYen, 0);
    const direction =
      latest.tier && latest.line.unitPrice > latest.tier.maxPrice && acc.type === 'rate_out_of_tier'
        ? 'over'
        : 'under';
    findings.push({
      id: '',
      type: acc.type,
      cust: acc.cust,
      custName: customer?.name ?? latest.line.custName,
      sku: acc.sku,
      itemName: product?.name ?? latest.line.itemName,
      firstDate: first.line.date,
      lastDate: latest.line.date,
      ongoing: last !== undefined && last.leak === acc.type,
      lineIds: acc.items.map((x) => x.line.id),
      lines: acc.items.length,
      linesInWindow: windowItems.length,
      shortfallTotalYen,
      annualImpactYen,
      direction,
      explanation: [
        ...explainLine(latest),
        `${toWareki(first.line.date)}〜${toWareki(latest.line.date)} の ${acc.items.length}行で同じ状態です（直近12か月の影響額 ${formatYen(annualImpactYen)}）。`,
      ],
      latest,
    });
  }
  const order = new Map(LEAK_TYPES.map((t, i) => [t, i]));
  findings.sort(
    (a, b) =>
      (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0) ||
      b.annualImpactYen - a.annualImpactYen ||
      (a.cust < b.cust ? -1 : a.cust > b.cust ? 1 : 0) ||
      (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),
  );
  const prefix: Record<LeakType, string> = {
    old_price: 'REV',
    expired_special: 'SPX',
    rate_out_of_tier: 'TIER',
    below_margin_floor: 'MRG',
  };
  const counters = new Map<LeakType, number>();
  for (const f of findings) {
    const n = (counters.get(f.type) ?? 0) + 1;
    counters.set(f.type, n);
    f.id = `${prefix[f.type]}-${String(n).padStart(4, '0')}`;
  }

  const summary: TypeSummary[] = LEAK_TYPES.map((type) => {
    const fs = findings.filter((f) => f.type === type);
    return {
      type,
      label: LEAK_LABEL_JA[type],
      pairs: fs.length,
      customers: new Set(fs.map((f) => f.cust)).size,
      ongoingPairs: fs.filter((f) => f.ongoing).length,
      lines: fs.reduce((s, f) => s + f.lines, 0),
      linesInWindow: fs.reduce((s, f) => s + f.linesInWindow, 0),
      shortfallTotalYen: fs.reduce((s, f) => s + Math.max(0, f.shortfallTotalYen), 0),
      annualImpactYen: fs.reduce((s, f) => s + Math.max(0, f.annualImpactYen), 0),
    };
  });

  const customers = rollupCustomers(ds, findings, eligibleDates);
  const over = results.filter((d) => d.status === 'overcharge');
  const overcharges: OverchargeSummary = {
    lines: over.length,
    pairs: new Set(over.map((d) => pairKey(d.line.cust, d.line.sku ?? ''))).size,
    customers: new Set(over.map((d) => d.line.cust)).size,
    amountYen: over.reduce((s, d) => s - d.shortfallYen, 0),
    amountInWindowYen: over.filter((d) => inWindow(d.line.date)).reduce((s, d) => s - d.shortfallYen, 0),
  };
  const free = results.filter((d) => d.status === 'excluded_sample');
  const atList = (d: LineDiagnosis) =>
    (d.line.sku !== null ? (ds.listPriceAt(d.line.sku, d.line.date) ?? 0) : 0) * d.line.qty;
  const freeGoods: FreeGoodsSummary = {
    lines: free.length,
    linesInWindow: free.filter((d) => inWindow(d.line.date)).length,
    pairs: new Set(free.map((d) => pairKey(d.line.cust, d.line.sku ?? ''))).size,
    customers: new Set(free.map((d) => d.line.cust)).size,
    listAmountYen: free.reduce((s, d) => s + atList(d), 0),
    listAmountInWindowYen: free.filter((d) => inWindow(d.line.date)).reduce((s, d) => s + atList(d), 0),
  };
  return {
    window: period,
    lines: results,
    findings,
    summary,
    customers,
    statusCounts,
    salesInWindowYen,
    overcharges,
    freeGoods,
  };
}

/** Minimum items and share for "most of this customer's items": likely a customer-level cause. */
const WHOLE_CUSTOMER_MIN_PAIRS = 5;
const WHOLE_CUSTOMER_MIN_SHARE_BP = 8000;

function rollupCustomers(
  ds: Dataset,
  findings: readonly Finding[],
  eligibleDates: Map<string, Map<string, IsoDate[]>>,
): CustomerRollup[] {
  const by = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = `${f.cust}|${f.type}`;
    const list = by.get(k) ?? [];
    list.push(f);
    by.set(k, list);
  }
  const out: CustomerRollup[] = [];
  for (const [k, fs] of by) {
    const first = fs[0] as Finding;
    const firstDate = fs.reduce((m, f) => (f.firstDate < m ? f.firstDate : m), first.firstDate);
    const lastDate = fs.reduce((m, f) => (f.lastDate > m ? f.lastDate : m), first.lastDate);
    const affected = new Set(fs.map((f) => f.sku));
    const eligible = new Set(affected);
    for (const [sku, dates] of eligibleDates.get(k) ?? []) {
      if (dates.some((d) => d >= firstDate && d <= lastDate)) eligible.add(sku);
    }
    const shareBp = Math.round((affected.size * 10000) / eligible.size);
    out.push({
      cust: first.cust,
      custName: ds.customers.get(first.cust)?.name ?? first.custName,
      type: first.type,
      affectedPairs: affected.size,
      eligiblePairs: eligible.size,
      shareBp,
      wholeCustomer: affected.size >= WHOLE_CUSTOMER_MIN_PAIRS && shareBp >= WHOLE_CUSTOMER_MIN_SHARE_BP,
      firstDate,
      lastDate,
      annualImpactYen: fs.reduce((s, f) => s + Math.max(0, f.annualImpactYen), 0),
    });
  }
  return out.sort((a, b) => b.annualImpactYen - a.annualImpactYen || (a.cust < b.cust ? -1 : 1));
}
