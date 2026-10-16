/**
 * File layouts and their detection.
 *
 * A layout lists the columns of one kind of file (売上明細, 特値一覧, 単価マスタ,
 * and the plain masters) with the header names a system prints for them.
 * detectLayout() reads a header row and picks the layout whose required columns
 * are all present; mapColumns() turns the header into field -> column index.
 * A user can pass their own header names for a field (manual mapping) when a
 * system names a column differently.
 */

import type { PriceType } from './types.ts';

export type FileKind =
  | 'sales'
  | 'specials'
  | 'priceMaster'
  | 'customers'
  | 'products'
  | 'rateTiers'
  | 'categories'
  | 'suppliers'
  | 'listPriceHistory'
  | 'costHistory'
  | 'agreements'
  | 'supplierNotices'
  | 'newListPrices';

export type LayoutVariant = 'A' | 'B' | 'standard';

export interface ColumnSpec {
  field: string;
  headers: string[];
  required: boolean;
}

export interface LayoutSpec {
  id: string;
  kind: FileKind;
  variant: LayoutVariant;
  label: string;
  columns: ColumnSpec[];
  /** values of 取引区分 / 売上区分 that mean a return */
  returnValues?: string[];
  /** 単価区分 / 単価種別 values */
  priceTypes?: Record<string, PriceType>;
  /** end dates that mean "no end" (e.g. 99991231) */
  openEndValues?: string[];
}

const req = (field: string, ...headers: string[]): ColumnSpec => ({ field, headers, required: true });
const opt = (field: string, ...headers: string[]): ColumnSpec => ({ field, headers, required: false });

