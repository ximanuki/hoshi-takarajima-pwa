/**
 * A tiny fictional (架空) data set whose 定価の履歴 holds two 定価改定, so the app
 * cannot tell from the history alone which revision the agreements file answers.
 * Small enough to check every number by hand.
 *
 * 12 products DB-2001…DB-2012: 定価 1,000 → 1,100円 (2025-04-01) → 1,200円 (2025-10-01).
 * Rank B (標準 72%, range 70–75%). The agreements file answers the 2025-10-01 revision:
 *   000001 甲見本商事（架空）  合意 (適用日 blank unless `agreedEffective` is given)
 *   000002 乙見本工業（架空）  見送り
 * Sales (販売管理B形式), 2025-11-10/11:
 *   1-1 000001 DB-2001 10 × 864  correct (1,200 × 72%)
 *   1-2 000001 DB-2003 10 × 792  反映漏れ: still 1,100 × 72% (shortfall 720円)
 *   1-3 000001 DB-2004  2 × 0    「販促品(無償提供)」: free goods, 2,400円 at 定価
 *   2-1 000002 DB-2001 10 × 792  correct for the declined customer (1,100 × 72%)
 *   2-2 000002 DB-2002  5 × 792  correct for the declined customer
 * With the agreements file used, the leak total is 720円; without it, 1,800円
 * (the declined customer's two lines also look like 反映漏れ).
 *
 * `extraSales` appends lines, e.g. DECLINED_VOLUME_DISCOUNT_LINE: the declined
 * customer's correct 数量値引3% from its kept price (1,100 × 72% = 792 → 768),
 * which is 掛率ランク外 (960円) only while the agreements file is not used.
 */

import { addDays } from '../dates.ts';

export interface TwoRevisionOptions {
  /** name of the agreements file (default agreements.csv) */
  agreementsName?: string;
  /** 適用日 of the agreed customer 000001 (default blank) */
  agreedEffective?: string;
  /** data rows of the agreements file in place of the default two */
  agreementRows?: readonly string[];
  /** 定価 steps [price, start] of every product (default 1,000 → 1,100 → 1,200) */
  listSteps?: readonly (readonly [number, string])[];
  /** sales lines (販売管理B形式) appended to the default five */
  extraSales?: readonly string[];
}

/** 000002 (見送り) buys DB-2005 at its kept price less the 数量値引3% in the remark: correct. */
export const DECLINED_VOLUME_DISCOUNT_LINE = '20251112,3,1,2,DB-2005,10,768,数量値引3%';

export interface FixtureFile {
  name: string;
  text: string;
}

export const TWO_REVISION_SKUS = Array.from(
  { length: 12 },
  (_, i) => `DB-20${String(i + 1).padStart(2, '0')}`,
);

const DEFAULT_STEPS: readonly (readonly [number, string])[] = [
  [1000, '2024-04-01'],
  [1100, '2025-04-01'],
  [1200, '2025-10-01'],
];

export const AGREEMENTS_HEADER = '得意先コード,得意先名,申入日,回答日,合意状況,適用日,対象外カテゴリ,備考';

function historyRows(sku: string, steps: readonly (readonly [number, string])[]): string[] {
  return steps.map(([price, start], i) => {
    const next = steps[i + 1];
    return `${sku},${price},${start},${next ? addDays(next[1], -1) : ''}`;
  });
}

export function twoRevisionFiles(options: TwoRevisionOptions = {}): FixtureFile[] {
  const name = options.agreementsName ?? 'agreements.csv';
  const steps = options.listSteps ?? DEFAULT_STEPS;
  const agreementRows = options.agreementRows ?? [
    `000001,株式会社甲見本商事（架空）,2025-07-01,2025-08-01,合意,${options.agreedEffective ?? ''},,`,
    '000002,乙見本工業株式会社（架空）,2025-07-01,2025-08-01,見送り,,,',
  ];
  return [
    {
      name: 'rate_tiers.csv',
      text: '掛率ランク,名称,標準掛率(%),下限(%),上限(%),説明\nB,一般,72.0,70.0,75.0,\n',
    },
    {
      name: 'customers.csv',
      text:
        '得意先コード,得意先名,略称,取引先区分,掛率ランク,掛率(%),担当営業所,営業担当,都道府県,締日,宛先部署,取引開始日\n' +
        '000001,株式会社甲見本商事（架空）,甲見本,製造業,B,72.0,本社営業部,佐藤,大阪府,末日,購買部,2015-04-01\n' +
        '000002,乙見本工業株式会社（架空）,乙見本,製造業,B,72.0,本社営業部,佐藤,大阪府,末日,購買部,2015-04-01\n',
    },
    {
      name: 'products.csv',
      text: `商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)\n${TWO_REVISION_SKUS.map((s) => `${s},見本の箱 ${s},DB,ケース,${steps[steps.length - 1]?.[0] ?? 0},600.00,S01,55,15,15,15`).join('\n')}\n`,
    },
    {
      name: 'list_price_history.csv',
      text: `商品コード,定価(円),適用開始日,適用終了日\n${TWO_REVISION_SKUS.flatMap((s) => historyRows(s, steps)).join('\n')}\n`,
    },
    { name, text: `${[AGREEMENTS_HEADER, ...agreementRows].join('\n')}\n` },
    {
      name: 'sales.csv',
      text:
        '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価,摘要\n' +
        '20251110,1,1,1,DB-2001,10,864,\n' +
        '20251110,1,2,1,DB-2003,10,792,\n' +
        '20251110,1,3,1,DB-2004,2,0,販促品(無償提供)\n' +
        '20251111,2,1,2,DB-2001,10,792,\n' +
        '20251111,2,2,2,DB-2002,5,792,\n' +
        (options.extraSales ?? []).map((l) => `${l}\n`).join(''),
    },
  ];
}
