/**
 * The company's own data, indexed for lookups: masters, dated histories, 特値
 * and the customers' answers to past 定価 revisions.
 *
 * The central question it answers is "which unit price should this customer
 * pay for this product on this day?" (expectedPrice), with the reasoning kept so
 * every result can be explained.
 */

import type { IsoDate } from './dates.ts';
import { priceAtRate } from './money.ts';
import { codeKey } from './text.ts';
import {
  type Category,
  type Company,
  type CostRow,
  type CostShare,
  type Customer,
  DEFAULT_SETTINGS,
  type ListPriceRow,
  type Product,
  type RateTier,
  type Revision,
  type RevisionAgreement,
  type SalesLine,
  type Settings,
  type SpecialPrice,
  type Supplier,
  type SupplierNotice,
} from './types.ts';

export interface DatasetInput {
  customers: Customer[];
  products: Product[];
  rateTiers: RateTier[];
  categories?: Category[];
  suppliers?: Supplier[];
  listPriceHistory?: ListPriceRow[];
  costHistory?: CostRow[];
  specials?: SpecialPrice[];
  revisions?: Revision[];
  supplierNotices?: SupplierNotice[];
  settings?: Partial<Settings>;
  company?: Company;
}

export type DatasetIssueKind =
  | 'duplicate_code'
  | 'ambiguous_key'
  | 'unknown_rank'
  | 'rate_outside_tier'
  | 'unknown_product'
  | 'unknown_customer'
  | 'overlapping_period'
  | 'unknown_agreement_status'
  | 'conflicting_agreement'
  | 'cost_share_missing';

export interface DatasetIssue {
  kind: DatasetIssueKind;
  message: string;
  ref: string;
}

export function pairKey(cust: string, sku: string): string {
  return `${cust}|${sku}`;
}

/** Why a customer pays the 定価 they pay on a day. */
export type ListBasis =
  | 'current'
  | 'kept_declined'
  | 'kept_negotiating'
  | 'kept_excluded_category'
  | 'kept_before_agreed_date';

export interface ApplicableList {
  /** 定価 to apply for this customer on this day */
  price: number;
  /** the 定価 row in force for everyone on that day */
  row: ListPriceRow;
  basis: ListBasis;
  /** the revision whose answer decided the basis (when one did) */
  revision: Revision | null;
  agreement: RevisionAgreement | null;
  /**
   * The customer's previous 定価, when they should already have moved to `price`.
   * A bill at this old 定価 × 掛率 is a 反映漏れ.
   */
  previousPrice: number | null;
  /** start date of the 定価 the customer should be on (for explanations) */
  since: IsoDate;
}

export interface ExpectedPrice {
  price: number;
  kind: 'special' | 'list_rate';
  list: ApplicableList;
  ratePm: number;
  special: SpecialPrice | null;
}

const BEGINNING: IsoDate = '0001-01-01';

function sortByStart<T extends { start: IsoDate }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Two answers for the same customer and revision mean the same thing (status wording aside). */
function sameAnswer(a: RevisionAgreement, b: RevisionAgreement): boolean {
  return (
    a.kind === b.kind &&
    a.effective === b.effective &&
    [...a.excludedCategories].sort().join(',') === [...b.excludedCategories].sort().join(',')
  );
}

function covers(row: { start: IsoDate; end: IsoDate | null }, date: IsoDate): boolean {
  return row.start <= date && (row.end === null || date <= row.end);
}

export class Dataset {
  readonly settings: Settings;
  readonly company: Company | null;
  readonly customers = new Map<string, Customer>();
  readonly products = new Map<string, Product>();
  readonly productByKey = new Map<string, string>();
  readonly tiers = new Map<string, RateTier>();
  readonly categories = new Map<string, Category>();
  readonly suppliers = new Map<string, Supplier>();
  readonly listHistory = new Map<string, ListPriceRow[]>();
  readonly costHistory = new Map<string, CostRow[]>();
  readonly specials = new Map<string, SpecialPrice[]>();
  readonly revisions: Revision[];
  readonly supplierNotices: SupplierNotice[];
  readonly issues: DatasetIssue[] = [];
  private readonly revisionByDate = new Map<
    IsoDate,
    { revision: Revision; byCust: Map<string, RevisionAgreement> }
  >();