export const LAYOUTS: readonly LayoutSpec[] = [
  {
    id: 'sales-A',
    kind: 'sales',
    variant: 'A',
    label: '売上明細（販売管理A形式）',
    columns: [
      req('date', '売上日'),
      req('slip', '伝票番号'),
      req('line', '行'),
      opt('txType', '取引区分'),
      opt('branch', '部門'),
      req('cust', '得意先コード'),
      opt('custName', '得意先名'),
      req('sku', '商品コード'),
      opt('itemName', '商品名'),
      req('qty', '数量'),
      opt('unit', '単位'),
      opt('listPrice', '定価'),
      opt('printedRate', '掛率(%)'),
      req('unitPrice', '単価'),
      opt('amount', '金額'),
      opt('cost', '原単価'),
      opt('costAmount', '原価金額'),
      opt('grossProfit', '粗利額'),
      opt('priceType', '単価区分'),
      opt('remark', '備考'),
    ],
    returnValues: ['返品'],
    priceTypes: { 標準: '標準', 得意先: '得意先', 手入力: '手入力' },
  },
  {
    id: 'sales-B',
    kind: 'sales',
    variant: 'B',
    label: '売上データ（販売管理B形式）',
    columns: [
      req('date', '伝票日付'),
      req('slip', '伝票No'),
      req('line', '明細No'),
      req('cust', '得意先CD'),
      opt('custName', '得意先略称'),
      req('sku', '品番'),
      opt('itemName', '品名'),
      opt('txType', '売上区分'),
      req('qty', '数量'),
      opt('unit', '単位'),
      opt('listPrice', '標準価格'),
      opt('printedRate', '掛率'),
      req('unitPrice', '売単価'),
      opt('amount', '売上金額'),
      opt('cost', '原価単価'),
      opt('costAmount', '原価金額'),
      opt('priceType', '単価種別'),
      opt('remark', '摘要'),
    ],
    returnValues: ['2'],
    priceTypes: { '0': '標準', '1': '得意先', '9': '手入力' },
  },
  {
    id: 'specials-A',
    kind: 'specials',
    variant: 'A',
    label: '特値一覧（販売管理A形式）',
    columns: [
      req('cust', '得意先コード'),
      opt('custName', '得意先名'),
      req('sku', '商品コード'),
      opt('itemName', '商品名'),
      req('price', '特値単価'),
      req('start', '開始日'),
      req('end', '終了日'),
      opt('reason', '登録理由'),
    ],
    openEndValues: [''],
  },
  {
    id: 'specials-B',
    kind: 'specials',
    variant: 'B',
    label: '特価データ（販売管理B形式）',
    columns: [
      req('cust', '得意先CD'),
      req('sku', '品番'),
      req('price', '特価'),
      req('start', '有効開始日'),
      req('end', '有効終了日'),
      opt('reason', '摘要'),
    ],
    openEndValues: ['', '99991231', '9999/12/31'],
  },
  {
    id: 'priceMaster-A',
    kind: 'priceMaster',
    variant: 'A',
    label: '得意先別単価マスタ（販売管理A形式）',
    columns: [
      req('cust', '得意先コード'),
      opt('custName', '得意先名'),
      req('sku', '商品コード'),
      opt('itemName', '商品名'),
      req('effective', '適用開始日'),
      req('newPrice', '新単価'),
      req('currentPrice', '現単価'),
    ],
  },
  {
    id: 'priceMaster-B',
    kind: 'priceMaster',
    variant: 'B',
    label: '得意先単価データ（販売管理B形式）',
    columns: [
      req('cust', '得意先CD'),
      req('sku', '品番'),
      req('effective', '適用開始日'),
      req('newPrice', '売単価'),
      req('currentPrice', '旧売単価'),
    ],
  },
  {
    id: 'customers',
    kind: 'customers',
    variant: 'standard',
    label: '得意先マスタ',
    columns: [
      req('code', '得意先コード'),
      req('name', '得意先名'),
      opt('shortName', '略称'),
      opt('segment', '取引先区分'),
      req('rank', '掛率ランク'),
      req('rate', '掛率(%)'),
      opt('branch', '担当営業所'),
      opt('salesRep', '営業担当'),
      opt('prefecture', '都道府県'),
      opt('closingDay', '締日'),
      opt('department', '宛先部署'),
      opt('since', '取引開始日'),
    ],
  },
  {
    id: 'products',
    kind: 'products',
    variant: 'standard',
    label: '商品マスタ',
    columns: [
      req('code', '商品コード'),
      req('name', '商品名'),
      req('category', 'カテゴリコード'),
      opt('unit', '単位'),
      req('listPrice', '定価(円)', '定価'),
      req('cost', '原単価(円)', '原単価'),
      opt('supplier', '仕入先コード'),
      opt('material', '原材料比率(%)'),
      opt('labor', '労務費比率(%)'),
      opt('energy', 'エネルギー比率(%)'),
      opt('other', 'その他比率(%)'),
    ],
  },
  {
    id: 'rateTiers',
    kind: 'rateTiers',
    variant: 'standard',
    label: '掛率ランク',
    columns: [
      req('rank', '掛率ランク'),
      opt('name', '名称'),
      req('standard', '標準掛率(%)'),
      req('min', '下限(%)'),
      req('max', '上限(%)'),
      opt('note', '説明'),
    ],
  },
  {
    id: 'categories',
    kind: 'categories',
    variant: 'standard',
    label: 'カテゴリ',
    columns: [
      req('code', 'カテゴリコード'),
      req('name', 'カテゴリ名'),
      req('material', '原材料比率(%)'),
      req('labor', '労務費比率(%)'),
      req('energy', 'エネルギー比率(%)'),
      req('other', 'その他比率(%)'),
      opt('mainMaterial', '主な原材料'),
    ],
  },
  {
    id: 'suppliers',
    kind: 'suppliers',
    variant: 'standard',
    label: '仕入先',
    columns: [req('code', '仕入先コード'), req('name', '仕入先名'), opt('categories', '主な取扱カテゴリ')],
  },
  {
    id: 'listPriceHistory',
    kind: 'listPriceHistory',
    variant: 'standard',
    label: '定価の履歴',
    columns: [req('sku', '商品コード'), req('price', '定価(円)'), req('start', '適用開始日'), req('end', '適用終了日')],
  },
  {
    id: 'costHistory',
    kind: 'costHistory',
    variant: 'standard',
    label: '原単価の履歴',
    columns: [req('sku', '商品コード'), req('cost', '原単価(円)'), req('start', '適用開始日'), req('end', '適用終了日')],
  },
  {
    id: 'agreements',
    kind: 'agreements',
    variant: 'standard',
    label: '改定の合意状況',
    columns: [
      req('cust', '得意先コード'),
      opt('custName', '得意先名'),
      opt('requestedOn', '申入日'),
      opt('answeredOn', '回答日'),
      req('status', '合意状況', '協議結果'),
      req('effective', '適用日'),
      opt('excluded', '対象外カテゴリ'),
      opt('note', '備考'),
    ],
  },
  {
    id: 'supplierNotices',
    kind: 'supplierNotices',
    variant: 'standard',
    label: '仕入先の値上げ通知',
    columns: [
      req('noticeDate', '通知日'),
      req('supplier', '仕入先コード'),
      opt('supplierName', '仕入先名'),
      req('sku', '商品コード'),
      opt('itemName', '商品名'),
      req('currentCost', '現行仕入単価(円)'),
      req('newCost', '改定後仕入単価(円)'),
      opt('ratePct', '改定率(%)'),
      req('effective', '適用日'),
      opt('reason', '主な理由'),
      opt('status', '状態'),
    ],
  },
  {
    id: 'newListPrices',
    kind: 'newListPrices',
    variant: 'standard',
    label: '新定価表',
    columns: [
      req('sku', '商品コード'),
      opt('itemName', '商品名'),
      req('currentPrice', '現定価(円)'),
      req('newPrice', '新定価(円)'),
      req('effective', '適用日'),
    ],
  },
];

