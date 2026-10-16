import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from './evidence.ts';
import { buildLetter, EmptyLetterError } from './letter.ts';
import type { PairProposal } from './proposal.ts';
import { fixtureDataset, fixtureInput } from './testing/fixtures.ts';

const ds = fixtureDataset();
const company = fixtureInput().company;
if (!company) throw new Error('fixture');

function proposal(
  sku: string,
  currentPrice: number,
  newPrice: number,
  qty: number,
  status: 'proposed' | 'excluded' = 'proposed',
): PairProposal {
  return {
    cust: '000001',
    sku,
    category: sku.slice(0, 2),
    status,
    excludedReason: status === 'excluded' ? 'special_price' : null,
    basis: 'list_rate',
    currentPrice,
    lastBilledPrice: currentPrice,
    ongoingLeak: null,
    systemPrice: currentPrice,
    newPrice,
    changeYen: newPrice - currentPrice,
    changeBp: Math.round(((newPrice - currentPrice) * 10000) / currentPrice),
    currentList: 0,
    newList: 0,
    ratePm: 720,
    costCurrentSen: 31141,
    costNewSen: 34022,
    marginCurrentBp: null,
    marginNoActionBp: null,
    marginNewBp: null,
    qty,
    salesYen: currentPrice * qty,
    guardrails: [],
  };
}

const evidence: EvidenceItem[] = [
  {
    id: 'cgpi:x',
    topic: 'material',
    title: '国内企業物価指数（パルプ・紙・同製品）',
    statement: '…',
    figures: [],
    computedByTool: true,
    source: {
      publisher: '日本銀行 調査統計局',
      title: '国内企業物価指数',
      url: 'https://example.invalid',
      retrievedAt: '',
      credit: '出典：日本銀行',
    },
    chart: null,
  },
  {
    id: 'minimum-wage',
    topic: 'labor',
    title: '地域別最低賃金',
    statement: '…',
    figures: [],
    computedByTool: false,
    source: {
      publisher: '厚生労働省',
      title: '地域別最低賃金',
      url: 'https://example.invalid',
      retrievedAt: '',
      credit: '出典：厚生労働省（加工して作成）',
    },
    chart: null,
  },
];

const pairs = [
  proposal('KG-1001', 792, 864, 10),
  proposal('DB-1001', 554, 612, 100),
  proposal('DB-1002', 330, 330, 5, 'excluded'),
];
const options = {
  issueDate: '2026-10-16',
  effectiveDate: '2026-12-01',
  basis: '出荷分' as const,
  replyBy: '2026-11-13',
  contact: { branch: '本社営業部', person: '佐藤', tel: '000-000-0000' },
};

describe('buildLetter', () => {
  const letter = buildLetter(ds, '000001', pairs, evidence, company, options);

  it('addresses the customer formally with 和暦 dates', () => {
    expect(letter.title).toBe('価格改定のお願い');
    expect(letter.issueDateText).toBe('令和8年10月16日');
    expect(letter.effectiveDateText).toBe('令和8年12月1日');
    expect(letter.addressee).toEqual({ company: '株式会社A商事', department: '購買部', honorific: '御中' });
    expect(letter.sender.company).toBe('架空商事株式会社');
    expect(letter.salutation).toBe('拝啓');
    expect(letter.complimentaryClose).toBe('敬具');
  });

  it('writes the body from the evidence topics and options', () => {
    const body = letter.body.join('\n');
    expect(body).toContain('原材料価格や人件費の上昇');
    expect(body).toContain('令和8年12月1日出荷分より、別紙のとおり価格を改定');
    expect(body).toContain('令和8年11月13日までにご回答');
    expect(body).toContain('参考資料として添付');
    expect(body).not.toMatch(/原単価|原価構成|AI|保証/);
  });

  it('lists only the proposed items, sorted, with formatted prices', () => {
    expect(letter.items.map((i) => i.sku)).toEqual(['DB-1001', 'KG-1001']);
    expect(letter.items[0]).toMatchObject({
      name: '段ボール箱 A式 200×150×100mm 10枚入',
      unit: 'ケース',
      currentPriceText: '554',
      newPriceText: '612',
      changeText: '+58',
      rateText: '+10.5%',
    });
  });

  it('summarises the change in the 記 section', () => {
    // (612×100 + 864×10) / (554×100 + 792×10) = 69,840 / 63,320 → +10.3%
    expect(letter.averageChangeBp).toBe(1030);
    expect(letter.record).toEqual([
      { label: '改定内容', value: '別紙「価格改定対象品目一覧」のとおり（2品目）' },
      { label: '改定日', value: '令和8年12月1日出荷分より' },
      { label: '改定率', value: '平均 10.3%（品目により 9.1%〜10.5%）' },
      { label: 'お問い合わせ先', value: '本社営業部 佐藤（TEL 000-000-0000）' },
    ]);
  });

  it('carries the evidence with its credit lines', () => {
    expect(letter.evidence.items).toHaveLength(2);
    expect(letter.evidence.sources).toEqual(['出典：日本銀行', '出典：厚生労働省（加工して作成）']);
    expect(letter.evidence.disclaimer.join('')).toContain('本ツールで計算');
  });

  it('refuses a customer with nothing to raise or unknown', () => {
    expect(() => buildLetter(ds, '000002', pairs, evidence, company, options)).toThrow(EmptyLetterError);
    expect(() => buildLetter(ds, '999999', pairs, evidence, company, options)).toThrow(RangeError);
  });

  it('works without evidence or a reply date', () => {
    const plain = buildLetter(ds, '000001', pairs, [], company, {
      issueDate: '2026-10-16',
      effectiveDate: '2026-12-01',
      basis: '納品分',
    });
    expect(plain.body.join('')).toContain('諸経費の上昇');
    expect(plain.body.join('')).not.toContain('ご回答をいただけましたら');
    expect(plain.record).toHaveLength(3);
  });
});