  constructor(input: DatasetInput) {
    this.settings = { ...DEFAULT_SETTINGS, ...input.settings };
    this.company = input.company ?? null;
    for (const t of input.rateTiers) this.tiers.set(t.rank, t);
    for (const c of input.categories ?? []) this.categories.set(c.code, c);
    for (const s of input.suppliers ?? []) this.suppliers.set(s.code, s);

    for (const c of input.customers) {
      if (this.customers.has(c.code))
        this.issue('duplicate_code', `得意先コードが重複しています: ${c.code}`, c.code);
      this.customers.set(c.code, c);
      const tier = this.tiers.get(c.rank);
      if (!tier) this.issue('unknown_rank', `掛率ランク「${c.rank}」が掛率ランク表にありません`, c.code);
      else if (c.ratePm < tier.minPm || c.ratePm > tier.maxPm) {
        this.issue('rate_outside_tier', `得意先マスタの掛率がランク${c.rank}の範囲外です`, c.code);
      }
    }

    for (const p of input.products) {
      if (this.products.has(p.code))
        this.issue('duplicate_code', `商品コードが重複しています: ${p.code}`, p.code);
      const other = this.productByKey.get(p.key);
      if (other !== undefined && other !== p.code) {
        this.issue(
          'ambiguous_key',
          `商品コード ${other} と ${p.code} は表記ゆれを除くと同じになり、区別できません`,
          p.code,
        );
      }
      const share = isZeroShare(p.costShare)
        ? (this.categories.get(p.category)?.costShare ?? null)
        : p.costShare;
      if (share === null) this.issue('cost_share_missing', `原価構成比がありません: ${p.code}`, p.code);
      this.products.set(p.code, { ...p, costShare: share ?? p.costShare });
      this.productByKey.set(p.key, p.code);
    }

    this.indexHistory(input.listPriceHistory ?? [], this.listHistory, '定価');
    this.indexHistory(input.costHistory ?? [], this.costHistory, '原単価');

    for (const sp of input.specials ?? []) {
      const sku = sp.sku ?? this.resolveSku(sp.skuKey);
      if (sku === null) {
        this.issue('unknown_product', `特値の商品コードが商品マスタにありません: ${sp.rawSku}`, sp.rawSku);
        continue;
      }
      if (!this.customers.has(sp.cust))
        this.issue('unknown_customer', `特値の得意先コードが得意先マスタにありません: ${sp.cust}`, sp.cust);
      const k = pairKey(sp.cust, sku);
      const list = this.specials.get(k) ?? [];
      list.push({ ...sp, sku });
      this.specials.set(k, list);
    }
    for (const [k, list] of this.specials) {
      const sorted = sortByStart(list);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev && cur && (prev.end === null || prev.end >= cur.start)) {
          this.issue('overlapping_period', `特値の期間が重なっています: ${k}（${cur.start}〜）`, k);
        }
      }
      this.specials.set(k, sorted);
    }

    // 同じ改定日の合意状況が複数のファイル（支店別など）に分かれていても、1つの改定としてまとめる。
    // 後のファイルが前のファイルを上書きすると、前のファイルにしかない得意先の「見送り」などが消えてしまう
    const byDate = new Map<IsoDate, { revision: Revision; byCust: Map<string, RevisionAgreement> }>();
    for (const rev of input.revisions ?? []) {
      let entry = byDate.get(rev.date);
      if (!entry) {
        entry = { revision: rev, byCust: new Map() };
        byDate.set(rev.date, entry);
      }
      for (const ag of rev.agreements) {
        const prev = entry.byCust.get(ag.cust);
        if (prev && !sameAnswer(prev, ag)) {
          this.issue(
            'conflicting_agreement',
            `同じ改定日（${rev.date}）の合意状況が食い違っています: 得意先 ${ag.cust}（「${prev.status}」と「${ag.status}」）。後から読み込んだ「${ag.status}」を使います`,
            ag.cust,
          );
        }
        entry.byCust.set(ag.cust, ag);
        if (ag.kind === 'unknown') {
          this.issue(
            'unknown_agreement_status',
            `合意状況「${ag.status}」を判別できないため、改定を適用したものとして扱います`,
            ag.cust,
          );
        }
      }
    }
    this.revisions = [...byDate.values()]
      .map(({ revision, byCust }) => ({ ...revision, agreements: [...byCust.values()] }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const rev of this.revisions) {
      this.revisionByDate.set(rev.date, { revision: rev, byCust: byDate.get(rev.date)?.byCust ?? new Map() });
    }
    this.supplierNotices = [...(input.supplierNotices ?? [])];
  }

  private issue(kind: DatasetIssueKind, message: string, ref: string): void {
    this.issues.push({ kind, message, ref });
  }

  private indexHistory<T extends { sku: string; start: IsoDate; end: IsoDate | null }>(
    rows: T[],
    target: Map<string, T[]>,
    label: string,
  ): void {
    const grouped = new Map<string, T[]>();
    for (const r of rows) {
      const sku = this.resolveSku(codeKey(r.sku));
      if (sku === null) {
        this.issue('unknown_product', `${label}の履歴の商品コードが商品マスタにありません: ${r.sku}`, r.sku);
        continue;
      }
      const list = grouped.get(sku) ?? [];
      list.push({ ...r, sku });
      grouped.set(sku, list);
    }
    for (const [sku, list] of grouped) {
      const sorted = sortByStart(list);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev && cur && prev.end !== null && prev.end >= cur.start) {
          this.issue(
            'overlapping_period',
            `${label}の履歴の期間が重なっています: ${sku}（${cur.start}〜）`,
            sku,
          );
        }
      }
      target.set(sku, sorted);
    }
  }

  /** Product code from a raw code or matching key (null when not in the master). */
  resolveSku(rawOrKey: string): string | null {
    return this.productByKey.get(codeKey(rawOrKey)) ?? null;
  }

  /** Sales lines with `sku` filled in from the product master. */
  resolveLines(lines: readonly SalesLine[]): SalesLine[] {
    return lines.map((l) => ({ ...l, sku: this.resolveSku(l.skuKey) }));
  }

  tierOf(cust: string): RateTier | null {
    const c = this.customers.get(cust);
    return c ? (this.tiers.get(c.rank) ?? null) : null;
  }

  /** 定価 rows of a product; a product without history gets one open row with its current 定価. */
  listRows(sku: string): ListPriceRow[] {
    const rows = this.listHistory.get(sku);
    if (rows && rows.length > 0) return rows;
    const p = this.products.get(sku);
    return p ? [{ sku, price: p.listPrice, start: BEGINNING, end: null }] : [];
  }

  /** Index of the row in force on the day (start <= day <= end), latest-starting first; -1 in a gap. */
  private listIndexAt(rows: readonly ListPriceRow[], date: IsoDate): number {
    let idx = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && covers(r, date)) idx = i;
    }
    return idx;
  }

  /** 定価 in force for everyone on a day (null before the first row, after an ended row and in gaps). */
  listPriceAt(sku: string, date: IsoDate): number | null {
    const rows = this.listRows(sku);
    const i = this.listIndexAt(rows, date);
    return i >= 0 ? (rows[i]?.price ?? null) : null;
  }

  /**
   * The 定価 that applies to a customer on a day. When the 定価 changed on the date
   * of a recorded revision, the customer's answer decides: 見送り / 協議中 keep the
   * previous 定価, 一部合意 keeps it for the excluded categories, and an agreed
   * later 適用日 keeps it until that day. Without a recorded answer the new 定価
   * applies from its start date.
   */
  applicableList(cust: string, sku: string, date: IsoDate): ApplicableList | null {
    const rows = this.listRows(sku);
    const idx = this.listIndexAt(rows, date);
    if (idx < 0) return null;
    const category = this.products.get(sku)?.category ?? '';
    return this.resolveList(rows, idx, cust, category, date);
  }

  private resolveList(
    rows: readonly ListPriceRow[],
    idx: number,
    cust: string,
    category: string,
    date: IsoDate,
  ): ApplicableList {
    const row = rows[idx] as ListPriceRow;
    if (idx === 0)
      return {
        price: row.price,
        row,
        basis: 'current',
        revision: null,
        agreement: null,
        previousPrice: null,
        since: row.start,
      };
    const rev = this.revisionByDate.get(row.start);
    const ag = rev?.byCust.get(cust) ?? null;
    let kept: ListBasis | null = null;
    if (ag) {
      if (ag.kind === 'declined') kept = 'kept_declined';
      else if (ag.kind === 'negotiating') kept = 'kept_negotiating';
      else if (ag.kind !== 'not_applicable' && ag.excludedCategories.includes(category))
        kept = 'kept_excluded_category';
      else if (ag.kind !== 'not_applicable' && ag.effective !== null && date < ag.effective)
        kept = 'kept_before_agreed_date';
    }
    const before = this.resolveList(rows, idx - 1, cust, category, date);
    if (kept !== null) {
      return {
        ...before,
        row,
        basis: kept,
        revision: rev?.revision ?? null,
        agreement: ag,
        previousPrice: null,
      };
    }
    const since =
      ag && ag.kind !== 'not_applicable' && ag.effective !== null && ag.effective > row.start
        ? ag.effective
        : row.start;
    return {
      price: row.price,
      row,
      basis: 'current',
      revision: rev?.revision ?? null,
      agreement: ag,
      previousPrice: before.price !== row.price ? before.price : null,
      since,
    };
  }

  /** 特値 valid on the day (the latest-starting one if periods overlap). */
  validSpecial(cust: string, sku: string, date: IsoDate): SpecialPrice | null {
    let found: SpecialPrice | null = null;
    for (const sp of this.specials.get(pairKey(cust, sku)) ?? []) if (covers(sp, date)) found = sp;
    return found;
  }

  /** 特値 of the pair whose period ended before the day, latest first. */
  expiredSpecials(cust: string, sku: string, date: IsoDate): SpecialPrice[] {
    return (this.specials.get(pairKey(cust, sku)) ?? [])
      .filter((sp) => sp.end !== null && sp.end < date)
      .reverse();
  }

  /**
   * 原単価 (銭) on a day: the cost-history row covering the day (start <= day <= end),
   * else the product master's. A day before the first row, after an ended row or in a
   * gap never borrows another period's cost.
   */
  costAt(sku: string, date: IsoDate): number | null {
    let found: CostRow | null = null;
    for (const r of this.costHistory.get(sku) ?? []) if (covers(r, date)) found = r;
    return found?.costSen ?? this.products.get(sku)?.costSen ?? null;
  }

  /** The unit price the customer should pay: a valid 特値, else 定価 × 掛率. */
  expectedPrice(cust: string, sku: string, date: IsoDate): ExpectedPrice | null {
    const c = this.customers.get(cust);
    if (!c) return null;
    const list = this.applicableList(cust, sku, date);
    if (!list) return null;
    const special = this.validSpecial(cust, sku, date);
    if (special) return { price: special.price, kind: 'special', list, ratePm: c.ratePm, special };
    return {
      price: priceAtRate(list.price, c.ratePm, this.settings.unitRounding),
      kind: 'list_rate',
      list,
      ratePm: c.ratePm,
      special: null,
    };
  }

  /** The cost share of a product (its own, else its category's). */
  costShareOf(sku: string): CostShare | null {
    const p = this.products.get(sku);
    if (!p) return null;
    return isZeroShare(p.costShare) ? null : p.costShare;
  }
}

function isZeroShare(s: CostShare): boolean {
  return s.material + s.labor + s.energy + s.other === 0;
}

/**
 * Dates on which many 定価 changed at once (a 定価改定), from the history alone:
 * at least `minShare` (bp) of the products that have history, and at least 10 products.
 */
export function inferRevisionDates(history: readonly ListPriceRow[], minShareBp = 500): IsoDate[] {
  const bySku = new Map<string, ListPriceRow[]>();
  for (const r of history) {
    const list = bySku.get(r.sku) ?? [];
    list.push(r);
    bySku.set(r.sku, list);
  }
  const counts = new Map<IsoDate, number>();
  for (const rows of bySku.values()) {
    const sorted = sortByStart(rows);
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const prev = sorted[i - 1];
      if (cur && prev && cur.price !== prev.price) counts.set(cur.start, (counts.get(cur.start) ?? 0) + 1);
    }
  }
  const min = Math.max(10, Math.ceil((bySku.size * minShareBp) / 10000));
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([d]) => d)
    .sort();
}