/** Header cell normalised for matching: NFKC, no spaces, lower case. */
export function normalizeHeader(h: string): string {
  return h.normalize('NFKC').replace(/\s/g, '').toLowerCase();
}

export type ColumnMapping = Record<string, number>;

export interface MappingResult {
  mapping: ColumnMapping;
  missingRequired: string[];
  matched: number;
  /** header cells that no column of the layout uses */
  unused: string[];
}

/**
 * Map a header row to the fields of a layout. `overrides` gives extra header
 * names per field (manual mapping) and takes precedence over the built-in names.
 */
export function mapColumns(header: readonly string[], spec: LayoutSpec, overrides: Record<string, string> = {}): MappingResult {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    const k = normalizeHeader(h);
    if (!index.has(k)) index.set(k, i);
  });
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const missingRequired: string[] = [];
  for (const col of spec.columns) {
    const names = [overrides[col.field], ...col.headers].filter((n): n is string => n !== undefined);
    let found = -1;
    for (const n of names) {
      const i = index.get(normalizeHeader(n));
      if (i !== undefined) {
        found = i;
        break;
      }
    }
    mapping[col.field] = found;
    if (found >= 0) used.add(found);
    else if (col.required) missingRequired.push(col.field);
  }
  const unused = header.filter((_, i) => !used.has(i));
  return { mapping, missingRequired, matched: used.size, unused };
}

export interface LayoutCandidate {
  spec: LayoutSpec;
  result: MappingResult;
}

/**
 * Pick the layout that fits a header row: all required columns present, then the
 * most matched columns, then the fewest unused header cells. Returns null when no
 * layout has all its required columns; `candidates` lists every layout that does.
 */
export function detectLayout(
  header: readonly string[],
  kinds?: readonly FileKind[],
): { best: LayoutCandidate | null; candidates: LayoutCandidate[] } {
  const candidates: LayoutCandidate[] = [];
  for (const spec of LAYOUTS) {
    if (kinds && !kinds.includes(spec.kind)) continue;
    const result = mapColumns(header, spec);
    if (result.missingRequired.length === 0) candidates.push({ spec, result });
  }
  candidates.sort((a, b) => b.result.matched - a.result.matched || a.result.unused.length - b.result.unused.length);
  return { best: candidates[0] ?? null, candidates };
}

export function layoutById(id: string): LayoutSpec {
  const spec = LAYOUTS.find((l) => l.id === id);
  if (!spec) throw new RangeError(`unknown layout ${id}`);
  return spec;
}
