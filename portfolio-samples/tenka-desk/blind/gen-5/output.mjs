// ファイルの書き出し（入力データと正解）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES, SUPPLIERS, TIERS } from './catalog.mjs';
import { D, FLOOR_PCT } from './model.mjs';
import { comma, csv, d, divRound, encodeSjis, excelDate, iso, makeRng, senStr, slash, utf8Bom, warekiLong, warekiShort, zen } from './util.mjs';

const SAMPLE_RE = /見本|サンプル|無償|試供/;
const HDR_A = ['売上日', '伝票番号', '行', '取引区分', '部門', '得意先コード', '得意先名', '商品コード', '商品名', '数量', '単位', '定価', '掛率(%)', '単価', '金額', '原単価', '原価金額', '粗利額', '単価区分', '備考'];
const NONPROD = { 'Z-001': ['運賃', '式'], 'Z-002': ['代引手数料', '式'], 'Z-009': ['出精値引', '式'] };

export function writeAll(W) {
  const { DATA, SEALED, M, products, customers, specials, slips, fuSlips, master, intent, ROLE, F1, F2 } = W;
  const rq = makeRng(0x5a08);
  const files = [];
  const write = (rel, buf, enc, rows) => {
    const full = path.join(DATA, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    files.push({ path: rel, encoding: enc, rows, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  };
  const sjis = (rel, rows, opts) => write(rel, encodeSjis(csv(rows, opts)), 'Shift_JIS (CP932), CRLF', rows.length - 1);
  const bom = (rel, rows, opts) => write(rel, utf8Bom(csv(rows, opts)), 'UTF-8 (BOM), CRLF', rows.length - 1);
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(path.join(SEALED, 'truth'), { recursive: true });

  const zc = (code) => zen(code);
  function codeA(code, branch) {
    let s;
    if (branch === '本社営業部') s = zen(code);
    else if (branch === '北営業所') s = zen(code.replace('-', ''));
    else s = zen(code).replace('－', 'ー');
    const u = rq.next();
    if (u < 0.01) s += '　';
    else if (u < 0.016) s = zen(code.toLowerCase());
    return s;
  }

  // ---- 伝票番号 ----
  let no = 3100001;
  for (const s of slips) s.no = no++;
  no += 860; // 9月分（このデータには含めない）
  for (const s of fuSlips) s.no = no++;

  function rowA(s, l, i) {
    const c = s.cust;
    const p = l.prod;
    const amount = l.billed * l.qty;
    let list = '';
    let rate = '';
    let costSen = 0;
    let name;
    let unit;
    if (p) {
      const sys = M.sysList(p, l.date, l.fu);
      list = comma(sys);
      rate = (Math.round((l.billed * 1000) / sys) / 10).toFixed(1);
      costSen = M.costAt(p, l.date);
      name = p.name;
      unit = p.unit;
    } else [name, unit] = NONPROD[l.code];
    const costAmt = divRound(costSen * l.qty, 100);
    return [warekiShort(l.date), String(s.no), String(i + 1), l.qty < 0 ? '返品' : '売上', c.branch, zc(c.code), c.name, codeA(l.code, c.branch), zen(name), comma(l.qty), unit, list, rate, comma(l.billed), comma(amount), senStr(costSen, true), comma(costAmt), comma(amount - costAmt), l.kubun, l.remark || ''];
  }

  // ---- 売上明細（2ファイル）と正解 ----
  const F_A = '売上明細一覧_202409-202508.csv';
  const F_B = '売上明細一覧_202509-202608.csv';
  const rowsA = [HDR_A];
  const rowsB = [HDR_A];
  const truth = [['file', 'row', 'line_id', 'date', 'customer_code', 'product_code', 'qty', 'billed', 'label', 'ambiguity', 'reference', 'reference_kind', 'shortfall_yen', 'below_floor', 'floor_price', 'floor_gap_yen', 'last12m']];
  const counts = {};
  const counts12 = {};
  const short = {};
  const xtab = {};
  const ambCount = {};
  const ambB = { lines: 0, shortfall_all: 0, shortfall_last12m: 0 };
  const AMB_NAME = { AMB1: 'PENDING_REPLY_STATUS', AMB2: 'EXCLUSION_ONLY_IN_REMARKS' };
  for (const s of slips) {
    s.lines.forEach((l, i) => {
      const inB = l.date >= D.L12_START;
      const rows = inB ? rowsB : rowsA;
      rows.push(rowA(s, l, i));
      const j = M.judge(l, 'A');
      let label = j.label;
      let amb = '';
      const ambKind = l.cust.r2?.amb;
      if (ambKind) {
        const jb = M.judge(l, 'B');
        if (jb.label !== j.label) {
          label = 'ambiguous';
          amb = `${AMB_NAME[ambKind]}|A=${j.label}|B=${jb.label}`;
          ambCount[AMB_NAME[ambKind]] = (ambCount[AMB_NAME[ambKind]] ?? 0) + 1;
          ambB.lines++;
          ambB.shortfall_all += jb.shortfall;
          if (inB) ambB.shortfall_last12m += jb.shortfall;
        }
      }
      if (label === 'overcharge') throw new Error(`overcharge: ${s.no}-${i + 1}`);
      const shortfall = label.startsWith('leak_') ? j.shortfall : 0;
      counts[label] = (counts[label] ?? 0) + 1;
      if (inB) counts12[label] = (counts12[label] ?? 0) + 1;
      if (label.startsWith('leak_')) {
        short[label] ??= { all: 0, last12m: 0, lines: 0, lines_last12m: 0 };
        short[label].all += shortfall;
        short[label].lines++;
        if (inB) {
          short[label].last12m += shortfall;
          short[label].lines_last12m++;
        }
      }
      const it = intent.get(l) ?? (l.kind === 'daihin' ? 'daihin' : 'none');
      xtab[`${it} -> ${label}`] = (xtab[`${it} -> ${label}`] ?? 0) + 1;
      const isExcluded = ['ok_non_product', 'ok_return', 'ok_sample'].includes(label);
      truth.push([
        inB ? F_B : F_A,
        rows.length - 1,
        `${s.no}-${i + 1}`,
        iso(l.date),
        l.cust.code,
        l.code,
        l.qty,
        l.billed,
        label,
        amb,
        j.ref,
        j.refKind,
        shortfall,
        isExcluded ? 0 : j.below,
        isExcluded ? '' : j.floorPrice,
        isExcluded ? 0 : j.floorGap,
        inB ? 1 : 0,
      ]);
    });
  }
  sjis(F_A, rowsA, { quoteAll: true });
  sjis(F_B, rowsB, { quoteAll: true });

  // ---- マスタ類 ----
  const EXPORT_DAY = d('2026-09-15');
  sjis('得意先マスタ.csv', [
    ['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日'],
    ...customers.map((c) => [c.code, c.name, c.abbr, c.type, c.rank, (c.rate10 / 10).toFixed(1), c.branch, c.staff, c.pref, c.closing, c.dept, slash(c.start)]),
  ]);
  sjis('商品マスタ.csv', [
    ['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)'],
    ...products.map((p) => [p.code, p.name, p.cat, p.unit, M.sysList(p, EXPORT_DAY, false), senStr(M.costAt(p, EXPORT_DAY), false), p.sup, ...p.shares]),
  ]);
  const histRows = (key, fmt) => products.flatMap((p) => p[key].map((e, i, a) => [p.code, fmt(e), slash(e.start), a[i + 1] ? slash(a[i + 1].start - 1) : '']));
  sjis('定価履歴.csv', [['商品コード', '定価(円)', '適用開始日', '適用終了日'], ...histRows('hist', (e) => e.price)]);
  sjis('原価履歴.csv', [['商品コード', '原単価(円)', '適用開始日', '適用終了日'], ...histRows('cost', (e) => senStr(e.sen, false))]);
  const spRows = specials
    .slice()
    .sort((a, b) => (a.cust.code + a.prod.code < b.cust.code + b.prod.code ? -1 : a.cust.code + a.prod.code > b.cust.code + b.prod.code ? 1 : a.start - b.start))
    .map((s) => [zc(s.cust.code), s.cust.name, zen(s.prod.code), zen(s.prod.name), comma(s.price), warekiLong(s.start), s.end === null ? '' : warekiLong(s.end), s.reason]);
  sjis('特値一覧.csv', [['得意先コード', '得意先名', '商品コード', '商品名', '特値単価', '開始日', '終了日', '登録理由'], ...spRows], { quoteAll: true });
  bom('掛率ランク表.csv', [['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明'], ...TIERS.map((t) => [t[0], t[1], t[2].toFixed(1), t[3].toFixed(1), t[4].toFixed(1), t[5]])]);
  bom('商品カテゴリ.csv', [['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料'], ...CATEGORIES]);
  sjis('仕入先一覧.csv', [['仕入先コード', '仕入先名', '主な取扱カテゴリ'], ...SUPPLIERS]);
  const AGREE = 'R7価格改定_得意先回答一覧.csv';
  const agr = customers.filter((c) => c.r2);
  bom(AGREE, [
    ['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考'],
    ...agr.map((c) => {
      const r = c.r2;
      return [String(Number(c.code)), c.name, excelDate(r.offer), r.reply ? excelDate(r.reply) : '', r.status, r.apply ? excelDate(r.apply) : '', r.keptText, r.note];
    }),
  ]);
  write(
    'README.md',
    Buffer.from(
      '# 書き出しデータ（架空）\n\nこのフォルダのファイルはすべて架空のデータです（gen-5：機械部品・工具の商社「架空 星見機工商事株式会社」）。実在の企業・団体・人物・取引とは関係ありません（名前が一致しても無関係です）。\n',
      'utf8',
    ),
    'UTF-8',
    0,
  );

  // ---- next/ ----
  const changed = products.filter((p) => p.histFu.length > p.hist.length);
  sjis('next/新定価表_20261001.csv', [['商品コード', '商品名', '現定価(円)', '新定価(円)', '適用日'], ...changed.map((p) => [p.code, p.name, p.hist[p.hist.length - 1].price, p.histFu[p.histFu.length - 1].price, '2026/10/1'])]);
  bom('next/R8価格改定_協議結果.csv', [
    ['得意先コード', '得意先名', '協議結果', '適用日', '対象外カテゴリ', '備考'],
    ...customers.filter((c) => c.r4).map((c) => [String(Number(c.code)), c.name, c.r4.status, c.r4.apply ? excelDate(c.r4.apply) : '', c.r4.keptText, c.r4.note]),
  ]);
  const mrows = [...master.values()].sort((a, b) => (a.cust.code + a.prod.code < b.cust.code + b.prod.code ? -1 : 1));
  sjis('next/単価マスタ_20261001.csv', [['得意先コード', '得意先名', '商品コード', '商品名', '適用開始日', '新単価', '現単価'], ...mrows.map((m) => [zc(m.cust.code), m.cust.name, zen(m.prod.code), zen(m.prod.name), warekiShort(m.eff), comma(m.newP), comma(m.curP)])], { quoteAll: true });
  const F_FU = 'next/売上明細一覧_202610.csv';
  const fuRows = [HDR_A];
  const fuTruth = [['file', 'row', 'line_id', 'label', 'date', 'customer', 'product', 'qty', 'billed', 'expected', 'shortfall_yen', 'pattern']];
  const fuCounts = {};
  let fuShort = 0;
  for (const s of fuSlips) {
    s.lines.forEach((l, i) => {
      fuRows.push(rowA(s, l, i));
      let label;
      let expected = '';
      let sf = 0;
      const m = l.prod ? master.get(`${l.cust.code}|${l.prod.code}`) : null;
      if (!l.prod) label = 'ok_non_product';
      else if (l.qty < 0) label = 'ok_return';
      else if (l.billed === 0 && SAMPLE_RE.test(l.remark || '')) label = 'ok_sample';
      else if (!m) label = 'not_in_master';
      else if (l.date < m.eff) {
        if (l.billed !== m.curP) throw new Error('fu before eff');
        label = 'ok_before_effective';
        expected = m.curP;
      } else {
        expected = m.newP;
        const vp = M.volPct100(l.remark);
        if (l.billed === m.newP) label = 'ok_new_price';
        else if (l.billed === m.curP) {
          label = 'still_old_price';
          sf = (m.newP - l.billed) * l.qty;
          fuShort += sf;
        } else if (vp !== null && l.billed === Math.floor((m.newP * (10000 - vp)) / 10000)) label = 'ok_volume_discount';
        else throw new Error('fu unknown');
      }
      fuCounts[label] = (fuCounts[label] ?? 0) + 1;
      fuTruth.push([F_FU, fuRows.length - 1, `${s.no}-${i + 1}`, label, iso(l.date), l.cust.code, l.code, l.qty, l.billed, expected, sf, l.pattern]);
    });
  }
  sjis(F_FU, fuRows, { quoteAll: true });

  // ---- 正解 ----
  const T = path.join(SEALED, 'truth');
  fs.writeFileSync(path.join(T, 'lines.csv'), csv(truth, { eol: '\n' }));
  fs.writeFileSync(path.join(T, 'followup_lines.csv'), csv(fuTruth, { eol: '\n' }));
  const changeCounts = {};
  for (const p of products) for (const e of p.hist.slice(1)) changeCounts[iso(e.start)] = (changeCounts[iso(e.start)] ?? 0) + 1;
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const summary = {
    note: 'すべて架空のデータです（gen-5）。実在の企業・団体・人物・取引とは関係ありません。',
    scenario: '機械部品・工具の商社（町工場・保守会社向け）。架空 星見機工商事株式会社',
    previousRevisionDate: '2025-07-01',
    previousRevisionAnsweredBy: AGREE,
    listPriceChangeDatesInHistory: sortObj(changeCounts),
    productsWithHistory: products.length,
    salesPeriod: { from: iso(D.SALES_START), to: iso(D.SALES_END) },
    last12mWindow: { from: iso(D.L12_START), to: iso(D.SALES_END) },
    marginFloorPct: FLOOR_PCT,
    scale: { customers: customers.length, products: products.length, salesLines: truth.length - 1, specials: specials.length, agreementsRows: agr.length },
    counts: sortObj(counts),
    countsLast12m: sortObj(counts12),
    shortfallYen: sortObj(short),
    ambiguousPatterns: sortObj(ambCount),
    ambiguousUnderReadingB: ambB,
    followup: {
      revisionDate: '2026-10-01',
      priceMasterRows: master.size,
      counts: sortObj(fuCounts),
      stillOldPriceShortfallYen: fuShort,
      customerWide: { allMonth: F1.code, until20261008: F2.code },
    },
    roles: Object.fromEntries(Object.entries(ROLE).map(([k, c]) => [k, c.code])),
    files: files.slice().sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  fs.writeFileSync(path.join(T, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(SEALED, 'notes.md'), notes(summary, ROLE));
  console.error(JSON.stringify({ counts: summary.counts, short, fuCounts, fuShort, xtab: sortObj(xtab), amb: ambCount, ambB, scale: summary.scale, changeCounts }, null, 1));
}

function notes(S, ROLE) {
  const r = (k) => ROLE[k].code;
  return `# gen-5 正解の注記（架空データ）

すべて架空のデータです。実在の企業・団体・人物・取引とは関係ありません。

## 前提
- 合意状況ファイル \`${S.previousRevisionAnsweredBy}\` が答えている改定は **2025-07-01**（令和7年7月1日）。
- 定価履歴には、ほかに 2024-10-01（全社改定、合意状況ファイルなし＝全得意先に適用）と 2026-04-01（切削工具 CT だけの改定、合意状況ファイルなし＝全得意先に適用）の改定日がある。
- 粗利率の下限は 10%。単価の端数は切り捨て。正解は README（転嫁デスク）と data-gen/README.md に書かれた判定ルールの順番どおりに付けた。
- 2023-10-01 は定価履歴の最初の日付（変更ではない）。

## あいまい（label=ambiguous）にした行
1. **PENDING_REPLY_STATUS**（得意先 ${r('Y1')}）：合意状況が「回答待ち」。文書は「協議中」を見送りと同じに扱うと書くが、「回答待ち」は書いていない。
   - A：協議中と同じ（旧定価のままが正しい）→ ok_declined
   - B：認識できない状況＝合意扱い（新定価が正しい）→ leak_old_price
   - 行の reference などは A の読み方で書いた。B なら不足額は summary.json の ambiguousUnderReadingB を参照。
2. **EXCLUSION_ONLY_IN_REMARKS**（得意先 ${r('Y2')}）：合意状況が「一部合意」で、対象外カテゴリの列は空欄、備考にだけ「作業工具は据え置き」とある。
   - A：備考どおり作業工具（HT）は据え置き → ok_declined
   - B：対象外カテゴリの列が空なので全カテゴリ合意 → leak_old_price

## あいまいにしなかったが、読み方の注意がいる行
- 合意で適用日が空欄の得意先は、改定日（2025-07-01）から適用として扱った（これらの得意先は改定日から新定価で正しく請求しているので、どちらに読んでも漏れにはならない）。
- 得意先 ${r('N1')} は「一部合意」で、対象外カテゴリの列にカテゴリコードではなく名前「切削工具」と書いてある。意図は明らかなので CT 据え置き（ok_declined）を正解にした。名前を読めないとこの得意先の切削工具の行（2025-07-01〜2026-03-31）が反映漏れに見える。
- 単価0円で備考が「不良交換品（代品）」の行（4行）は、備考に「見本」「サンプル」「無償」「試供」がないので、文書のルールどおり通常の判定（掛率ランク外、不足額＝基準単価×数量）にした。「無償交換（初期不良）」の行（2行）は「無償」を含むので ok_sample。
- 合意状況「見送り」「協議中」「一部合意の対象外カテゴリ」で旧定価のまま正しい行は ok_declined、「適用日を後ろにずらした合意」で適用日前の旧定価は ok_deferred にした。
- 2024-10-01 と 2026-04-01 の改定には合意状況ファイルがないので、全得意先が合意したものとして扱った。前回（2025-07-01）を見送った得意先も、2026-04-01 に CT の定価が変わったあとは新しい定価が正しい。その直前に適用されていた定価（2024-10-01 の定価）のままの請求は leak_old_price。
- 2回前の定価のままの請求（反映を2回とも忘れた組）は、文書のとおり反映漏れにせず、掛率ランクの下限より安ければ leak_rate_out_of_tier、範囲内なら unexplained にした。
- unexplained（原因不明の価格差）は漏れの種類ではないので shortfall_yen を 0 にした。
- 期間の重なる特値は、開始日が新しいほうを正しい単価にした。
- 粗利下限割れの不足額は（粗利率10%になる最小の単価 − 請求単価）× 数量。floor_price は ceil(原単価 / 0.9)。below_floor は請求単価で計算した粗利率が10%未満なら 1（漏れの種類がほかでも 1 になりうる）。
- 返品・見本品・運賃などの対象外の行は below_floor=0、floor_price は空欄。
- 売上明細の「原単価」はその日の原価履歴の値。粗利の判定はこの値で行った。
- 諸口（得意先マスタにない得意先）の売上は含めていない。基準より高い請求（overcharge）は0行。

## 反映チェック（next/）
- 次回改定は 2026-10-01。新単価マスタ（next/単価マスタ_20261001.csv）にある組で、適用開始日以降に「現単価」で請求した行が still_old_price。
- 「適用日変更」の得意先は適用開始日 2026-11-01 なので、10月は現単価のままが正しい（ok_before_effective）。
- 新単価マスタにない組は not_in_master（請求単価にかかわらず）。
- 得意先まるごと：${S.followup.customerWide.allMonth} は10月中ずっと現単価、${S.followup.customerWide.until20261008} は 2026-10-08 まで現単価。ほかに対象の組の約9%が現単価のまま（10月に買っていない組もある）。
`;
}
