/**
 * Importers: CSV table -> typed records, with every problem reported per row
 * instead of stopping at the first one. Rows that cannot be read are skipped and
 * listed in `issues` so the user can see and fix them.
 */

import { type CsvTable, readTable } from './csv.ts';
import { parseDateLoose } from './dates.ts';
import { type DecodedText, decodeBytes, type TextEncodingName } from './encoding.ts';
import { type ColumnMapping, detectLayout, type FileKind, type LayoutSpec, mapColumns } from './layouts.ts';
import { codeKey, customerKey, normalizeText, parseIntLoose, parsePercentPm, parseSen } from './text.ts';
import type {
  AgreementKind,
  Category,
  CostRow,
  CostShare,
  Customer,
  ListPriceRow,
  NewListPrice,
  PriceMasterRow,
  PriceType,
  Product,
  RateTier,
  RevisionAgreement,
  SalesLine,
  SpecialPrice,
  Supplier,
  SupplierNotice,
} from './types.ts';

export interface ImportIssue {
  /** 1-based physical line in the file (the line a row starts on; blank lines and line breaks inside quotes count) */
  row: number;
  field?: string;
  message: string;
  value?: string;
}

export interface ImportResult<T> {
  records: T[];
  issues: ImportIssue[];
}

class RowReader {
  readonly issues: ImportIssue[] = [];
  row = 0;
  private cells: readonly string[] = [];
  private failed = false;
  private readonly mapping: ColumnMapping;
  constructor(mapping: ColumnMapping) {
    this.mapping = mapping;
  }

  start(cells: readonly string[], row: number): void {
    this.cells = cells;
    this.row = row;
    this.failed = false;
  }

  get ok(): boolean {
    return !this.failed;
  }

  fail(field: string, message: string, value?: string): void {
    this.failed = true;
    this.issues.push(
      value === undefined ? { row: this.row, field, message } : { row: this.row, field, message, value },
    );
  }

  warn(field: string, message: string, value?: string): void {
    this.issues.push(
      value === undefined ? { row: this.row, field, message } : { row: this.row, field, message, value },
    );
  }

  has(field: string): boolean {
    return (this.mapping[field] ?? -1) >= 0;
  }

  raw(field: string): string {
    const i = this.mapping[field] ?? -1;
    return i >= 0 ? (this.cells[i] ?? '') : '';
  }

  text(field: string): string {
    return normalizeText(this.raw(field));
  }

  int(field: string): number {
    const v = parseIntLoose(this.raw(field));
    if (v === null) {
      this.fail(field, '整数として読めません', this.raw(field));
      return 0;
    }
    return v;
  }

  intOrNull(field: string): number | null {
    if (!this.has(field) || this.raw(field).trim() === '') return null;
    const v = parseIntLoose(this.raw(field));
    if (v === null) this.warn(field, '整数として読めないため空欄として扱います', this.raw(field));
    return v;
  }

  sen(field: string): number {
    const v = parseSen(this.raw(field));
    if (v === null) {
      this.fail(field, '金額として読めません', this.raw(field));
      return 0;
    }
    return v;
  }

  senOrNull(field: string): number | null {
    if (!this.has(field) || this.raw(field).trim() === '') return null;
    const v = parseSen(this.raw(field));
    if (v === null) this.warn(field, '金額として読めないため空欄として扱います', this.raw(field));
    return v;
  }

  pm(field: string): number {
    const v = parsePercentPm(this.raw(field));
    if (v === null) {
      this.fail(field, '率（%）として読めません', this.raw(field));
      return 0;
    }
    return v;
  }

  date(field: string): string {
    const v = parseDateLoose(this.raw(field));
    if (v === null) {
      this.fail(field, '日付として読めません', this.raw(field));
      return '';
    }
    return v;
  }

  dateOrNull(field: string, openValues: readonly string[] = ['']): string | null {
    const raw = this.raw(field);
    const n = normalizeText(raw).replace(/\s/g, '');
    if (openValues.map((v) => normalizeText(v)).includes(n)) return null;
    const v = parseDateLoose(raw);
    if (v === null) this.fail(field, '日付として読めません', raw);
    return v;
  }
}

function run<T>(table: CsvTable, mapping: ColumnMapping, convert: (r: RowReader) => T): ImportResult<T> {
  const reader = new RowReader(mapping);
  const records: T[] = [];
  const width = table.header.length;
  for (const w of table.warnings) reader.issues.push({ row: w.line, field: '*', message: w.message });
  table.rows.forEach((cells, i) => {
    reader.start(cells, table.rowLines[i] ?? i + 2);
    if (cells.length !== width) {
      reader.fail('*', `列の数が見出しと違います（${cells.length}列／見出し${width}列）`);
      return;
    }
    const rec = convert(reader);
    if (reader.ok) records.push(rec);
  });
  return { records, issues: reader.issues };
}

