import { describe, expect, it } from 'vitest';
import { encodeShiftJis, encodeUtf8 } from './encoding.ts';
import { classifyAgreement, importFile, LayoutNotRecognisedError } from './importers.ts';
import { layoutById } from './layouts.ts';
import type { SalesLine } from './types.ts';

const SALES_A = [
  '"売上日","伝票番号","行","取引区分","部門","得意先コード","得意先名","商品コード","商品名","数量","単位","定価","掛率(%)","単価","金額","原単価","原価金額","粗利額","単価区分","備考"',
  '"R07/05/12","1000001","1","売上","大阪営業所","００１００１","株式会社アルス運送","ＤＢ１００１","段ボール箱　Ａ式　２００×１５０×１００ｍｍ","50","ケース","770","72.0","554","27,700","311.41","15,571","12,129","得意先","数量値引３％"',
  '"R07/05/12","1000001","2","返品","大阪営業所","００１００１","株式会社アルス運送","ＫＧー１００１","両口スパナ　１０×１２ｍｍ","-2","個","1,100","72.0","792","-1,584","600.00","-1,200","-384","手入力",""',
].join('\r\n');

const SALES_B = [
  '伝票日付,伝票No,明細No,得意先CD,得意先略称,品番,品名,売上区分,数量,単位,標準価格,掛率,売単価,売上金額,原価単価,原価金額,単価種別,摘要',
  '20250512,1000001,1,1001,(株)ｱﾙｽ運送,db-1001 ,段ﾎﾞｰﾙ箱 A式 200×150×100mm,1,50,ｹｰｽ,770,0.720,554,27700,311.41,15571,1,数量値引3%',
  '20250512,1000001,2,1001,(株)ｱﾙｽ運送,KG1001,両口ｽﾊﾟﾅ 10×12mm,2,-2,個,1100,0.720,792,-1584,600.00,-1200,9,',
].join('\n');

function sales(name: string, data: string | Uint8Array): SalesLine[] {
  const imp = importFile(name, data);
  if (imp.data.kind !== 'sales') throw new Error(`expected sales, got ${imp.data.kind}`);
  expect(imp.data.result.issues).toEqual([]);
  return imp.data.result.records;
}

const comparable = (l: SalesLine) => ({
  id: l.id,
  date: l.date,
  isReturn: l.isReturn,
  cust: l.cust,
  skuKey: l.skuKey,
  itemName: l.itemName,
  qty: l.qty,
  unit: l.unit,
  printedListPrice: l.printedListPrice,
  unitPrice: l.unitPrice,
  amount: l.amount,
  costSen: l.costSen,
  priceType: l.priceType,
  remark: l.remark,
});

describe('sales import', () => {
  it('normalises layout A and layout B to the same records', () => {
    const a = sales('a.csv', encodeUtf8(SALES_A, true));
    const b = sales('b.csv', SALES_B);
    expect(a.map(comparable)).toEqual(b.map(comparable));
    expect(a[0]).toMatchObject({
      id: '1000001-1',
      date: '2025-05-12',
      cust: '001001',
      skuKey: 'DB1001',
      rawSku: 'ＤＢ１００１',
      itemName: '段ボール箱 A式 200×150×100mm',
      amount: 27700,
      costSen: 31141,
      priceType: '得意先',
      remark: '数量値引3%',
      branch: '大阪営業所',
      sourceRow: 2,
    });
    expect(a[1]).toMatchObject({ isReturn: true, qty: -2, priceType: '手入力', skuKey: 'KG1001' });
  });

  it('reads a Shift_JIS export', () => {
    const b = sales('b-sjis.csv', encodeShiftJis(SALES_B));
    expect(b.map(comparable)).toEqual(sales('b.csv', SALES_B).map(comparable));
  });

  it('reports bad rows and keeps the good ones', () => {
    const text = [
      '伝票日付,伝票No,明細No,得意先CD,品番,数量,売単価',
      '20250230,1,1,1001,DB-1001,5,554',
      '20250301,2,1,1001,DB-1001,五,554',
      '20250301,3,1,1001,DB-1001,5',
      '20250301,4,1,1001,DB-1001,5,554',
    ].join('\n');
    const imp = importFile('bad.csv', text);
    if (imp.data.kind !== 'sales') throw new Error('kind');
    expect(imp.data.result.records.map((r) => r.id)).toEqual(['4-1']);
    expect(imp.data.result.issues.map((i) => [i.row, i.field])).toEqual([
      [2, 'date'],
      [3, 'qty'],
      [4, '*'],
    ]);
  });
});

