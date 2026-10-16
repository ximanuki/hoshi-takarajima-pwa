/**
 * 新単価マスタ: the agreed new unit prices per customer × product with their
 * 適用開始日, exported in the import layout of 販売管理A or B.
 */

import { BOM, toCsv } from './csv.ts';
import { type Dataset, pairKey } from './dataset.ts';
import { type IsoDate, toCompactDate, toWarekiShort } from './dates.ts';
import { encodeShiftJis, encodeUtf8 } from './encoding.ts';
import { classifyAgreement } from './importers.ts';
import { currentStatus, currentTerms, type NegotiationLog } from './negotiation.ts';
import type { PairProposal } from './proposal.ts';
import { toFullWidth, withCommas } from './text.ts';
import type { PriceMasterRow, RevisionAgreement } from './types.ts';

/** What a customer agreed to, from the negotiation log or an outcomes file. */
export interface NegotiationOutcome {
  cust: string;
  agreed: boolean;
  /** 一部合意 (some categories kept at the old price) */
  partial?: boolean;
  effective: IsoDate | null;
  excludedCategories: string[];
  /** agreed unit prices that differ from the proposal */
  itemPrices: Map<string, number>;
}

/** Outcomes from a file of 協議結果 (same columns as 合意状況). */
export function outcomesFromAgreements(rows: readonly RevisionAgreement[]): Map<string, NegotiationOutcome> {
  const out = new Map<string, NegotiationOutcome>();
  for (const r of rows) {
    const kind = classifyAgreement(r.status);
    // 一部合意は据え置くカテゴリが分かるときだけ合意として扱う（空なら全品目を新単価にしてしまう）
    const agreed =
      (kind === 'agreed' ||
        kind === 'agreed_later_date' ||
        (kind === 'partial' && r.excludedCategories.length > 0)) &&
      r.effective !== null;
    out.set(r.cust, {
      cust: r.cust,
      agreed,
      partial: agreed && kind === 'partial',
      effective: r.effective,
      excludedCategories: [...r.excludedCategories],
      itemPrices: new Map(),
    });
  }
  return out;
}

/** Outcome from a 協議記録 (null while not agreed). */
export function outcomeFromLog(log: NegotiationLog): NegotiationOutcome | null {
  const s = currentStatus(log);
  const terms = currentTerms(log);
  if ((s !== '合意' && s !== '一部合意') || !terms) return null;
  return {
    cust: log.cust,
    agreed: true,
    partial: s === '一部合意',
    effective: terms.effective,
    excludedCategories: [...terms.excludedCategories],
    itemPrices: new Map(terms.itemPrices.map((x) => [x.sku, x.price])),
  };
}

export interface PriceMasterOptions {
  /**
   * 現単価 column: 'system' (default) — the price the sales system charges now:
   * the last billed price while a billing leak goes on, else the correct price;
   * 'last_billed' — the latest billed price in the sales data;
   * 'expected' — the correct current price.
   */
  currentPrice?: 'system' | 'last_billed' | 'expected';
}

/** Rows for every proposed pair of an agreed customer (except kept categories), sorted by customer and product. */
export function buildPriceMaster(
  pairs: readonly PairProposal[],
  outcomes: ReadonlyMap<string, NegotiationOutcome>,
  options: PriceMasterOptions = {},
): PriceMasterRow[] {
  const rows: PriceMasterRow[] = [];
  for (const p of pairs) {
    if (p.status !== 'proposed') continue;
    const o = outcomes.get(p.cust);
    if (!o?.agreed || o.effective === null) continue;
    if (o.excludedCategories.includes(p.category)) continue;
    const newPrice = o.itemPrices.get(p.sku) ?? p.newPrice;
    const mode = options.currentPrice ?? 'system';
    const currentPrice =
      mode === 'expected' ? p.currentPrice : mode === 'last_billed' ? p.lastBilledPrice : p.systemPrice;
    if (newPrice === currentPrice) continue;
    rows.push({
      cust: p.cust,
      sku: p.sku,
      skuKey: p.sku,
      rawSku: p.sku,
      effective: o.effective,
      newPrice,
      currentPrice,
    });
  }
  return rows.sort((a, b) =>
    a.cust !== b.cust
      ? a.cust < b.cust
        ? -1
        : 1
      : (a.sku ?? '') < (b.sku ?? '')
        ? -1
        : (a.sku ?? '') > (b.sku ?? '')
          ? 1
          : 0,
  );
}

