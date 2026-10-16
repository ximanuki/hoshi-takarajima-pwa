/**
 * 値上げのお願い（申入書）: the data for one customer's letter.
 *
 * The letter is formal Japanese (拝啓〜敬具, 記〜以上) with 和暦 dates, a table of the
 * customer's own items (current and new unit price), and an evidence section of
 * public statistics. It does not show the company's internal cost breakdown:
 * the evidence is public data, as the JFTC guideline on 労務費の転嫁 suggests.
 * The UI renders and prints this structure; the engine only builds it.
 */

import type { Dataset } from './dataset.ts';
import { type IsoDate, toWareki } from './dates.ts';
import { EVIDENCE_TOPIC_JA, type EvidenceItem, type EvidenceTopic } from './evidence.ts';
import { changeBp } from './money.ts';
import type { PairProposal } from './proposal.ts';
import { formatBp, formatYen, withCommas } from './text.ts';
import type { Company } from './types.ts';

export type EffectiveBasis = '出荷分' | '受注分' | '納品分';

export interface LetterOptions {
  issueDate: IsoDate;
  effectiveDate: IsoDate;
  basis: EffectiveBasis;
  replyBy?: IsoDate;
  contact?: { branch: string; person: string; tel?: string };
  title?: string;
  documentNo?: string;
}

export interface LetterItemRow {
  sku: string;
  name: string;
  unit: string;
  currentPrice: number;
  newPrice: number;
  changeYen: number;
  changeBp: number;
  currentPriceText: string;
  newPriceText: string;
  changeText: string;
  rateText: string;
}

export interface LetterData {
  customerCode: string;
  title: string;
  documentNo: string | null;
  issueDate: IsoDate;
  issueDateText: string;
  effectiveDate: IsoDate;
  effectiveDateText: string;
  addressee: { company: string; department: string; honorific: '御中' };
  sender: { company: string; representative: string; address: string; tel: string };
  salutation: '拝啓';
  body: string[];
  complimentaryClose: '敬具';
  /** 記 */
  record: { label: string; value: string }[];
  items: LetterItemRow[];
  itemsTitle: string;
  itemsNotes: string[];
  /** quantity-weighted average increase over the listed items (bp) */
  averageChangeBp: number;
  evidence: {
    heading: string;
    intro: string;
    items: EvidenceItem[];
    sources: string[];
    disclaimer: string[];
  };
}

export class EmptyLetterError extends Error {
  constructor(cust: string) {
    super(`得意先 ${cust} には値上げの対象品目がありません`);
    this.name = 'EmptyLetterError';
  }
}