describe('other files', () => {
  it('reads 特値 in both layouts, with open end dates', () => {
    const a = importFile(
      'sa.csv',
      '"得意先コード","得意先名","商品コード","商品名","特値単価","開始日","終了日","登録理由"\r\n"００１００４","株式会社十和運輸","ＫＳ－１１６９","発泡スチロール箱","2,092","令和7年4月1日","","契約更新"\r\n',
    );
    const b = importFile(
      'sb.csv',
      '得意先CD,品番,特価,有効開始日,有効終了日,摘要\n1004,KS-1169,2092,20250401,99991231,契約更新\n',
    );
    if (a.data.kind !== 'specials' || b.data.kind !== 'specials') throw new Error('kind');
    const ra = a.data.result.records[0];
    const rb = b.data.result.records[0];
    expect(ra).toMatchObject({
      cust: '001004',
      skuKey: 'KS1169',
      price: 2092,
      start: '2025-04-01',
      end: null,
    });
    expect(rb).toMatchObject({
      cust: '001004',
      skuKey: 'KS1169',
      price: 2092,
      start: '2025-04-01',
      end: null,
    });
  });

  it('rejects a 特値 that ends before it starts', () => {
    const b = importFile(
      'sb.csv',
      '得意先CD,品番,特価,有効開始日,有効終了日,摘要\n1004,KS-1169,2092,20250401,20250301,x\n',
    );
    if (b.data.kind !== 'specials') throw new Error('kind');
    expect(b.data.result.records).toEqual([]);
    expect(b.data.result.issues[0]?.field).toBe('end');
  });

  it('reads the price master in both layouts', () => {
    const a = importFile(
      'pa.csv',
      '"得意先コード","得意先名","商品コード","商品名","適用開始日","新単価","現単価"\r\n"００１００１","株式会社アルス運送","ＢＴ－１０９８","木製パレット","R08/12/01","3,825","3,555"\r\n',
    );
    const b = importFile(
      'pb.csv',
      '得意先CD,品番,適用開始日,売単価,旧売単価\n1001,BT-1098,20261201,3825,3555\n',
    );
    if (a.data.kind !== 'priceMaster' || b.data.kind !== 'priceMaster') throw new Error('kind');
    const strip = (r: {
      cust: string;
      skuKey: string;
      effective: string;
      newPrice: number;
      currentPrice: number;
    }) => ({
      cust: r.cust,
      skuKey: r.skuKey,
      effective: r.effective,
      newPrice: r.newPrice,
      currentPrice: r.currentPrice,
    });
    expect(a.data.result.records.map(strip)).toEqual(b.data.result.records.map(strip));
  });

  it('reads customers, products and tiers', () => {
    const c = importFile(
      'c.csv',
      '得意先コード,得意先名,略称,取引先区分,掛率ランク,掛率(%),担当営業所,営業担当,都道府県,締日,宛先部署,取引開始日\n001001,株式会社アルス運送,(株)アルス運送,物流・倉庫,D,90.0,本社営業部,佐藤,神奈川県,20日,業務部,2012-04-17\n',
    );
    if (c.data.kind !== 'customers') throw new Error('kind');
    expect(c.data.result.records[0]).toMatchObject({
      code: '001001',
      rank: 'D',
      ratePm: 900,
      department: '業務部',
      since: '2012-04-17',
    });
    const p = importFile(
      'p.csv',
      '商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)\nDB-1001,段ボール箱,DB,ケース,770,311.41,S01,58,15,17,10\n',
    );
    if (p.data.kind !== 'products') throw new Error('kind');
    expect(p.data.result.records[0]).toMatchObject({
      code: 'DB-1001',
      key: 'DB1001',
      listPrice: 770,
      costSen: 31141,
      costShare: { material: 58 },
    });
    const t = importFile(
      't.csv',
      '掛率ランク,名称,標準掛率(%),下限(%),上限(%),説明\nS,代理店,58.0,60.0,56.0,逆\n',
    );
    if (t.data.kind !== 'rateTiers') throw new Error('kind');
    expect(t.data.result.records).toEqual([]);
    expect(t.data.result.issues).toHaveLength(1);
  });

  it('warns when a cost split does not add up to 100%', () => {
    const p = importFile(
      'p.csv',
      '商品コード,商品名,カテゴリコード,単位,定価(円),原単価(円),仕入先コード,原材料比率(%),労務費比率(%),エネルギー比率(%),その他比率(%)\nDB-1001,段ボール箱,DB,ケース,770,311.41,S01,50,15,17,10\n',
    );
    if (p.data.kind !== 'products') throw new Error('kind');
    expect(p.data.result.records).toHaveLength(1);
    expect(p.data.result.issues[0]?.message).toContain('100%');
  });

  it('classifies agreement statuses', () => {
    expect(classifyAgreement('合意')).toBe('agreed');
    expect(classifyAgreement('合意(適用日変更)')).toBe('agreed_later_date');
    expect(classifyAgreement('一部合意')).toBe('partial');
    expect(classifyAgreement('見送り')).toBe('declined');
    expect(classifyAgreement('協議中')).toBe('negotiating');
    expect(classifyAgreement('対象外(改定後に取引開始)')).toBe('not_applicable');
    expect(classifyAgreement('')).toBe('unknown');
    expect(classifyAgreement('保留中')).toBe('negotiating');
    expect(classifyAgreement('なんとも')).toBe('unknown');
  });

  it('imports with an explicit layout and manual column names', () => {
    const text = '日付,伝票No,明細No,得意先CD,品番,数量,売単価\n20250301,4,1,1001,DB-1001,5,554\n';
    expect(() => importFile('x.csv', text)).toThrow(LayoutNotRecognisedError);
    const imp = importFile('x.csv', text, { spec: layoutById('sales-B'), columnOverrides: { date: '日付' } });
    if (imp.data.kind !== 'sales') throw new Error('kind');
    expect(imp.data.result.records[0]?.date).toBe('2025-03-01');
    expect(() => importFile('x.csv', text, { spec: layoutById('sales-B') })).toThrow(/必要な列/);
  });
});
