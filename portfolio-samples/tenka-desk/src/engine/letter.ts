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
import { COMPUTED_LABEL, EVIDENCE_TOPIC_JA, type EvidenceItem, type EvidenceTopic } from './evidence.ts';
import { changeBp } from './money.ts';
import type { PairProposal } from './proposal.ts';
import { formatRatioPct, withCommas } from './text.ts';
import type { Company } from './types.ts';

export type EffectiveBasis = '出荷分' | '受注分' | '納品分';

/** Reasons for the increase the letter may name (from the cost scenario, not from the statistics). */
export type LetterCause = 'material' | 'purchase' | 'energy' | 'logistics' | 'labor' | 'other';

export const LETTER_CAUSE_JA: Record<LetterCause, string> = {
  material: '原材料価格',
  purchase: '仕入価格',
  energy: 'エネルギー価格',
  logistics: '物流費',
  labor: '人件費',
  other: '諸経費',
};

const CAUSE_ORDER: readonly LetterCause[] = ['material', 'purchase', 'energy', 'logistics', 'labor', 'other'];

/** Paragraphs of the body, in order; each can be replaced by the user's own text. */
export type LetterParagraphId = 'greeting' | 'reason' | 'request' | 'evidence' | 'reply' | 'closing';

export const LETTER_PARAGRAPH_JA: Record<LetterParagraphId, string> = {
  greeting: '前文（あいさつ）',
  reason: '値上げの理由と自社の取組み',
  request: 'お願い（改定日）',
  evidence: '参考資料・協議のお願い',
  reply: 'ご回答期限',
  closing: '結び',
};