function causeText(topics: Set<EvidenceTopic>): string {
  const order: EvidenceTopic[] = ['material', 'energy', 'logistics', 'labor'];
  const names = order.filter((t) => topics.has(t)).map((t) => EVIDENCE_TOPIC_JA[t]);
  if (names.length === 0) return '諸経費';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join('、')}や${names[names.length - 1]}`;
}

/**
 * Build the letter for one customer from their proposed pairs (status 'proposed').
 * Throws EmptyLetterError when the customer has no proposed item.
 */
export function buildLetter(
  ds: Dataset,
  cust: string,
  pairs: readonly PairProposal[],
  evidence: readonly EvidenceItem[],
  company: Company,
  options: LetterOptions,
): LetterData {
  const customer = ds.customers.get(cust);
  if (!customer) throw new RangeError(`得意先 ${cust} が得意先マスタにありません`);
  const mine = pairs.filter((p) => p.cust === cust && p.status === 'proposed').sort((a, b) => (a.sku < b.sku ? -1 : 1));
  if (mine.length === 0) throw new EmptyLetterError(cust);

  const items: LetterItemRow[] = mine.map((p) => {
    const product = ds.products.get(p.sku);
    return {
      sku: p.sku,
      name: product?.name ?? p.sku,
      unit: product?.unit ?? '',
      currentPrice: p.currentPrice,
      newPrice: p.newPrice,
      changeYen: p.changeYen,
      changeBp: p.changeBp,
      currentPriceText: withCommas(p.currentPrice),
      newPriceText: withCommas(p.newPrice),
      changeText: `+${withCommas(p.changeYen)}`,
      rateText: `+${formatBp(p.changeBp)}`,
    };
  });
  let before = 0;
  let after = 0;
  for (const p of mine) {
    before += p.currentPrice * p.qty;
    after += p.newPrice * p.qty;
  }
  const averageChangeBp = before > 0 ? changeBp(after, before) : 0;
  const minBp = Math.min(...mine.map((p) => p.changeBp));
  const maxBp = Math.max(...mine.map((p) => p.changeBp));

  const effectiveText = toWareki(options.effectiveDate);
  const topics = new Set(evidence.map((e) => e.topic));
  const body = [
    '時下ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。',
    `さて、弊社では、${causeText(topics)}の上昇に対し、業務の効率化や経費の削減に努め、価格の維持に取り組んでまいりました。しかしながら、これらの上昇は弊社の努力だけでは吸収しきれない状況となっております。`,
    `つきましては、誠に心苦しいお願いではございますが、${effectiveText}${options.basis}より、別紙のとおり価格を改定させていただきたく、お願い申し上げます。`,
    evidence.length > 0
      ? '価格改定の背景として、公表されている統計を参考資料として添付いたしました。ご不明な点やご意見がございましたら、ご遠慮なくお申し付けください。協議の機会を設けていただけましたら幸いです。'
      : 'ご不明な点やご意見がございましたら、ご遠慮なくお申し付けください。協議の機会を設けていただけましたら幸いです。',
  ];
  if (options.replyBy) body.push(`誠に恐縮ではございますが、${toWareki(options.replyBy)}までにご回答をいただけましたら幸いです。`);
  body.push('何卒事情をご賢察のうえ、ご理解を賜りますよう、よろしくお願い申し上げます。');

  const record = [
    { label: '改定内容', value: `別紙「価格改定対象品目一覧」のとおり（${items.length}品目）` },
    { label: '改定日', value: `${effectiveText}${options.basis}より` },
    {
      label: '改定率',
      value: minBp === maxBp ? formatBp(minBp) : `平均 ${formatBp(averageChangeBp)}（品目により ${formatBp(minBp)}〜${formatBp(maxBp)}）`,
    },
  ];
  if (options.contact) {
    const c = options.contact;
    record.push({ label: 'お問い合わせ先', value: `${c.branch} ${c.person}${c.tel ? `（TEL ${c.tel}）` : ''}` });
  }

  const sources = [...new Set(evidence.map((e) => e.source.credit))];
  return {
    customerCode: cust,
    title: options.title ?? '価格改定のお願い',
    documentNo: options.documentNo ?? null,
    issueDate: options.issueDate,
    issueDateText: toWareki(options.issueDate),
    effectiveDate: options.effectiveDate,
    effectiveDateText: effectiveText,
    addressee: { company: customer.name, department: customer.department, honorific: '御中' },
    sender: { company: company.name, representative: company.representative, address: company.address, tel: company.tel },
    salutation: '拝啓',
    body,
    complimentaryClose: '敬具',
    record,
    items,
    itemsTitle: '価格改定対象品目一覧',
    itemsNotes: ['価格は税抜です。', '単価は表示の単位あたりの価格です（円）。', `改定率は現行単価に対する率です。合計欄の平均は直近12か月のご購入数量で加重しています（${formatYen(before)} → ${formatYen(after)}）。`],
    averageChangeBp,
    evidence: {
      heading: '参考資料（公表統計）',
      intro: '原材料・エネルギー・物流・人件費の動向を示す公表統計です。業界や地域全体の動きを示すもので、個々の取引条件をそのまま表すものではありません。',
      items: [...evidence],
      sources,
      disclaimer: [
        '「本ツールで計算」とある変化率は、公表値から計算したものです。',
        '統計の最新月は速報値で、後に改定されることがあります。',
      ],
    },
  };
}
