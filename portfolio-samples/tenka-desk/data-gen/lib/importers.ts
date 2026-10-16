/**
 * Reference importers for the two fictional 販売管理 layouts.
 * They turn layout A (全角コード, 和暦, BOM, CRLF, quoted, comma thousands) and
 * layout B (半角, 品番ゆれ, yyyymmdd, 半角カナ, status codes) into the same
 * normalised records. verify.ts checks that both layouts give identical records.
 */

import { parseCsvObjects } from './csv.ts';
import { codeKey, customerKey, parseIntLoose, parseSen } from './text.ts';

export type SalesRecord = {
  date: string;
  slip: number;
  line: number;
  isReturn: boolean;
  cust: string;
  /** matching key of the raw code (see codeKey); map it to the product master */
  skuKey: string;
  rawSku: string;
  itemName: string;
  qty: number;
  unit: string;
  list: number;
  billed: number;
  amount: number;
  costSen: number;
  costAmount: number;
  priceType: '標準' | '得意先' | '手入力';
  remark: string;
};

const ERA_BASE: Record<string, number> = { R: 2018, H: 1988, 令和: 2018, 平成: 1988 };

/** "R07/04/01", "R7.4.1", "令和7年4月1日", "令和元年5月1日", "20250401", "2025/4/1", "2025-04-01" -> "2025-04-01" */
export function parseDateLoose(raw: string): string {
  const s = raw.normalize('NFKC').trim();
  let m = /^([RH])\.?(\d{1,2})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (m) return iso(ERA_BASE[m[1]] + Number(m[2]), Number(m[3]), Number(m[4]));
  m = /^(令和|平成)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (m) return iso(ERA_BASE[m[1]] + (m[2] === '元' ? 1 : Number(m[2])), Number(m[3]), Number(m[4]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  throw new Error(`unknown date format: ${JSON.stringify(raw)}`);
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function need(o: Record<string, string>, key: string): string {
  const v = o[key];
  if (v === undefined) throw new Error(`missing column ${key}`);
  return v;
}

export function parseSalesA(text: string): SalesRecord[] {
  return parseCsvObjects(text).map((o) => {
    const pt = need(o, '単価区分');
    if (pt !== '標準' && pt !== '得意先' && pt !== '手入力') throw new Error(`bad 単価区分 ${pt}`);
    return {
      date: parseDateLoose(need(o, '売上日')),
      slip: parseIntLoose(need(o, '伝票番号')),
      line: parseIntLoose(need(o, '行')),
      isReturn: need(o, '取引区分') === '返品',
      cust: customerKey(need(o, '得意先コード')),
      skuKey: codeKey(need(o, '商品コード')),
      rawSku: need(o, '商品コード'),
      itemName: need(o, '商品名').normalize('NFKC'),
      qty: parseIntLoose(need(o, '数量')),
      unit: need(o, '単位').normalize('NFKC'),
      list: parseIntLoose(need(o, '定価')),
      billed: parseIntLoose(need(o, '単価')),
      amount: parseIntLoose(need(o, '金額')),
      costSen: parseSen(need(o, '原単価')),
      costAmount: parseIntLoose(need(o, '原価金額')),
      priceType: pt,
      remark: need(o, '備考').normalize('NFKC'),
    };
  });
}

const PRICE_TYPE_B: Record<string, SalesRecord['priceType']> = { '0': '標準', '1': '得意先', '9': '手入力' };

export function parseSalesB(text: string): SalesRecord[] {
  return parseCsvObjects(text).map((o) => {
    const pt = PRICE_TYPE_B[need(o, '単価種別')];
    if (!pt) throw new Error(`bad 単価種別 ${o['単価種別']}`);
    return {
      date: parseDateLoose(need(o, '伝票日付')),
      slip: parseIntLoose(need(o, '伝票No')),
      line: parseIntLoose(need(o, '明細No')),
      isReturn: need(o, '売上区分') === '2',
      cust: customerKey(need(o, '得意先CD')),
      skuKey: codeKey(need(o, '品番')),
      rawSku: need(o, '品番'),
      itemName: need(o, '品名').normalize('NFKC'),
      qty: parseIntLoose(need(o, '数量')),
      unit: need(o, '単位').normalize('NFKC'),
      list: parseIntLoose(need(o, '標準価格')),
      billed: parseIntLoose(need(o, '売単価')),
      amount: parseIntLoose(need(o, '売上金額')),
      costSen: parseSen(need(o, '原価単価')),
      costAmount: parseIntLoose(need(o, '原価金額')),
      priceType: pt,
      remark: need(o, '摘要').normalize('NFKC'),
    };
  });
}

export type SpecialRecord = { cust: string; skuKey: string; price: number; start: string; end: string | null; reason: string };

export function parseSpecialsA(text: string): SpecialRecord[] {
  return parseCsvObjects(text).map((o) => ({
    cust: customerKey(need(o, '得意先コード')),
    skuKey: codeKey(need(o, '商品コード')),
    price: parseIntLoose(need(o, '特値単価')),
    start: parseDateLoose(need(o, '開始日')),
    end: need(o, '終了日').trim() === '' ? null : parseDateLoose(need(o, '終了日')),
    reason: need(o, '登録理由').normalize('NFKC'),
  }));
}

export function parseSpecialsB(text: string): SpecialRecord[] {
  return parseCsvObjects(text).map((o) => {
    const end = need(o, '有効終了日').trim();
    return {
      cust: customerKey(need(o, '得意先CD')),
      skuKey: codeKey(need(o, '品番')),
      price: parseIntLoose(need(o, '特価')),
      start: parseDateLoose(need(o, '有効開始日')),
      end: end === '' || end === '99991231' ? null : parseDateLoose(end),
      reason: need(o, '摘要').normalize('NFKC'),
    };
  });
}

export type PriceMasterRecord = { cust: string; skuKey: string; eff: string; newPrice: number; curPrice: number };

export function parsePriceMasterA(text: string): PriceMasterRecord[] {
  return parseCsvObjects(text).map((o) => ({
    cust: customerKey(need(o, '得意先コード')),
    skuKey: codeKey(need(o, '商品コード')),
    eff: parseDateLoose(need(o, '適用開始日')),
    newPrice: parseIntLoose(need(o, '新単価')),
    curPrice: parseIntLoose(need(o, '現単価')),
  }));
}

export function parsePriceMasterB(text: string): PriceMasterRecord[] {
  return parseCsvObjects(text).map((o) => ({
    cust: customerKey(need(o, '得意先CD')),
    skuKey: codeKey(need(o, '品番')),
    eff: parseDateLoose(need(o, '適用開始日')),
    newPrice: parseIntLoose(need(o, '売単価')),
    curPrice: parseIntLoose(need(o, '旧売単価')),
  }));
}
