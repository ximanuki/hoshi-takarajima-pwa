/**
 * 反映チェック: after the new prices start, read a later sales export and find
 * lines still billed at the old price.
 *
 * For every line of a customer × product in the new price master:
 *   - on or after the 適用開始日, the new price is expected;
 *     a bill at the 現単価 (the old price) is 旧単価のまま
 *   - before the 適用開始日, the 現単価 is still correct
 *   - a stated volume discount from the expected price is fine
 *   - any other difference is shown for a person to check
 */

import type { Dataset } from './dataset.ts';
import { pairKey } from './dataset.ts';
import { type IsoDate, toWareki } from './dates.ts';
import { divide } from './money.ts';
import { indexPriceMaster } from './priceMaster.ts';
import { formatYen, isSampleRemark, parseRemarkDiscount } from './text.ts';
import type { PriceMasterRow, SalesLine } from './types.ts';

export type FollowupStatus =
  | 'ok_new_price'
  | 'ok_before_effective'
  | 'ok_volume_discount'
  | 'still_old_price'
  | 'other_diff'
  | 'not_in_master'
  | 'excluded_return'
  | 'excluded_sample'
  | 'excluded_non_product';

export const FOLLOWUP_STATUS_JA: Record<FollowupStatus, string> = {
  ok_new_price: '新単価で請求',
  ok_before_effective: '適用開始日前（旧単価で正しい）',
  ok_volume_discount: '数量値引（備考あり）',
  still_old_price: '旧単価のまま（反映漏れ）',
  other_diff: 'その他の差異（要確認）',
  not_in_master: '新単価マスタの対象外',
  excluded_return: '対象外：返品',
  excluded_sample: '対象外：見本品（無償）',
  excluded_non_product: '対象外：商品マスタにないコード',
};

export interface FollowupLine {
  line: SalesLine;
  status: FollowupStatus;
  expected: number | null;
  master: PriceMasterRow | null;
  /** (expected − billed) × qty for still_old_price / other_diff */
  shortfallYen: number;
  explanation: string;
}

export interface FollowupCustomer {
  cust: string;
  custName: string;
  lines: number;
  pairs: number;
  shortfallYen: number;
  firstDate: IsoDate;
  lastDate: IsoDate;
}

export interface FollowupResult {
  lines: FollowupLine[];
  counts: Record<FollowupStatus, number>;
  stillOld: { lines: number; pairs: number; customers: number; shortfallYen: number };
  byCustomer: FollowupCustomer[];
}

export function checkFollowup(
  ds: Dataset,
  master: readonly PriceMasterRow[],
  sales: readonly SalesLine[],
): FollowupResult {
  const index = indexPriceMaster(master.map((r) => ({ ...r, sku: r.sku ?? ds.resolveSku(r.skuKey) })));
  const out: FollowupLine[] = [];
  const counts = Object.fromEntries(Object.keys(FOLLOWUP_STATUS_JA).map((k) => [k, 0])) as Record<
    FollowupStatus,
    number
  >;
  const push = (fl: FollowupLine) => {
    counts[fl.status]++;
    out.push(fl);
  };
  for (const raw of sales) {
    const sku = raw.sku ?? ds.resolveSku(raw.skuKey);
    const line = { ...raw, sku };
    const base = { line, expected: null, master: null, shortfallYen: 0 };
    if (sku === null) {
      push({ ...base, status: 'excluded_non_product', explanation: FOLLOWUP_STATUS_JA.excluded_non_product });
      continue;
    }
    if (line.isReturn || line.qty < 0) {
      push({ ...base, status: 'excluded_return', explanation: FOLLOWUP_STATUS_JA.excluded_return });
      continue;
    }
    if (line.unitPrice === 0 && isSampleRemark(line.remark)) {
      push({ ...base, status: 'excluded_sample', explanation: FOLLOWUP_STATUS_JA.excluded_sample });
      continue;
    }
    const rows = index.get(pairKey(line.cust, sku));
    if (!rows || rows.length === 0) {
      push({ ...base, status: 'not_in_master', explanation: FOLLOWUP_STATUS_JA.not_in_master });
      continue;
    }
    let current: PriceMasterRow | null = null;
    for (const r of rows) if (r.effective <= line.date) current = r;
    const first = rows[0] as PriceMasterRow;
    const effective = current !== null;
    const m = current ?? first;
    const expected = effective ? m.newPrice : m.currentPrice;
    const billed = line.unitPrice;
    const withMaster = { line, master: m, expected };
    if (billed === expected) {
      push({
        ...withMaster,
        status: effective ? 'ok_new_price' : 'ok_before_effective',
        shortfallYen: 0,
        explanation: effective
          ? `新単価 ${formatYen(expected)} で請求しています。`
          : `適用開始日（${toWareki(m.effective)}）前のため、旧単価 ${formatYen(expected)} で正しい請求です。`,
      });
      continue;
    }
    const disc = parseRemarkDiscount(line.remark);
    if (
      disc !== null &&
      (['floor', 'round', 'ceil'] as const).some(
        (mode) => divide(expected * (10000 - disc), 10000, mode) === billed,
      )
    ) {
      push({
        ...withMaster,
        status: 'ok_volume_discount',
        shortfallYen: 0,
        explanation: '備考の数量値引と一致します。',
      });
      continue;
    }
    const oldPrices = new Set(rows.filter((r) => r.effective <= line.date).map((r) => r.currentPrice));
    const shortfall = (expected - billed) * line.qty;
    if (effective && oldPrices.has(billed)) {
      push({
        ...withMaster,
        status: 'still_old_price',
        shortfallYen: shortfall,
        explanation: `${toWareki(m.effective)}から新単価 ${formatYen(expected)} のはずですが、旧単価 ${formatYen(billed)} のまま請求しています（不足 ${formatYen(shortfall)}）。`,
      });
      continue;
    }
    push({
      ...withMaster,
      status: 'other_diff',
      shortfallYen: shortfall,
      explanation: `請求単価 ${formatYen(billed)} が、新単価マスタの単価 ${formatYen(expected)} と一致しません。`,
    });
  }

  const stuck = out.filter((x) => x.status === 'still_old_price');
  const byCust = new Map<string, FollowupCustomer & { skus: Set<string> }>();
  for (const x of stuck) {
    const l = x.line;
    const c = byCust.get(l.cust) ?? {
      cust: l.cust,
      custName: ds.customers.get(l.cust)?.name ?? l.custName,
      lines: 0,
      pairs: 0,
      shortfallYen: 0,
      firstDate: l.date,
      lastDate: l.date,
      skus: new Set<string>(),
    };
    c.lines++;
    c.shortfallYen += x.shortfallYen;
    c.skus.add(l.sku ?? '');
    if (l.date < c.firstDate) c.firstDate = l.date;
    if (l.date > c.lastDate) c.lastDate = l.date;
    byCust.set(l.cust, c);
  }
  const byCustomer = [...byCust.values()]
    .map(({ skus, ...c }) => ({ ...c, pairs: skus.size }))
    .sort((a, b) => b.shortfallYen - a.shortfallYen || (a.cust < b.cust ? -1 : 1));
  return {
    lines: out,
    counts,
    stillOld: {
      lines: stuck.length,
      pairs: new Set(stuck.map((x) => pairKey(x.line.cust, x.line.sku ?? ''))).size,
      customers: byCust.size,
      shortfallYen: stuck.reduce((s, x) => s + x.shortfallYen, 0),
    },
    byCustomer,
  };
}