export interface LetterOptions {
  issueDate: IsoDate;
  effectiveDate: IsoDate;
  basis: EffectiveBasis;
  replyBy?: IsoDate;
  contact?: { branch: string; person: string; tel?: string };
  title?: string;
  documentNo?: string;
  /**
   * The cost increases the company actually has (e.g. the non-zero components of
   * its cost scenario). Without them the reasons follow the evidence topics.
   */
  causes?: readonly LetterCause[];
  /** the user's own text for some paragraphs (a blank text keeps the generated one) */
  paragraphs?: Partial<Record<LetterParagraphId, string>>;
  /** label of figures computed from published values (default 「弊社算出」) */
  computedLabel?: string;
  /**
   * The 現行単価 is not final: an agreements file is loaded but not used, so a
   * customer who declined the last revision is shown the new price. The letter is
   * then marked 仮 (`provisional`) and shows no ※ご請求: the "billing error" may be
   * the customer's correct kept price.
   */
  provisional?: boolean;
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
  /**
   * The price the customer is invoiced now, when an ongoing billing error keeps it
   * below the 現行単価 shown (null otherwise), so the letter does not quietly state a
   * price their invoices do not show.
   */
  billedPrice: number | null;
  billedPriceText: string | null;
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
  /** the same paragraphs with their ids (body[i] is paragraphs[i].text) */
  paragraphs: { id: LetterParagraphId; text: string; edited: boolean }[];
  complimentaryClose: '敬具';
  /** 記 */
  record: { label: string; value: string }[];
  items: LetterItemRow[];
  itemsTitle: string;
  itemsNotes: string[];
  /** quantity-weighted average increase over the listed items (bp) */
  averageChangeBp: number;
  /** the 現行単価 may be wrong (LetterOptions.provisional): the UI prints a 仮 mark on every sheet */
  provisional: boolean;
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

function joinJa(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join('、')}や${names[names.length - 1]}`;
}

function causeText(causes: readonly LetterCause[] | undefined, topics: Set<EvidenceTopic>): string {
  if (causes !== undefined) {
    const names = CAUSE_ORDER.filter((c) => causes.includes(c)).map((c) => LETTER_CAUSE_JA[c]);
    return names.length > 0 ? joinJa(names) : '諸経費';
  }
  const order: EvidenceTopic[] = ['material', 'energy', 'logistics', 'labor'];
  const names = order.filter((t) => topics.has(t)).map((t) => EVIDENCE_TOPIC_JA[t]);
  return names.length > 0 ? joinJa(names) : '諸経費';
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
  const mine = pairs
    .filter((p) => p.cust === cust && p.status === 'proposed')
    .sort((a, b) => (a.sku < b.sku ? -1 : 1));
  if (mine.length === 0) throw new EmptyLetterError(cust);

  const provisional = options.provisional === true;
  const items: LetterItemRow[] = mine.map((p) => {
    const product = ds.products.get(p.sku);
    const billed = !provisional && p.ongoingLeak !== null && p.systemPrice < p.currentPrice;
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
      rateText: `+${formatRatioPct(p.changeYen, p.currentPrice)}`,
      billedPrice: billed ? p.systemPrice : null,
      billedPriceText: billed ? withCommas(p.systemPrice) : null,
    };
  });
  let before = 0;
  let after = 0;
  for (const p of mine) {
    before += p.currentPrice * p.qty;
    after += p.newPrice * p.qty;
  }
  const averageChangeBp = before > 0 ? changeBp(after, before) : 0;
  // compare the exact ratios changeYen / currentPrice (no rounding)
  const less = (a: PairProposal, b: PairProposal) =>
    a.changeYen * b.currentPrice < b.changeYen * a.currentPrice;
  const lowest = mine.reduce((m, p) => (less(p, m) ? p : m));
  const highest = mine.reduce((m, p) => (less(m, p) ? p : m));
  const pctOf = (p: PairProposal) => formatRatioPct(p.changeYen, p.currentPrice);

  const effectiveText = toWareki(options.effectiveDate);
  const topics = new Set(evidence.map((e) => e.topic));
  const ask = options.contact
    ? 'ご不明な点やご意見がございましたら、下記担当までお問い合わせください。'
    : 'ご不明な点やご意見がございましたら、ご遠慮なくお申し付けください。';
  const generated: [LetterParagraphId, string][] = [
    [
      'greeting',
      '時下ますますご清栄のこととお慶び申し上げます。平素は格別のお引き立てを賜り、厚く御礼申し上げます。',
    ],
    [
      'reason',
      `さて、弊社では、${causeText(options.causes, topics)}の上昇に対し、業務の効率化や経費の削減に努め、価格の維持に取り組んでまいりました。しかしながら、これらの上昇は弊社の努力だけでは吸収しきれない状況となっております。`,
    ],
    [
      'request',
      `つきましては、誠に心苦しいお願いではございますが、${effectiveText}${options.basis}より、別紙のとおり価格を改定させていただきたく、お願い申し上げます。`,
    ],
    [
      'evidence',
      evidence.length > 0
        ? `価格改定の背景を示す公表統計を、参考資料として添付いたしました。${ask}協議の機会を設けていただけましたら幸いです。`
        : `${ask}協議の機会を設けていただけましたら幸いです。`,
    ],
  ];
  if (options.replyBy)
    generated.push([
      'reply',
      `誠に恐縮ではございますが、${toWareki(options.replyBy)}までにご回答を賜りますようお願い申し上げます。`,
    ]);
  generated.push(['closing', '何卒事情をご賢察のうえ、ご理解を賜りますよう、よろしくお願い申し上げます。']);
  const paragraphs = generated.map(([id, text]) => {
    const own = options.paragraphs?.[id]?.trim();
    return own ? { id, text: own, edited: true } : { id, text, edited: false };
  });
  const body = paragraphs.map((p) => p.text);
  const label = options.computedLabel ?? COMPUTED_LABEL;
  const shownTopics = (['material', 'energy', 'logistics', 'labor', 'general'] as const).filter((t) =>
    topics.has(t),
  );

  const record = [
    { label: '改定内容', value: `別紙「価格改定対象品目一覧」のとおり（${items.length}品目）` },
    { label: '改定日', value: `${effectiveText}${options.basis}より` },
    {
      label: '改定率',
      value:
        pctOf(lowest) === pctOf(highest)
          ? pctOf(lowest)
          : `平均 ${formatRatioPct(after - before, before)}（品目により ${pctOf(lowest)}〜${pctOf(highest)}）`,
    },
  ];
  if (options.contact) {
    const c = options.contact;
    record.push({
      label: 'お問い合わせ先',
      value: `${c.branch} ${c.person}${c.tel ? `（TEL ${c.tel}）` : ''}`,
    });
  }

  const sources = [...new Set(evidence.map((e) => e.source.credit))];
  const billedItems = items.filter((i) => i.billedPrice !== null).length;
  return {
    customerCode: cust,
    title: options.title ?? '価格改定のお願い',
    documentNo: options.documentNo ?? null,
    issueDate: options.issueDate,
    issueDateText: toWareki(options.issueDate),
    effectiveDate: options.effectiveDate,
    effectiveDateText: effectiveText,
    addressee: { company: customer.name, department: customer.department, honorific: '御中' },
    sender: {
      company: company.name,
      representative: company.representative,
      address: company.address,
      tel: company.tel,
    },
    salutation: '拝啓',
    body,
    paragraphs,
    complimentaryClose: '敬具',
    record,
    items,
    itemsTitle: '価格改定対象品目一覧',
    itemsNotes: [
      '価格は税抜です。',
      '単価は表示の単位あたりの価格です（円）。',
      '改定率は現行単価に対する率です。記の平均は、直近12か月のご購入数量で加重した平均です。',
      ...(billedItems > 0
        ? [
            '※印の品目は、現在のご請求単価（※の後に記載）が、お取り決めの現行単価と異なっております。この点は担当者よりあらためてご説明いたします。',
          ]
        : []),
    ],
    averageChangeBp,
    provisional,
    evidence: {
      heading: '参考資料（公表統計）',
      intro: `${shownTopics.map((t) => EVIDENCE_TOPIC_JA[t]).join('・')}の動向を示す公表統計です。業界や地域全体の動きを示すもので、個々の取引条件をそのまま表すものではありません。`,
      items: [...evidence],
      sources,
      disclaimer: [
        ...(evidence.some((e) => e.computedByTool)
          ? [`「${label}」とある数値は、公表値をもとに弊社で計算したものです。`]
          : []),
        '統計の最新月は速報値で、後に改定されることがあります。',
      ],
    },
  };
}
