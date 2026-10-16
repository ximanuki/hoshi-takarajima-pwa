import { describe, expect, it } from 'vitest';
import { detectLayout, LAYOUTS, layoutById, mapColumns, normalizeHeader } from './layouts.ts';

const SALES_A =
  '売上日,伝票番号,行,取引区分,部門,得意先コード,得意先名,商品コード,商品名,数量,単位,定価,掛率(%),単価,金額,原単価,原価金額,粗利額,単価区分,備考'.split(
    ',',
  );
const SALES_B =
  '伝票日付,伝票No,明細No,得意先CD,得意先略称,品番,品名,売上区分,数量,単位,標準価格,掛率,売単価,売上金額,原価単価,原価金額,単価種別,摘要'.split(
    ',',
  );

describe('detectLayout', () => {
  it('tells the two sales layouts apart', () => {
    expect(detectLayout(SALES_A).best?.spec.id).toBe('sales-A');
    expect(detectLayout(SALES_B).best?.spec.id).toBe('sales-B');
  });

  it('recognises 特値・単価マスタ in both layouts and the masters', () => {
    const cases: [string, string][] = [
      ['得意先コード,得意先名,商品コード,商品名,特値単価,開始日,終了日,登録理由', 'specials-A'],
      ['得意先CD,品番,特価,有効開始日,有効終了日,摘要', 'specials-B'],
      ['得意先コード,得意先名,商品コード,商品名,適用開始日,新単価,現単価', 'priceMaster-A'],
      ['得意先CD,品番,適用開始日,売単価,旧売単価', 'priceMaster-B'],
      [
        '得意先コード,得意先名,略称,取引先区分,掛率ランク,掛率(%),担当営業所,営業担当,都道府県,締日,宛先部署,取引開始日',
        'customers',
      ],
      [
        '商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)',
        'products',
      ],
      ['掛率ランク,名称,標準掛率(%),下限(%),上限(%),説明', 'rateTiers'],
      [
        'カテゴリコード,カテゴリ名,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%),主な原材料',
        'categories',
      ],
      ['仕入先コード,仕入先名,主な取扱カテゴリ', 'suppliers'],
      ['商品コード,定価(円),適用開始日,適用終了日', 'listPriceHistory'],
      ['商品コード,原単価(円),適用開始日,適用終了日', 'costHistory'],
      ['得意先コード,得意先名,申入日,回答日,合意状況,適用日,対象外カテゴリ,備考', 'agreements'],
      ['得意先コード,得意先名,協議結果,適用日,対象外カテゴリ,備考', 'agreements'],
      [
        '通知日,仕入先コード,仕入先名,商品コード,商品名,現行仕入単価(円),改定後仕入単価(円),改定率(%),適用日,主な理由,状態',
        'supplierNotices',
      ],
      ['商品コード,商品名,現定価(円),新定価(円),適用日', 'newListPrices'],
    ];
    for (const [header, id] of cases) expect(detectLayout(header.split(',')).best?.spec.id, header).toBe(id);
  });

  it('accepts 全角 brackets and spaces in headers', () => {
    const header = SALES_A.map((h) => (h === '掛率(%)' ? '掛率（％）' : h === '売上日' ? '売上日 ' : h));
    expect(detectLayout(header).best?.spec.id).toBe('sales-A');
    expect(normalizeHeader('掛率（％）')).toBe('掛率(%)');
  });

  it('returns null for an unknown header and can be limited to kinds', () => {
    expect(detectLayout(['日付', '金額']).best).toBeNull();
    expect(detectLayout(SALES_A, ['specials']).best).toBeNull();
  });
});

describe('mapColumns', () => {
  it('maps fields to column indexes and reports missing required columns', () => {
    const spec = layoutById('sales-B');
    const m = mapColumns(SALES_B, spec);
    expect(m.mapping['date']).toBe(0);
    expect(m.mapping['unitPrice']).toBe(12);
    expect(m.missingRequired).toEqual([]);
    const partial = mapColumns(['伝票日付', '品番'], spec);
    expect(partial.missingRequired).toContain('unitPrice');
  });

  it('takes manual header names for a field', () => {
    const header = SALES_B.map((h) => (h === '売単価' ? '単価(税抜)' : h));
    const spec = layoutById('sales-B');
    expect(mapColumns(header, spec).missingRequired).toEqual(['unitPrice']);
    expect(mapColumns(header, spec, { unitPrice: '単価(税抜)' }).mapping['unitPrice']).toBe(12);
  });

  it('has unique layout ids', () => {
    expect(new Set(LAYOUTS.map((l) => l.id)).size).toBe(LAYOUTS.length);
    expect(() => layoutById('nope')).toThrow();
  });
});
