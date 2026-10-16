/**
 * A tiny fictional (架空) data set for unit tests, small enough to check every
 * number by hand.
 *
 * 定価改定 on 2025-04-01: DB-1001 710 → 770円, KG-1001 1,000 → 1,100円; DB-1002 unchanged (500円).
 * Customers and their answers to that revision:
 *   000001 A商事  rank B, 掛率72.0%  合意 (from 2025-04-01)
 *   000002 B工業  rank B, 掛率72.0%  見送り
 *   000003 C物流  rank S, 掛率58.0%  一部合意 (KG kept at the old 定価)
 *   000004 D食品  rank B, 掛率70.0%  合意(適用日変更) from 2025-06-01
 * 特値: A商事 × DB-1002 330円 (2024-04-01〜2025-03-31, expired);
 *       B工業 × DB-1001 450円 (from 2025-04-01, no end).
 */

import { Dataset, type DatasetInput } from '../dataset.ts';
import { classifyAgreement } from '../importers.ts';
import { codeKey } from '../text.ts';
import type { Customer, Product, RevisionAgreement, SalesLine } from '../types.ts';

export const REVISION = '2025-04-01';

function customer(code: string, name: string, rank: string, ratePm: number): Customer {
  return {
    code,
    name,
    shortName: name,
    segment: '製造業',
    rank,
    ratePm,
    branch: '本社営業部',
    salesRep: '佐藤',
    prefecture: '大阪府',
    closingDay: '末日',
    department: '購買部',
    since: '2015-04-01',
  };
}

function product(code: string, name: string, category: string, listPrice: number, costSen: number): Product {
  return {
    code,
    key: codeKey(code),
    name,
    category,
    unit: code.startsWith('KG') ? '個' : 'ケース',
    listPrice,
    costSen,
    supplier: 'S01',
    costShare:
      category === 'KG'
        ? { material: 45, labor: 30, energy: 12, other: 13 }
        : { material: 55, labor: 15, energy: 15, other: 15 },
  };
}

export function agreement(
  cust: string,
  status: string,
  effective: string | null,
  excluded: string[] = [],
): RevisionAgreement {
  return {
    cust,
    status,
    kind: classifyAgreement(status),
    effective,
    excludedCategories: excluded,
    requestedOn: '2025-01-15',
    answeredOn: '2025-02-20',
    note: '',
  };
}

export function fixtureInput(): DatasetInput {
  return {
    customers: [
      customer('000001', '株式会社A商事', 'B', 720),
      customer('000002', '株式会社B工業', 'B', 720),
      customer('000003', '株式会社C物流', 'S', 580),
      customer('000004', '株式会社D食品', 'B', 700),
    ],
    products: [
      product('DB-1001', '段ボール箱 A式 200×150×100mm 10枚入', 'DB', 770, 31141),
      product('DB-1002', '段ボール箱 A式 300×200×150mm 10枚入', 'DB', 500, 20000),
      product('KG-1001', '両口スパナ 10×12mm', 'KG', 1100, 60000),
    ],
    rateTiers: [
      { rank: 'S', name: '代理店・二次卸', standardPm: 580, minPm: 560, maxPm: 600, note: '' },
      { rank: 'B', name: '一般ユーザー', standardPm: 720, minPm: 700, maxPm: 750, note: '' },
    ],
    categories: [
      {
        code: 'DB',
        name: '段ボール・紙器',
        costShare: { material: 55, labor: 15, energy: 15, other: 15 },
        mainMaterial: '段ボール原紙',
      },
      {
        code: 'KG',
        name: '工具・金物',
        costShare: { material: 45, labor: 30, energy: 12, other: 13 },
        mainMaterial: '鋼材',
      },
    ],
    listPriceHistory: [
      { sku: 'DB-1001', price: 710, start: '2024-04-01', end: '2025-03-31' },
      { sku: 'DB-1001', price: 770, start: REVISION, end: null },
      { sku: 'KG-1001', price: 1000, start: '2024-04-01', end: '2025-03-31' },
      { sku: 'KG-1001', price: 1100, start: REVISION, end: null },
      { sku: 'DB-1002', price: 500, start: '2024-04-01', end: null },
    ],
    costHistory: [
      { sku: 'DB-1001', costSen: 29323, start: '2024-04-01', end: '2025-03-31' },
      { sku: 'DB-1001', costSen: 31141, start: REVISION, end: null },
    ],
    specials: [
      {
        cust: '000001',
        sku: 'DB-1002',
        skuKey: 'DB1002',
        rawSku: 'DB-1002',
        price: 330,
        start: '2024-04-01',
        end: '2025-03-31',
        reason: '大口継続',
      },
      {
        cust: '000002',
        sku: 'DB-1001',
        skuKey: 'DB1001',
        rawSku: 'DB-1001',
        price: 450,
        start: REVISION,
        end: null,
        reason: '契約更新',
      },
    ],
    revisions: [
      {
        date: REVISION,
        label: '令和7年4月1日 定価改定',
        agreements: [
          agreement('000001', '合意', REVISION),
          agreement('000002', '見送り', null),
          agreement('000003', '一部合意', REVISION, ['KG']),
          agreement('000004', '合意(適用日変更)', '2025-06-01'),
        ],
      },
    ],
    company: {
      name: '架空商事株式会社',
      business: '包装資材の卸売',
      address: '〒000-0000 架空県見本市中央1-2-3',
      tel: '000-000-0000',
      representative: '代表取締役 見本 太郎',
      branches: ['本社営業部'],
    },
  };
}

export function fixtureDataset(overrides: Partial<DatasetInput> = {}): Dataset {
  return new Dataset({ ...fixtureInput(), ...overrides });
}

let slip = 1000;

/** A sales line; unspecified fields get plausible values. `sku` is resolved by the dataset. */
export function line(
  p: Partial<SalesLine> & { cust: string; rawSku: string; date: string; unitPrice: number },
): SalesLine {
  slip++;
  const qty = p.qty ?? 10;
  return {
    id: `${slip}-1`,
    slip: String(slip),
    line: 1,
    isReturn: false,
    custName: '',
    skuKey: codeKey(p.rawSku),
    sku: null,
    itemName: '',
    qty,
    unit: 'ケース',
    printedListPrice: null,
    amount: p.unitPrice * qty,
    costSen: null,
    priceType: '標準',
    remark: '',
    branch: '本社営業部',
    sourceRow: 2,
    ...p,
  };
}