function splitList(s: string): string[] {
  return s
    .split(/[;；、,，\s/／]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

/* ---------- per kind ---------- */

export function importSales(
  table: CsvTable,
  spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<SalesLine> {
  const returnValues = new Set((spec.returnValues ?? []).map(normalizeText));
  const priceTypes = spec.priceTypes ?? {};
  return run(table, mapping, (r) => {
    const slip = r.text('slip');
    const line = r.int('line');
    const qty = r.int('qty');
    const tx = r.text('txType');
    const ptRaw = r.text('priceType');
    const priceType: PriceType = priceTypes[ptRaw] ?? '不明';
    const rawSku = r.raw('sku').trim();
    const cust = customerKey(r.raw('cust'));
    if (cust === '') r.fail('cust', '得意先コードが空です');
    return {
      id: `${slip}-${line}`,
      date: r.date('date'),
      slip,
      line,
      isReturn: returnValues.has(tx) || qty < 0,
      cust,
      custName: r.text('custName'),
      rawSku,
      skuKey: codeKey(rawSku),
      sku: null,
      itemName: r.text('itemName'),
      qty,
      unit: r.text('unit'),
      printedListPrice: r.intOrNull('listPrice'),
      unitPrice: r.int('unitPrice'),
      amount: r.intOrNull('amount'),
      costSen: r.senOrNull('cost'),
      priceType,
      remark: r.text('remark'),
      branch: r.text('branch'),
      sourceRow: r.row,
    };
  });
}

export function importSpecials(
  table: CsvTable,
  spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<SpecialPrice> {
  return run(table, mapping, (r) => {
    const rawSku = r.raw('sku').trim();
    const start = r.date('start');
    const end = r.dateOrNull('end', spec.openEndValues ?? ['']);
    if (r.ok && end !== null && end < start) r.fail('end', '終了日が開始日より前です', r.raw('end'));
    return {
      cust: customerKey(r.raw('cust')),
      sku: null,
      skuKey: codeKey(rawSku),
      rawSku,
      price: r.int('price'),
      start,
      end,
      reason: r.text('reason'),
    };
  });
}

export function importPriceMaster(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<PriceMasterRow> {
  return run(table, mapping, (r) => {
    const rawSku = r.raw('sku').trim();
    return {
      cust: customerKey(r.raw('cust')),
      sku: null,
      skuKey: codeKey(rawSku),
      rawSku,
      effective: r.date('effective'),
      newPrice: r.int('newPrice'),
      currentPrice: r.int('currentPrice'),
    };
  });
}

export function importCustomers(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<Customer> {
  return run(table, mapping, (r) => ({
    code: customerKey(r.raw('code')),
    name: r.text('name'),
    shortName: r.text('shortName'),
    segment: r.text('segment'),
    rank: r.text('rank'),
    ratePm: r.pm('rate'),
    branch: r.text('branch'),
    salesRep: r.text('salesRep'),
    prefecture: r.text('prefecture'),
    closingDay: r.text('closingDay'),
    department: r.text('department'),
    since: r.has('since') ? r.dateOrNull('since') : null,
  }));
}

const NO_SHARE: CostShare = { material: 0, labor: 0, energy: 0, other: 0 };

function readShare(r: RowReader): CostShare | null {
  if (!r.has('material')) return null;
  if (['material', 'labor', 'energy', 'other'].every((f) => r.raw(f).trim() === '')) return null;
  const s = {
    material: r.int('material'),
    labor: r.int('labor'),
    energy: r.int('energy'),
    other: r.int('other'),
  };
  if (r.ok && s.material + s.labor + s.energy + s.other !== 100) {
    r.warn('material', '原価構成比の合計が100%ではありません');
  }
  return s;
}

/** Products. When a row has no cost split, `costShare` is all zero and the dataset fills it from the category. */
export function importProducts(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<Product> {
  return run(table, mapping, (r) => {
    const code = r.text('code');
    return {
      code,
      key: codeKey(code),
      name: r.text('name'),
      category: r.text('category'),
      unit: r.text('unit'),
      listPrice: r.int('listPrice'),
      costSen: r.sen('cost'),
      supplier: r.text('supplier'),
      costShare: readShare(r) ?? { ...NO_SHARE },
    };
  });
}

export function importRateTiers(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<RateTier> {
  return run(table, mapping, (r) => {
    const t = {
      rank: r.text('rank'),
      name: r.text('name'),
      standardPm: r.pm('standard'),
      minPm: r.pm('min'),
      maxPm: r.pm('max'),
      note: r.text('note'),
    };
    if (r.ok && !(t.minPm <= t.standardPm && t.standardPm <= t.maxPm))
      r.fail('min', '下限・標準・上限の順になっていません');
    return t;
  });
}

export function importCategories(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<Category> {
  return run(table, mapping, (r) => ({
    code: r.text('code'),
    name: r.text('name'),
    costShare: readShare(r) ?? { ...NO_SHARE },
    mainMaterial: r.text('mainMaterial'),
  }));
}

export function importSuppliers(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<Supplier> {
  return run(table, mapping, (r) => ({
    code: r.text('code'),
    name: r.text('name'),
    categories: splitList(r.text('categories')),
  }));
}

export function importListPriceHistory(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<ListPriceRow> {
  return run(table, mapping, (r) => {
    const start = r.date('start');
    const end = r.dateOrNull('end');
    // 期間が逆さの行はどの日にも当たらないので、黙って使わずにエラーにする（特値と同じ）
    if (r.ok && end !== null && end < start) r.fail('end', '終了日が開始日より前です', r.raw('end'));
    return { sku: r.text('sku'), price: r.int('price'), start, end };
  });
}

export function importCostHistory(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<CostRow> {
  return run(table, mapping, (r) => {
    const start = r.date('start');
    const end = r.dateOrNull('end');
    if (r.ok && end !== null && end < start) r.fail('end', '終了日が開始日より前です', r.raw('end'));
    return { sku: r.text('sku'), costSen: r.sen('cost'), start, end };
  });
}

const AGREE_WORD = '(?:合意|承諾|了承|受諾)';
/** "不合意", "非合意": refused. */
const AGREE_REFUSED = new RegExp(`(?:不|非)${AGREE_WORD}`);
/** "合意に至らず", "合意できず", "承諾せず", "了承いただけず", "合意なし" …: no agreement. */
const AGREE_NEGATED = new RegExp(
  `${AGREE_WORD}(?:に|には)?(?:至ら|いたら|でき(?:ず|ない|なかった|ません)|せず|しない|しなかった|しません|な(?:し|い|かった)|無し|いただけ(?:ず|ない|なかった|ません)|頂け(?:ず|ない)|され(?:ず|ない|なかった)|不可|得られ(?:ず|ない))`,
);
/** "未合意", "合意予定", "合意見込み", "再協議": not (yet) agreed. */
const AGREE_PENDING = new RegExp(`未${AGREE_WORD}|${AGREE_WORD}(?:の)?(?:予定|見込|見通し)|再協議|再交渉`);

/**
 * Status words read without interpretation. Anything else is classified from
 * its wording and reported (see isPlainAgreementStatus), so a person can check
 * how an unusual 合意状況 was read.
 */
const PLAIN_STATUS: Readonly<Record<string, AgreementKind>> = {
  合意: 'agreed',
  合意済: 'agreed',
  合意済み: 'agreed',
  承諾: 'agreed',
  了承: 'agreed',
  受諾: 'agreed',
  '合意(適用日変更)': 'agreed_later_date',
  一部合意: 'partial',
  見送り: 'declined',
  見送: 'declined',
  不合意: 'declined',
  辞退: 'declined',
  協議中: 'negotiating',
  交渉中: 'negotiating',
  回答待ち: 'negotiating',
  未回答: 'negotiating',
  保留: 'negotiating',
  検討中: 'negotiating',
  対象外: 'not_applicable',
};

function statusKey(status: string): string {
  return normalizeText(status).replace(/\s/g, '');
}

/**
 * The status is one of the fixed words, possibly with a note in brackets that does
 * not change how it is read ("対象外（改定後に取引開始）"): no free text had to be
 * interpreted.
 */
export function isPlainAgreementStatus(status: string): boolean {
  const k = statusKey(status);
  if (k === '' || k in PLAIN_STATUS) return true;
  const base = PLAIN_STATUS[k.replace(/\([^()]*\)$/, '')];
  return base !== undefined && classifyAgreement(status) === base;
}

/**
 * Classify a free-text 合意状況 / 協議結果 into a fixed set of kinds. Negations
 * and future forms are read before the agreement words, so "合意に至らず",
 * "未合意" or "合意予定" never count as agreed.
 */
export function classifyAgreement(status: string): AgreementKind {
  const s = statusKey(status);
  if (s === '') return 'unknown';
  const plain = PLAIN_STATUS[s];
  if (plain) return plain;
  if (s.includes('対象外')) return 'not_applicable';
  if (AGREE_REFUSED.test(s) || AGREE_NEGATED.test(s)) return 'declined';
  if (AGREE_PENDING.test(s)) return 'negotiating';
  if (/(一部|部分)/.test(s)) return 'partial';
  if (/(見送|拒否|不成立|辞退|断り)/.test(s)) return 'declined';
  if (/(協議中|交渉中|回答待|未回答|保留|検討中)/.test(s)) return 'negotiating';
  if (new RegExp(AGREE_WORD).test(s))
    return /(適用日変更|時期変更|延期|後ろ倒し)/.test(s) ? 'agreed_later_date' : 'agreed';
  return 'unknown';
}

export const AGREEMENT_KIND_JA: Record<AgreementKind, string> = {
  agreed: '合意',
  agreed_later_date: '合意（適用日変更）',
  partial: '一部合意',
  declined: '見送り',
  negotiating: '協議中（未合意）',
  not_applicable: '対象外',
  unknown: '判別できない',
};

export function importAgreements(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<RevisionAgreement> {
  return run(table, mapping, (r) => {
    const status = r.text('status');
    const kind = classifyAgreement(status);
    const excludedCategories = splitList(r.text('excluded'));
    // 一部合意なのに据え置くカテゴリがないと、どこまで合意したか分からない。全面合意として扱うと
    // 合意していない品目まで新単価になるので、この行は使わない（協議記録の一部合意と同じ扱い）
    if (r.ok && kind === 'partial' && excludedCategories.length === 0) {
      r.fail(
        'excluded',
        '一部合意ですが対象外カテゴリが空です。据え置くカテゴリを書いてください',
        r.raw('excluded'),
      );
    }
    return {
      cust: customerKey(r.raw('cust')),
      status,
      kind,
      effective: r.dateOrNull('effective'),
      excludedCategories,
      requestedOn: r.has('requestedOn') ? r.dateOrNull('requestedOn') : null,
      answeredOn: r.has('answeredOn') ? r.dateOrNull('answeredOn') : null,
      note: r.text('note'),
    };
  });
}

export function importSupplierNotices(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<SupplierNotice> {
  return run(table, mapping, (r) => ({
    noticeDate: r.date('noticeDate'),
    supplier: r.text('supplier'),
    supplierName: r.text('supplierName'),
    sku: r.text('sku'),
    currentCostSen: r.sen('currentCost'),
    newCostSen: r.sen('newCost'),
    effective: r.date('effective'),
    reason: r.text('reason'),
    status: r.text('status'),
  }));
}

export function importNewListPrices(
  table: CsvTable,
  _spec: LayoutSpec,
  mapping: ColumnMapping,
): ImportResult<NewListPrice> {
  return run(table, mapping, (r) => ({
    sku: r.text('sku'),
    currentPrice: r.int('currentPrice'),
    newPrice: r.int('newPrice'),
    effective: r.date('effective'),
  }));
}

/* ---------- one entry point for any file ---------- */

export type ImportedData =
  | { kind: 'sales'; result: ImportResult<SalesLine> }
  | { kind: 'specials'; result: ImportResult<SpecialPrice> }
  | { kind: 'priceMaster'; result: ImportResult<PriceMasterRow> }
  | { kind: 'customers'; result: ImportResult<Customer> }
  | { kind: 'products'; result: ImportResult<Product> }
  | { kind: 'rateTiers'; result: ImportResult<RateTier> }
  | { kind: 'categories'; result: ImportResult<Category> }
  | { kind: 'suppliers'; result: ImportResult<Supplier> }
  | { kind: 'listPriceHistory'; result: ImportResult<ListPriceRow> }
  | { kind: 'costHistory'; result: ImportResult<CostRow> }
  | { kind: 'agreements'; result: ImportResult<RevisionAgreement> }
  | { kind: 'supplierNotices'; result: ImportResult<SupplierNotice> }
  | { kind: 'newListPrices'; result: ImportResult<NewListPrice> };

export function importWithLayout(table: CsvTable, spec: LayoutSpec, mapping: ColumnMapping): ImportedData {
  switch (spec.kind) {
    case 'sales':
      return { kind: spec.kind, result: importSales(table, spec, mapping) };
    case 'specials':
      return { kind: spec.kind, result: importSpecials(table, spec, mapping) };
    case 'priceMaster':
      return { kind: spec.kind, result: importPriceMaster(table, spec, mapping) };
    case 'customers':
      return { kind: spec.kind, result: importCustomers(table, spec, mapping) };
    case 'products':
      return { kind: spec.kind, result: importProducts(table, spec, mapping) };
    case 'rateTiers':
      return { kind: spec.kind, result: importRateTiers(table, spec, mapping) };
    case 'categories':
      return { kind: spec.kind, result: importCategories(table, spec, mapping) };
    case 'suppliers':
      return { kind: spec.kind, result: importSuppliers(table, spec, mapping) };
    case 'listPriceHistory':
      return { kind: spec.kind, result: importListPriceHistory(table, spec, mapping) };
    case 'costHistory':
      return { kind: spec.kind, result: importCostHistory(table, spec, mapping) };
    case 'agreements':
      return { kind: spec.kind, result: importAgreements(table, spec, mapping) };
    case 'supplierNotices':
      return { kind: spec.kind, result: importSupplierNotices(table, spec, mapping) };
    case 'newListPrices':
      return { kind: spec.kind, result: importNewListPrices(table, spec, mapping) };
  }
}

export interface FileImport {
  name: string;
  decoded: DecodedText;
  table: CsvTable;
  spec: LayoutSpec;
  /** field -> column index used */
  mapping: ColumnMapping;
  data: ImportedData;
}

/** The file is not CSV text the app can read (empty, or an Excel workbook); retrying with other columns cannot help. */
export class UnreadableFileError extends Error {
  readonly fileName: string;
  constructor(fileName: string, message: string) {
    super(`${fileName}: ${message}`);
    this.name = 'UnreadableFileError';
    this.fileName = fileName;
  }
}

function startsWithBytes(b: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((x, i) => b[i] === x);
}

/** Refuse files that are certainly not CSV, with a message that says what to do. */
function checkReadable(name: string, data: Uint8Array | string): void {
  if (typeof data === 'string' ? data.trim() === '' : data.length === 0)
    throw new UnreadableFileError(name, 'ファイルが空です。書き出しの手順をもう一度確かめてください。');
  if (typeof data === 'string') return;
  const excel =
    startsWithBytes(data, [0x50, 0x4b, 0x03, 0x04]) || // .xlsx (ZIP)
    startsWithBytes(data, [0xd0, 0xcf, 0x11, 0xe0]); // .xls (OLE)
  if (excel)
    throw new UnreadableFileError(
      name,
      'Excel形式（.xlsx / .xls）は読めません。Excelで「CSV UTF-8（コンマ区切り）」として保存し直してください。',
    );
}

export class LayoutNotRecognisedError extends Error {
  readonly fileName: string;
  readonly header: string[];
  constructor(fileName: string, header: string[]) {
    super(
      `${fileName}: 列の見出しからファイルの種類を判別できませんでした（${header.slice(0, 6).join(', ')} …）`,
    );
    this.name = 'LayoutNotRecognisedError';
    this.fileName = fileName;
    this.header = header;
  }
}

/**
 * Read a file the user dropped in: decode (UTF-8 or Shift_JIS), parse CSV,
 * detect the layout from the header (or use `layoutId` with optional manual
 * column names) and import it.
 */
export interface ImportOptions {
  encoding?: TextEncodingName | 'auto';
  kinds?: FileKind[];
  spec?: LayoutSpec;
  columnOverrides?: Record<string, string>;
}

export function importFile(name: string, data: Uint8Array | string, options: ImportOptions = {}): FileImport {
  checkReadable(name, data);
  const decoded: DecodedText =
    typeof data === 'string'
      ? { text: data, encoding: 'utf-8', bom: false }
      : decodeBytes(data, options.encoding ?? 'auto');
  const table = readTable(decoded.text);
  if (
    table.header.length === 0 ||
    (table.header.length === 1 && table.rows.length === 0 && table.header[0] === '')
  )
    throw new UnreadableFileError(name, 'ファイルが空です。書き出しの手順をもう一度確かめてください。');
  let spec = options.spec;
  let mapping: ColumnMapping;
  if (spec) {
    const m = mapColumns(table.header, spec, options.columnOverrides);
    if (m.missingRequired.length > 0) {
      throw new RangeError(`${name}: 必要な列がありません: ${m.missingRequired.join(', ')}`);
    }
    mapping = m.mapping;
  } else {
    const { best } = detectLayout(table.header, options.kinds);
    if (!best) throw new LayoutNotRecognisedError(name, table.header);
    spec = best.spec;
    mapping = best.result.mapping;
  }
  return { name, decoded, table, spec, mapping, data: importWithLayout(table, spec, mapping) };
}
