/**
 * The company's own data, indexed for lookups: masters, dated histories, 特値
 * and the customers' answers to past 定価 revisions.
 *
 * The central question it answers is "which unit price should this customer
 * pay for this product on this day?" (expectedPrice), with the reasoning kept so
 * every result can be explained.
 */

import { type IsoDate, toWareki } from './dates.ts';
import { AGREEMENT_KIND_JA, isPlainAgreementStatus } from './importers.ts';
import { priceAtRate } from './money.ts';
import { codeKey } from './text.ts';
import {
  type AgreementKind,
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
  | 'interpreted_agreement_status'
  | 'conflicting_agreement'
  | 'effective_undecided'
  | 'unknown_excluded_category'
  | 'cost_share_missing';

export interface DatasetIssue {
  kind: DatasetIssueKind;
  message: string;
  ref: string;
  /** the 定価改定 an issue about an agreements answer belongs to */
  revision?: IsoDate;
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
   * The customer's previous, lower 定価, when they should already have moved up to
   * `price`. A bill at this old 定価 × 掛率 is a 反映漏れ. Null after a 定価 cut:
   * billing the old, higher price is an overcharge, not a profit leak.
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

/** Answers that move the customer to the new 定価 (from the 適用日, when one is set). */
const AGREED_KINDS: readonly AgreementKind[] = ['agreed', 'agreed_later_date', 'partial'];

/** Kinds for which the 対象外カテゴリ decide anything (見送り・協議中 keep every category anyway). */
const EXCLUSION_KINDS: readonly AgreementKind[] = [...AGREED_KINDS, 'unknown'];

/**
 * Matching key for a カテゴリ code or name: NFKC, without spaces, upper case.
 * "ｋｇ" / "KG " -> "KG"; "工具･金物" -> "工具・金物".
 */
export function categoryKey(raw: string): string {
  return raw.normalize('NFKC').replace(/\s/g, '').toUpperCase();
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
  /** category key (code or name) -> the keys a product's カテゴリ may be written with */
  private readonly categoryLookup = new Map<string, readonly string[]>();
  /** 対象外カテゴリ of each answer, as category keys */
  private readonly excludedKeys = new Map<RevisionAgreement, ReadonlySet<string>>();

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

    // 対象外カテゴリはコードでも名前でも書かれる（合意状況の突き合わせにも使うので先に作る）
    this.indexCategories();
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
        if (prev && !this.sameAnswer(prev, ag)) {
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
            `${this.customerLabel(ag.cust)}の合意状況「${ag.status}」を判別できないため、改定に合意したものとして扱います（${toWareki(rev.date)}の改定。適用日が書いてあれば、その日から新しい定価）。違う場合はファイルの表記を「合意」「一部合意」「協議中」「見送り」などに直してください`,
            ag.cust,
            rev.date,
          );
        } else if (!isPlainAgreementStatus(ag.status)) {
          this.issue(
            'interpreted_agreement_status',
            `合意状況「${ag.status}」を「${AGREEMENT_KIND_JA[ag.kind]}」として扱いました（得意先 ${ag.cust}）。違う場合はファイルの表記を「合意」「一部合意」「協議中」「見送り」などに直してください`,
            ag.cust,
          );
        }
      }
    }
    // どのカテゴリにも合わない対象外カテゴリ、適用日「未定」の合意は黙って読み替えない
    for (const [date, { byCust }] of byDate) {
      for (const ag of byCust.values()) this.checkAnswer(date, ag);
    }
    this.revisions = [...byDate.values()]
      .map(({ revision, byCust }) => ({ ...revision, agreements: [...byCust.values()] }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const rev of this.revisions) {
      this.revisionByDate.set(rev.date, { revision: rev, byCust: byDate.get(rev.date)?.byCust ?? new Map() });
    }
    this.supplierNotices = [...(input.supplierNotices ?? [])];
  }

  private issue(kind: DatasetIssueKind, message: string, ref: string, revision?: IsoDate): void {
    this.issues.push(revision === undefined ? { kind, message, ref } : { kind, message, ref, revision });
  }

  /**
   * Two answers for the same customer and revision mean the same thing: the same kind and,
   * where they decide anything (合意・一部合意・判別できない), the same 適用日 and the same
   * 対象外カテゴリ — read as categories, so a code and a name of the same one match.
   */
  private sameAnswer(a: RevisionAgreement, b: RevisionAgreement): boolean {
    if (a.kind !== b.kind) return false;
    if (!EXCLUSION_KINDS.includes(a.kind)) return true;
    const cats = (x: RevisionAgreement) => {
      const m = this.matchExcluded(x.excludedCategories);
      return `${[...m.keys].sort().join(',')}|${m.unmatched.map(categoryKey).sort().join(',')}`;
    };
    return (
      a.effective === b.effective &&
      (a.effectiveUndecided === undefined) === (b.effectiveUndecided === undefined) &&
      cats(a) === cats(b)
    );
  }

  /** "得意先 001005（株式会社播磨野資材）" for messages. */
  private customerLabel(cust: string): string {
    const name = this.customers.get(cust)?.name;
    return name ? `得意先 ${cust}（${name}）` : `得意先 ${cust}`;
  }

  /**
   * Keys of the categories master (code and name) and of the products' own カテゴリ
   * values. A code wins over a name that happens to be written the same way.
   */
  private indexCategories(): void {
    const cats = [...this.categories.values()];
    for (const c of cats) {
      const code = categoryKey(c.code);
      const name = categoryKey(c.name);
      if (code !== '') this.categoryLookup.set(code, name !== '' ? [code, name] : [code]);
    }
    for (const c of cats) {
      const name = categoryKey(c.name);
      const code = categoryKey(c.code);
      if (name !== '' && !this.categoryLookup.has(name))
        this.categoryLookup.set(name, code !== '' ? [code, name] : [name]);
    }
    for (const p of this.products.values()) {
      const k = categoryKey(p.category);
      if (k !== '' && !this.categoryLookup.has(k)) this.categoryLookup.set(k, [k]);
    }
  }

  /**
   * 対象外カテゴリ entries as category keys. An entry is a code or a name of the categories
   * master (or a product's カテゴリ as written); one that does not match as a whole is read
   * as names joined by 「・」, longest names first ("段ボール・紙器・工具・金物").
   */
  matchExcluded(entries: readonly string[]): { keys: Set<string>; unmatched: string[] } {
    const keys = new Set<string>();
    const unmatched: string[] = [];
    for (const entry of entries) {
      const whole = this.categoryLookup.get(categoryKey(entry));
      if (whole) {
        for (const k of whole) keys.add(k);
        continue;
      }
      const parts = entry
        .normalize('NFKC')
        .split('・')
        .map((x) => x.trim())
        .filter((x) => x !== '');
      let miss: string[] = [];
      let i = 0;
      while (i < parts.length) {
        let j = parts.length;
        let found: readonly string[] | undefined;
        for (; j > i; j--) {
          found = this.categoryLookup.get(categoryKey(parts.slice(i, j).join('・')));
          if (found) break;
        }
        if (found) {
          if (miss.length > 0) unmatched.push(miss.join('・'));
          miss = [];
          for (const k of found) keys.add(k);
          i = j;
        } else {
          miss.push(parts[i] ?? '');
          i++;
        }
      }
      if (miss.length > 0) unmatched.push(miss.join('・'));
    }
    return { keys, unmatched };
  }

  /** Read one answer's 対象外カテゴリ, and report what the diagnosis cannot take as written. */
  private checkAnswer(date: IsoDate, ag: RevisionAgreement): void {
    const { keys, unmatched } = this.matchExcluded(ag.excludedCategories);
    this.excludedKeys.set(ag, keys);
    const rev = `${toWareki(date)}の改定`;
    if (EXCLUSION_KINDS.includes(ag.kind)) {
      const where = this.categories.size > 0 ? 'カテゴリのコードにも名前にも' : '商品マスタのカテゴリにも';
      for (const x of unmatched) {
        this.issue(
          'unknown_excluded_category',
          `${this.customerLabel(ag.cust)}の対象外カテゴリ「${x}」が、${where}合いません（${rev}）。このカテゴリは据え置きとして扱わず、新しい定価を正しい単価としています。カテゴリのコードか名前に直してください。`,
          ag.cust,
          date,
        );
      }
    }
    if (AGREED_KINDS.includes(ag.kind) && ag.effective === null && ag.effectiveUndecided !== undefined) {
      this.issue(
        'effective_undecided',
        `${this.customerLabel(ag.cust)}は「${ag.status}」ですが、適用日が「${ag.effectiveUndecided}」です（${rev}）。適用日が決まるまで新しい定価はまだ適用していないものとして、旧定価のままの請求を正しいとしています。適用日が決まったら、合意状況ファイルの適用日を直してください。`,
        ag.cust,
        date,
      );
    }
  }

  /** The product's カテゴリ is one the customer kept at the old 定価 (一部合意). */
  private isExcludedCategory(ag: RevisionAgreement, category: string): boolean {
    const keys = this.excludedKeys.get(ag);
    return keys ? keys.has(categoryKey(category)) : ag.excludedCategories.includes(category);
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
        if (prev && cur && (prev.end === null || prev.end >= cur.start)) {
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
      else if (ag.kind !== 'not_applicable' && this.isExcludedCategory(ag, category))
        kept = 'kept_excluded_category';
      else if (ag.kind !== 'not_applicable' && ag.effective !== null && date < ag.effective)
        kept = 'kept_before_agreed_date';
      // 合意したが適用日が「未定」: 日付が決まるまで新しい定価はまだ適用しない
      else if (AGREED_KINDS.includes(ag.kind) && ag.effective === null && ag.effectiveUndecided !== undefined)
        kept = 'kept_before_agreed_date';
    }
    const before = this.resolveList(rows, idx - 1, cust, category, date);
    if (kept !== null) {
      // the customer stays on `before`, and so does the 定価 before it (previousPrice / since):
      // a bill at that one is the 定価 the customer was on just before, a 反映漏れ
      return {
        ...before,
        row,
        basis: kept,
        revision: rev?.revision ?? null,
        agreement: ag,
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
      previousPrice: before.price < row.price ? before.price : null,
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
   * 原単価 (銭) on a day: the cost-history row covering the day (start <= day <= end).
   * A product without any cost history uses the product master's cost. A product with
   * history has no cost on a day before the first row, after an ended row or in a gap
   * (null): it never borrows another period's cost, like listPriceAt.
   */
  costAt(sku: string, date: IsoDate): number | null {
    const rows = this.costHistory.get(sku);
    if (!rows || rows.length === 0) return this.products.get(sku)?.costSen ?? null;
    let found: CostRow | null = null;
    for (const r of rows) if (covers(r, date)) found = r;
    return found?.costSen ?? null;
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
 * How many products' 定価 changed on each day (a day counts once per product). Products are
 * matched by `codeKey`, as the Dataset does, so "ＤＢ－１００１" and "DB-1001" are one product.
 */
function countListChanges(history: readonly ListPriceRow[]): {
  counts: Map<IsoDate, number>;
  products: number;
} {
  const bySku = new Map<string, ListPriceRow[]>();
  for (const r of history) {
    const key = codeKey(r.sku);
    const list = bySku.get(key) ?? [];
    list.push(r);
    bySku.set(key, list);
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
  return { counts, products: bySku.size };
}

/**
 * Dates on which many 定価 changed at once (a 定価改定), from the history alone:
 * at least `minShare` (bp) of the products that have history, and at least 10 products.
 */
export function inferRevisionDates(history: readonly ListPriceRow[], minShareBp = 500): IsoDate[] {
  const { counts, products } = countListChanges(history);
  const min = Math.max(10, Math.ceil((products * minShareBp) / 10000));
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([d]) => d)
    .sort();
}

/** Every day on which the 定価 of at least one product changed, in date order. */
export function listChangeDates(history: readonly ListPriceRow[]): IsoDate[] {
  return [...countListChanges(history).counts.keys()].sort();
}