export interface ExportedFile {
  fileName: string;
  text: string;
  bytes: Uint8Array;
  encoding: 'utf-8' | 'shift_jis';
}

const HEADER_A = ['得意先コード', '得意先名', '商品コード', '商品名', '適用開始日', '新単価', '現単価'];
const HEADER_B = ['得意先CD', '品番', '適用開始日', '売単価', '旧売単価'];

/**
 * Write the price master in a layout:
 *  A: UTF-8 with BOM (or Shift_JIS), CRLF, every field quoted, 全角コード, 和暦 "R08/12/01", 3桁区切り
 *  B: UTF-8 without BOM (or Shift_JIS), LF, half-width codes, "20261201", plain numbers
 */
export function exportPriceMaster(
  ds: Dataset,
  rows: readonly PriceMasterRow[],
  layout: 'A' | 'B',
  options: {
    encoding?: 'utf-8' | 'shift_jis';
    fileName?: string;
    /** Shift_JIS only: characters it cannot hold stop the export ('error', default) or become '?' */
    onUnmappable?: 'error' | 'replace';
  } = {},
): ExportedFile {
  const encoding = options.encoding ?? 'utf-8';
  let text: string;
  if (layout === 'A') {
    const body = rows.map((r) => {
      const sku = r.sku ?? r.rawSku;
      return [
        toFullWidth(r.cust),
        ds.customers.get(r.cust)?.name ?? '',
        toFullWidth(sku),
        toFullWidth(ds.products.get(sku)?.name ?? ''),
        toWarekiShort(r.effective),
        withCommas(r.newPrice),
        withCommas(r.currentPrice),
      ];
    });
    text = toCsv(HEADER_A, body, { bom: encoding === 'utf-8', eol: '\r\n', quoteAll: true });
  } else {
    const body = rows.map((r) => [
      // B形式 has no zero padding: drop the zeros customerKey adds (up to 6 digits) as text,
      // so a longer code such as 0001234 keeps its zeros and very long codes keep every digit
      r.cust.length > 6 ? r.cust : r.cust.replace(/^0+(?=\d)/, ''),
      r.sku ?? r.rawSku,
      toCompactDate(r.effective),
      String(r.newPrice),
      String(r.currentPrice),
    ]);
    text = toCsv(HEADER_B, body, { bom: false, eol: '\n', quoteAll: false });
  }
  const effs = [...new Set(rows.map((r) => r.effective))].sort();
  const stamp = effs[0] ? toCompactDate(effs[0]) : 'empty';
  const fileName = options.fileName ?? `price_master_${layout}_${stamp}.csv`;
  const bytes =
    encoding === 'shift_jis'
      ? encodeShiftJis(text.startsWith(BOM) ? text.slice(1) : text, options.onUnmappable ?? 'error')
      : encodeUtf8(text.startsWith(BOM) ? text.slice(1) : text, text.startsWith(BOM));
  return { fileName, text, bytes, encoding };
}

/** Index of a price master by customer × product, rows sorted by 適用開始日. */
export function indexPriceMaster(rows: readonly PriceMasterRow[]): Map<string, PriceMasterRow[]> {
  const out = new Map<string, PriceMasterRow[]>();
  for (const r of rows) {
    if (r.sku === null) continue;
    const k = pairKey(r.cust, r.sku);
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  for (const list of out.values())
    list.sort((a, b) => (a.effective < b.effective ? -1 : a.effective > b.effective ? 1 : 0));
  return out;
}
