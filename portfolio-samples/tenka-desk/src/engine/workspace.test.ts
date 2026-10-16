import { describe, expect, it } from 'vitest';
import { encodeShiftJis } from './encoding.ts';
import { companyFromJson, loadWorkspace, settingsFromJson } from './workspace.ts';

const files = {
  customers:
    '得意先コード,得意先名,略称,取引先区分,掛率ランク,掛率(%),担当営業所,営業担当,都道府県,締日,宛先部署,取引開始日\n000001,株式会社A商事,(株)A商事,製造業,B,72.0,本社営業部,佐藤,大阪府,末日,購買部,2015-04-01\n',
  products:
    '商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)\nDB-1001,段ボール箱,DB,ケース,770,311.41,S01,,,,\n',
  categories:
    'カテゴリコード,カテゴリ名,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%),主な原材料\nDB,段ボール・紙器,55,15,15,15,段ボール原紙\n',
  tiers: '掛率ランク,名称,標準掛率(%),下限(%),上限(%),説明\nB,一般,72.0,70.0,75.0,\n',
  history: `商品コード,定価(円),適用開始日,適用終了日\n${Array.from({ length: 12 }, (_, i) => `DB-10${String(i).padStart(2, '0')},700,2024-04-01,2025-03-31\nDB-10${String(i).padStart(2, '0')},770,2025-04-01,`).join('\n')}\n`,
  agreements:
    '得意先コード,得意先名,申入日,回答日,合意状況,適用日,対象外カテゴリ,備考\n000001,株式会社A商事,2025-01-15,2025-02-20,見送り,,,\n',
  sales: '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価\n20250501,1,1,1,db1001,5,504\n',
};

describe('loadWorkspace', () => {
  it('detects every file, assigns the agreements to the 定価改定 found in the history, and resolves codes', () => {
    const ws = loadWorkspace([
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: encodeShiftJis(files.products) },
      { name: 'categories.csv', data: files.categories },
      { name: 'tiers.csv', data: files.tiers },
      { name: 'history.csv', data: files.history },
      { name: 'agreements.csv', data: files.agreements },
      { name: 'sales.csv', data: files.sales },
    ]);
    expect(ws.files.map((f) => f.spec.id)).toEqual([
      'customers',
      'products',
      'categories',
      'rateTiers',
      'listPriceHistory',
      'agreements',
      'sales-B',
    ]);
    expect(ws.files[1]?.decoded.encoding).toBe('shift_jis');
    expect(ws.dataset.revisions.map((r) => r.date)).toEqual(['2025-04-01']);
    expect(ws.notes[0]).toContain('令和7年4月1日');
    expect(ws.sales.get('sales.csv')?.[0]?.sku).toBe('DB-1001');
    // the product has no cost split of its own: the category's is used
    expect(ws.dataset.costShareOf('DB-1001')).toEqual({ material: 55, labor: 15, energy: 15, other: 15 });
    // 見送り: the old 定価 still applies
    expect(ws.dataset.expectedPrice('000001', 'DB-1001', '2025-05-01')?.price).toBe(504);
    // the history mentions products that are not in the master
    expect(ws.dataset.issues.some((i) => i.kind === 'unknown_product')).toBe(true);
  });

  it('leaves an agreements file out when its revision is unclear, unless a date is given', () => {
    const inputs = [
      { name: 'customers.csv', data: files.customers },
      { name: 'products.csv', data: files.products },
      { name: 'tiers.csv', data: files.tiers },
      { name: 'a1.csv', data: files.agreements },
      { name: 'a2.csv', data: files.agreements },
    ];
    const ws = loadWorkspace(inputs);
    expect(ws.dataset.revisions).toEqual([]);
    expect(ws.notes.filter((n) => n.includes('改定日を指定'))).toHaveLength(2);
    const ws2 = loadWorkspace(inputs, { revisionDates: { 'a1.csv': '2025-04-01' } });
    expect(ws2.dataset.revisions.map((r) => r.date)).toEqual(['2025-04-01']);
  });

  it('collects import problems by file', () => {
    const ws = loadWorkspace([
      {
        name: 'sales.csv',
        data: '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価\n2025xx01,1,1,1,DB-1001,5,504\n',
      },
    ]);
    expect(ws.importIssues).toHaveLength(1);
    expect(ws.importIssues[0]?.file).toBe('sales.csv');
  });
});

describe('settings and company', () => {
  it('reads demo_settings.json', () => {
    const s = settingsFromJson({
      marginFloorPct: 12.5,
      unitPriceRounding: 'round',
      listPriceRounding: { below1000: 10, below10000: 50, otherwise: 100 },
    });
    expect(s.marginFloorBp).toBe(1250);
    expect(s.unitRounding).toBe('round');
    expect(s.listRounding?.bands[1]).toEqual({ below: 10000, unit: 50 });
    expect(settingsFromJson(null)).toEqual({});
    expect(settingsFromJson({ unitPriceRounding: 'banker' })).toEqual({});
  });

  it('reads company.json', () => {
    expect(companyFromJson({ name: '架空商事株式会社', branches: ['本社営業部', 3] })).toMatchObject({
      name: '架空商事株式会社',
      branches: ['本社営業部'],
      tel: '',
    });
    expect(companyFromJson('x').name).toBe('');
  });
});
