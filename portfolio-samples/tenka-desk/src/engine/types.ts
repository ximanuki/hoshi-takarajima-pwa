/**
 * Data model of 転嫁デスク.
 *
 * Units: prices and amounts in 円 (integers), unit costs in 銭 (1/100 円),
 * 掛率 in permille (72.5% = 725), percentages and rates of change in basis
 * points (5.18% = 518). Dates are ISO strings ("2025-04-01").
 *
 * Codes: `code` is the code as written in the company's own master (e.g. "DB-1001").
 * `key` is the matching key from codeKey() ("DB1001"); sales lines carry the raw
 * code and the key, and are matched to the master through the key.
 */

import type { IsoDate } from './dates.ts';
import type { Rounding } from './money.ts';

export type { IsoDate } from './dates.ts';

/** Integer percentages of a unit cost by component (they add up to 100). */
export interface CostShare {
  material: number;
  labor: number;
  energy: number;
  other: number;
}

export interface RateTier {
  rank: string;
  name: string;
  standardPm: number;
  minPm: number;
  maxPm: number;
  note: string;
}

export interface Category {
  code: string;
  name: string;
  costShare: CostShare;
  mainMaterial: string;
}

export interface Customer {
  /** 6-digit zero-padded 得意先コード */
  code: string;
  name: string;
  shortName: string;
  segment: string;
  rank: string;
  /** The customer's 掛率 from the company's customer master (not from the sales export). */
  ratePm: number;
  branch: string;
  salesRep: string;
  prefecture: string;
  closingDay: string;
  /** 宛先部署 for letters */
  department: string;
  since: IsoDate | null;
}

export interface Product {
  code: string;
  key: string;
  name: string;
  category: string;
  unit: string;
  listPrice: number;
  costSen: number;
  supplier: string;
  costShare: CostShare;
}

/** One row of a dated history: value valid from start to end (inclusive, null = open). */
export interface ListPriceRow {
  sku: string;
  price: number;
  start: IsoDate;
  end: IsoDate | null;
}

export interface CostRow {
  sku: string;
  costSen: number;
  start: IsoDate;
  end: IsoDate | null;
}

/** 特値: the unit price for one customer and one product during a period. */
export interface SpecialPrice {
  cust: string;
  /** product code as resolved against the master (null if the code is unknown) */
  sku: string | null;
  skuKey: string;
  rawSku: string;
  price: number;
  start: IsoDate;
  end: IsoDate | null;
  reason: string;
}

export type AgreementKind =
  | 'agreed'
  | 'agreed_later_date'
  | 'partial'
  | 'declined'
  | 'negotiating'
  | 'not_applicable'
  | 'unknown';

/** A customer's answer to a list price revision (合意状況 / 協議結果). */
export interface RevisionAgreement {
  cust: string;
  status: string;
  kind: AgreementKind;
  /** 適用日 agreed with the customer; null when nothing applies */
  effective: IsoDate | null;
  /** カテゴリコード kept at the old 定価 (一部合意) */
  excludedCategories: string[];
  requestedOn: IsoDate | null;
  answeredOn: IsoDate | null;
  note: string;
}

export type PriceType = '標準' | '得意先' | '手入力' | '不明';

export interface SalesLine {
  /** "伝票番号-行" */
  id: string;
  date: IsoDate;
  slip: string;
  line: number;
  isReturn: boolean;
  cust: string;
  custName: string;
  rawSku: string;
  skuKey: string;
  /** Product code from the master, or null for lines with no product (運賃 etc.) */
  sku: string | null;
  itemName: string;
  qty: number;
  unit: string;
  /** 定価 as printed by the sales system on that day */
  printedListPrice: number | null;
  unitPrice: number;
  amount: number | null;
  /** 原単価 in 銭 as printed by the sales system */
  costSen: number | null;
  priceType: PriceType;
  remark: string;
  branch: string;
  /** 1-based line number in the source file (header = 1) */
  sourceRow: number;
}

/** One row of a (new) price master: the unit price for a customer and product from a date. */
export interface PriceMasterRow {
  cust: string;
  sku: string | null;
  skuKey: string;
  rawSku: string;
  effective: IsoDate;
  newPrice: number;
  currentPrice: number;
}

export interface SupplierNotice {
  noticeDate: IsoDate;
  supplier: string;
  supplierName: string;
  sku: string;
  currentCostSen: number;
  newCostSen: number;
  effective: IsoDate;
  reason: string;
  status: string;
}

/** A new 定価 table (e.g. the list prices of the next revision). */
export interface NewListPrice {
  sku: string;
  currentPrice: number;
  newPrice: number;
  effective: IsoDate;
}

export interface Supplier {
  code: string;
  name: string;
  categories: string[];
}

export interface Company {
  name: string;
  business: string;
  address: string;
  tel: string;
  representative: string;
  branches: string[];
}

/** One band of 定価 rounding: values below `below` 円 round to multiples of `unit` 円. */
export interface RoundingBand {
  below: number | null;
  unit: number;
}

/**
 * 定価 rounding rule, e.g. 10円単位 below 1,000円, 50円 below 10,000円, 100円 otherwise.
 * `ending` optionally forces the last digits within the unit (e.g. unit 100 with
 * ending 80 gives 1,280 / 1,380 ...).
 */
export interface PriceRoundingRule {
  bands: RoundingBand[];
  mode: Rounding;
  ending?: number;
}

export interface Settings {
  /** 粗利率の下限 in basis points (10% = 1000) */
  marginFloorBp: number;
  /** 単価 = 定価 × 掛率 rounding (円未満) */
  unitRounding: Rounding;
  /** 定価 rounding used when proposing new list prices */
  listRounding: PriceRoundingRule;
  /** Months used for the yearly impact (直近12か月) */
  windowMonths: number;
}

export const DEFAULT_SETTINGS: Settings = {
  marginFloorBp: 1000,
  unitRounding: 'floor',
  listRounding: {
    bands: [
      { below: 1000, unit: 10 },
      { below: 10000, unit: 50 },
      { below: null, unit: 100 },
    ],
    mode: 'ceil',
  },
  windowMonths: 12,
};

/** A list price revision (定価改定) with the customers' answers. */
export interface Revision {
  date: IsoDate;
  label: string;
  agreements: RevisionAgreement[];
}
