// node --test で実行する。Google のサービスを使わない関数だけを検証する。
const test = require('node:test');
const assert = require('node:assert');
const {
  MODE,
  planInvoices,
  collectLines,
  groupByClient,
  calcInvoiceTotals,
  taxBreakdownRows,
  invoiceItemRows,
  assignInvoiceNumbers,
  orderTargets,
  sentInvoiceNumbers,
  latestDraftId,
  parseSettings,
  parseClients,
  isValidEmailList,
  normalizeRegistrationNumber,
  parseTaxRate,
  parseNumber,
  truncYen,
  toDate,
  targetMonth,
  endOfMonth,
  calcDueDate,
  fillTemplate,
  buildPdfExportUrl,
  pdfFileName,
  namesFromSelection,
  confirmMessage,
  noTargetMessage,
  resultMessage,
  formatErrors,
  templateLayout,
  formatYen,
  formatDateJa,
} = require('./Code.js');

// ---- テスト用のシートの中身（1行目の見出しは除いた状態。設定シートだけは見出しごと読む） ----

const settingsRows = [
  ['項目', '値', '説明'],
  ['自社名', 'ほしデザイン事務所', ''],
  ['住所', '東京都千代田区1-1-1', ''],
  ['登録番号', 'T1234567890123', ''],
  ['振込先', 'サンプル銀行 本店 普通 1234567', ''],
  ['支払期限日数', '', ''],
  ['送信モード', '下書き', ''],
  ['件名テンプレ', '【請求書】{対象月}分 {請求書番号}', ''],
  ['本文テンプレ', '{取引先名} {敬称}\nご請求金額：{金額}（税込）\nお支払期限：{期限}', ''],
  ['備考', '', ''],
];

const clientRows = [
  ['株式会社サンプル商事', '御中', 'billing@example.com'],
  ['山田 太郎', '様', 'taro@example.com'],
  ['合同会社ミライ', '', 'mirai@example.com'],
];

// 行番号は 2 行目から
const detailRows = [
  [new Date(2026, 8, 3), '山田 太郎', 'ロゴデザイン', 1, 50000, '10%'], // 2
  [new Date(2026, 8, 5), '株式会社サンプル商事', 'Web保守', 1, 1005, '10%'], // 3
  [new Date(2026, 8, 6), '株式会社サンプル商事', '修正作業', 1, 1005, 0.1], // 4 パーセント表示のセルは 0.1 で届く
  [new Date(2026, 8, 7), '株式会社サンプル商事', '会議用 菓子', 1, 1010, '8%'], // 5
  ['2026/09/08', '株式会社サンプル商事', '会議用 飲料', 1, '1,010', '８％'], // 6 文字の日付・全角
  [new Date(2026, 8, 30, 23, 59), '株式会社サンプル商事', '収入印紙（立替）', 1, 500, '非課税'], // 7 月末の夜
  [new Date(2026, 9, 1), '株式会社サンプル商事', '翌月分', 1, 99999, '10%'], // 8 対象外
  [new Date(2026, 7, 31), '山田 太郎', '前月分', 1, 99999, '10%'], // 9 対象外
  ['', '', '', '', '', ''], // 10 空行
];

const plan = (overrides) =>
  planInvoices({ settingsRows, clientRows, detailRows, historyRows: [], year: 2026, month: 9, ...overrides });

// ---- 消費税の計算（適格請求書のルール） ----

test('消費税は請求書ごと・税率ごとに1回だけ計算し、1円未満を切り捨てる（10%/8%/非課税の混在）', () => {
  const { lines } = collectLines(detailRows, 2026, 9);
  const sample = lines.filter((l) => l.client === '株式会社サンプル商事');
  const t = calcInvoiceTotals(sample);

  // 10%: 1,005 + 1,005 = 2,010 → 201.0 円。1行ずつ計算すると 100 + 100 = 200 円になってしまう
  assert.deepStrictEqual(t.byRate[10], { rate: 10, base: 2010, tax: 201 });
  // 8%: 1,010 + 1,010 = 2,020 → 161.6 円 → 161 円（1行ずつなら 80 + 80 = 160 円）
  assert.deepStrictEqual(t.byRate[8], { rate: 8, base: 2020, tax: 161 });
  // 非課税は消費税なし
  assert.deepStrictEqual(t.byRate[0], { rate: 0, base: 500, tax: 0 });

  assert.strictEqual(t.subtotal, 4530);
  assert.strictEqual(t.tax, 362);
  assert.strictEqual(t.total, 4892);
  assert.strictEqual(t.hasReduced, true);
});

test('切り捨ては小数の誤差に強く、値引き（マイナス）は 0 に近い方へ切り捨てる', () => {
  assert.strictEqual(truncYen(1.15 * 100), 115); // 114.99999999999999 になる計算
  assert.strictEqual(truncYen(0.29 * 100), 29); // 28.999999999999996 になる計算
  assert.strictEqual(truncYen(99.9), 99);
  assert.strictEqual(truncYen(-100.5), -100);
  assert.ok(Object.is(truncYen(-0.4), 0), '-0 にならない');

  // 値引き行を含む 10% の請求書: (10,000 - 1,001) × 10% = 899.9 → 899
  const t = calcInvoiceTotals([
    { rate: 10, amount: 10000 },
    { rate: 10, amount: -1001 },
  ]);
  assert.strictEqual(t.byRate[10].tax, 899);
  assert.strictEqual(t.total, 9898);
  assert.strictEqual(t.hasReduced, false);
});

test('税率別内訳は使った税率だけを 10% → 8% → 非課税 の順で出す', () => {
  const t = calcInvoiceTotals([
    { rate: 0, amount: 300 },
    { rate: 8, amount: 1000 },
  ]);
  assert.deepStrictEqual(taxBreakdownRows(t), [
    ['8%対象（軽減税率）', 1000, 80],
    ['非課税', 300, '—'],
  ]);
});

test('明細欄の行は軽減税率の品目に ※ をつけ、税率を表示する', () => {
  const d = new Date(2026, 8, 7);
  const rows = invoiceItemRows([
    { date: d, item: '菓子', qty: 2, price: 540, rate: 8, amount: 1080 },
    { date: d, item: '保守', qty: 1, price: 1000, rate: 10, amount: 1000 },
    { date: d, item: '印紙', qty: 1, price: 200, rate: 0, amount: 200 },
  ]);
  assert.deepStrictEqual(rows[0], [d, '菓子 ※', 2, 540, '8%', 1080]);
  assert.deepStrictEqual(rows[1].slice(1), ['保守', 1, 1000, '10%', 1000]);
  assert.strictEqual(rows[2][4], '非課税');
});

test('parseTaxRate は入力ゆれを 10 / 8 / 0 にそろえ、読めないものは null', () => {
  assert.strictEqual(parseTaxRate('10%'), 10);
  assert.strictEqual(parseTaxRate('１０％'), 10);
  assert.strictEqual(parseTaxRate(0.1), 10);
  assert.strictEqual(parseTaxRate(10), 10);
  assert.strictEqual(parseTaxRate(''), 10); // 空欄は 10%
  assert.strictEqual(parseTaxRate('8%'), 8);
  assert.strictEqual(parseTaxRate(0.08), 8);
  assert.strictEqual(parseTaxRate('軽減8%'), 8);
  assert.strictEqual(parseTaxRate('8%（軽減）'), 8);
  assert.strictEqual(parseTaxRate('非課税'), 0);
  assert.strictEqual(parseTaxRate('不課税'), 0);
  assert.strictEqual(parseTaxRate('5%'), null);
  assert.strictEqual(parseTaxRate('課税'), null);
});

test('parseNumber は記号・単位・全角つきの入力を数値にし、読めなければ NaN', () => {
  assert.strictEqual(parseNumber('1,010'), 1010);
  assert.strictEqual(parseNumber('¥3,000'), 3000);
  assert.strictEqual(parseNumber('１，２００円'), 1200);
  assert.strictEqual(parseNumber('-500'), -500);
  assert.strictEqual(parseNumber(1.5), 1.5);
  assert.ok(Number.isNaN(parseNumber('')));
  assert.ok(Number.isNaN(parseNumber('なし')));
});

// ---- 対象月の絞り込み・取引先ごとのまとめ ----

test('collectLines は対象月の明細だけを取り出す（月末の夜は含み、翌月1日と前月末日は除く）', () => {
  const { lines, errors } = collectLines(detailRows, 2026, 9);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(
    lines.map((l) => l.rowNo),
    [2, 3, 4, 5, 6, 7],
  );
  const row6 = lines.find((l) => l.rowNo === 6);
  assert.strictEqual(row6.amount, 1010);
  assert.strictEqual(row6.rate, 8);
  assert.strictEqual(row6.date.getDate(), 8);

  const oct = collectLines(detailRows, 2026, 10).lines;
  assert.deepStrictEqual(
    oct.map((l) => l.item),
    ['翌月分'],
  );
});

test('collectLines は対象月の不正な行を行番号つきのエラーにする（他の月の行は見ない）', () => {
  const rows = [
    [new Date(2026, 8, 1), '株式会社サンプル商事', '', 'いち', 1000, '5%'], // 2
    ['2026/13/01', '山田 太郎', '作業', 1, 1000, '10%'], // 3 日付が読めない
    [new Date(2026, 7, 1), '', '', 'x', 'x', 'x'], // 4 先月なので見ない
    [new Date(2026, 8, 30), '', '', '', '', ''], // 5 日付だけの行は空行扱い
  ];
  const { lines, errors } = collectLines(rows, 2026, 9);
  assert.strictEqual(lines.length, 0);
  assert.deepStrictEqual(
    errors.map((e) => `${e.rowNo}:${e.message}`),
    [
      '2:品目が空です',
      '2:数量「いち」が数字ではありません',
      '2:税区分「5%」は 10% / 8% / 非課税 のどれかにしてください',
      '3:日付「2026/13/01」が読み取れません（例: 2026/09/30）',
    ],
  );
});

test('toDate は Date と各種の文字の日付を読み、ありえない日付は null', () => {
  assert.strictEqual(toDate('2026-09-30').getDate(), 30);
  assert.strictEqual(toDate('2026年9月1日').getMonth(), 8);
  assert.strictEqual(toDate('２０２６/０９/０５').getDate(), 5);
  assert.strictEqual(toDate('2026/02/30'), null);
  assert.strictEqual(toDate('9/5'), null);
  assert.strictEqual(toDate(new Date('invalid')), null);
});

test('groupByClient は取引先シートの順に並べ、明細は日付順にする', () => {
  const lines = [
    { rowNo: 5, client: '乙', date: new Date(2026, 8, 2) },
    { rowNo: 2, client: '甲', date: new Date(2026, 8, 9) },
    { rowNo: 3, client: '甲', date: new Date(2026, 8, 1) },
    { rowNo: 4, client: '未登録', date: new Date(2026, 8, 1) },
  ];
  const groups = groupByClient(lines, ['甲', '乙']);
  assert.deepStrictEqual(
    groups.map((g) => g.client),
    ['甲', '乙', '未登録'],
  );
  assert.deepStrictEqual(
    groups[0].lines.map((l) => l.rowNo),
    [3, 2],
  );
});

// ---- 請求書番号・二重送信の防止 ----

test('assignInvoiceNumbers は月ごとの連番を振る（INV-202609-001 形式）', () => {
  assert.deepStrictEqual(assignInvoiceNumbers(['甲', '乙'], 2026, 9, []), { 甲: 'INV-202609-001', 乙: 'INV-202609-002' });
  assert.deepStrictEqual(assignInvoiceNumbers(['甲'], 2027, 1, [], 'SEI'), { 甲: 'SEI-202701-001' });
});

test('assignInvoiceNumbers は履歴の番号を使い回し、新しい取引先にはその月の続き番号を振る', () => {
  const history = [
    [new Date(), 'INV-202609-001', '2026-09', '甲', 'a@example.com', 1000, '下書き', '', 'r-1'],
    [new Date(), 'INV-202609-002', '2026-09', '乙', 'b@example.com', 1000, '送信済', '', ''],
    [new Date(), 'INV-202608-007', '2026-08', '丙', 'c@example.com', 1000, '送信済', '', ''], // 別の月は関係ない
  ];
  assert.deepStrictEqual(assignInvoiceNumbers(['丙', '乙', '甲'], 2026, 9, history), {
    丙: 'INV-202609-003',
    乙: 'INV-202609-002',
    甲: 'INV-202609-001',
  });
  // 先月の番号は先月のまま使い回す
  assert.deepStrictEqual(assignInvoiceNumbers(['丙'], 2026, 8, history), { 丙: 'INV-202608-007' });
});

test('同じ取引先に番号が2つあるときは、送信済みの番号を使う', () => {
  const history = [
    [new Date(), 'INV-202609-001', '2026-09', '甲', '', 0, '送信済', '', ''],
    [new Date(), 'INV-202609-004', '2026-09', '甲', '', 0, 'エラー: 何か', '', ''],
  ];
  assert.strictEqual(assignInvoiceNumbers(['甲'], 2026, 9, history)['甲'], 'INV-202609-001');
});

test('状態を「取消」にした番号は使い回さず、欠番にして新しい番号を振る（訂正して出し直すとき）', () => {
  const history = [
    [new Date(), 'INV-202609-001', '2026-09', '甲', '', 0, '下書き', '', 'r-1'],
    [new Date(), 'INV-202609-001', '2026-09', '甲', '', 0, '取消', '', ''], // 送信済 を 取消 に書き換えた行
    [new Date(), 'INV-202609-002', '2026-09', '乙', '', 0, '送信済', '', ''],
  ];
  assert.deepStrictEqual(assignInvoiceNumbers(['甲', '乙'], 2026, 9, history), { 甲: 'INV-202609-003', 乙: 'INV-202609-002' });
});

test('orderTargets は送信済みを外し、まだ作っていない請求書を先にする', () => {
  const invs = [
    { number: 'INV-202609-001', alreadySent: false },
    { number: 'INV-202609-002', alreadySent: true },
    { number: 'INV-202609-003', alreadySent: false },
    { number: 'INV-202609-004', alreadySent: false },
  ];
  const history = [
    [new Date(), 'INV-202609-001', '', '甲', '', 0, '下書き', '', 'r-1'],
    [new Date(), 'INV-202609-002', '', '乙', '', 0, '送信済', '', ''],
  ];
  assert.deepStrictEqual(
    orderTargets(invs, history).map((i) => i.number),
    ['INV-202609-003', 'INV-202609-004', 'INV-202609-001'],
  );
});

test('sentInvoiceNumbers は「送信済」で始まる行だけを数え、latestDraftId は最後の下書きを返す', () => {
  const history = [
    [new Date(), 'INV-202609-001', '', '甲', '', 0, '下書き', '', 'r-old'],
    [new Date(), 'INV-202609-001', '', '甲', '', 0, '下書き', '', 'r-new'],
    [new Date(), 'INV-202609-002', '', '乙', '', 0, '送信済', '', ''],
    [new Date(), 'INV-202609-003', '', '丙', '', 0, '送信済（Gmailの送信済みで確認）', '', ''],
    [new Date(), 'INV-202609-004', '', '丁', '', 0, 'エラー: PDF', '', ''],
  ];
  assert.deepStrictEqual([...sentInvoiceNumbers(history)], ['INV-202609-002', 'INV-202609-003']);
  assert.strictEqual(latestDraftId(history, 'INV-202609-001'), 'r-new');
  assert.strictEqual(latestDraftId(history, 'INV-202609-002'), '');
});

// ---- 日付・支払期限 ----

test('支払期限は空欄なら翌月末（年またぎ・うるう年も）、数字なら発行日の◯日後', () => {
  assert.strictEqual(formatDateJa(calcDueDate(endOfMonth(2026, 9), null)), '2026年10月31日');
  assert.strictEqual(formatDateJa(calcDueDate(endOfMonth(2026, 12), null)), '2027年1月31日');
  assert.strictEqual(formatDateJa(calcDueDate(endOfMonth(2028, 1), null)), '2028年2月29日');
  assert.strictEqual(formatDateJa(calcDueDate(endOfMonth(2026, 9), 30)), '2026年10月30日');
  assert.strictEqual(formatDateJa(calcDueDate(endOfMonth(2026, 9), 0)), '2026年9月30日');
});

test('targetMonth は今月・先月を返す（1月の先月は前年12月）', () => {
  assert.deepStrictEqual(targetMonth(new Date(2026, 9, 6), 0), { year: 2026, month: 10 });
  assert.deepStrictEqual(targetMonth(new Date(2026, 9, 31), -1), { year: 2026, month: 9 });
  assert.deepStrictEqual(targetMonth(new Date(2027, 0, 15), -1), { year: 2026, month: 12 });
});

// ---- テンプレの差し込み ----

test('fillTemplate は {名前} を差し込み、全角の｛｝にも対応し、知らない名前はそのまま残す', () => {
  const vars = { 取引先名: '株式会社サンプル商事', 敬称: '御中', 金額: '4,892円', 期限: '2026年10月31日' };
  assert.strictEqual(fillTemplate('{取引先名} {敬称}', vars), '株式会社サンプル商事 御中');
  assert.strictEqual(fillTemplate('｛金額｝を{期限}までに', vars), '4,892円を2026年10月31日までに');
  assert.strictEqual(fillTemplate('{金額}/{金額}', vars), '4,892円/4,892円');
  assert.strictEqual(fillTemplate('{ 敬称 }', vars), '御中');
  assert.strictEqual(fillTemplate('{担当者}様', vars), '{担当者}様');
  assert.strictEqual(fillTemplate('1行目\n{金額}', vars), '1行目\n4,892円');
  assert.strictEqual(fillTemplate('', vars), '');
});

test('formatYen は3桁区切りの円表記にする', () => {
  assert.strictEqual(formatYen(4892), '4,892円');
  assert.strictEqual(formatYen(1234567), '1,234,567円');
  assert.strictEqual(formatYen(0), '0円');
  assert.strictEqual(formatYen(-1500), '-1,500円');
});

// ---- 設定・取引先の読み込み ----

test('parseSettings は未入力を初期値（下書き・翌月末・標準の件名/本文）にする', () => {
  const { settings, errors } = parseSettings([['自社名', 'ほし']]);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(settings.mode, MODE.draft);
  assert.strictEqual(settings.dueDays, null);
  assert.match(settings.subjectTemplate, /\{請求書番号\}/);
  assert.match(settings.bodyTemplate, /\{金額\}/);
});

test('parseSettings は送信モード・支払期限日数を読み、間違いはエラーにする', () => {
  const ok = parseSettings([
    ['自社名', 'ほし'],
    ['送信モード', '送信'],
    ['支払期限日数', '45日'],
  ]);
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.settings.mode, MODE.send);
  assert.strictEqual(ok.settings.dueDays, 45);
  assert.strictEqual(parseSettings([['自社名', 'ほし'], ['支払期限日数', 30]]).settings.dueDays, 30);
  assert.strictEqual(parseSettings([['自社名', 'ほし'], ['支払期限日数', '翌月末']]).settings.dueDays, null);

  const ng = parseSettings([
    ['自社名', ''],
    ['登録番号', 'T123'],
    ['送信モード', 'すぐ送る'],
    ['支払期限日数', '来月'],
  ]);
  assert.strictEqual(ng.errors.length, 4);
  assert.match(ng.errors.join('\n'), /自社名/);
  assert.match(ng.errors.join('\n'), /T＋13桁/);
  assert.match(ng.errors.join('\n'), /送信モード/);
  assert.match(ng.errors.join('\n'), /支払期限日数/);
});

test('登録番号は全角・ハイフン・小文字・T の付け忘れをそろえる', () => {
  assert.strictEqual(normalizeRegistrationNumber('Ｔ１２３４５６７８９０１２３'), 'T1234567890123');
  assert.strictEqual(normalizeRegistrationNumber('t-1234-5678-9012-3'), 'T1234567890123');
  assert.strictEqual(normalizeRegistrationNumber('1234567890123'), 'T1234567890123');
  assert.strictEqual(normalizeRegistrationNumber(''), '');
  assert.deepStrictEqual(parseSettings([['自社名', 'ほし'], ['登録番号', '１２３４５６７８９０１２３']]).errors, []);
});

test('parseClients は敬称の初期値を御中にし、重複した取引先名を記録する', () => {
  const c = parseClients([...clientRows, ['山田 太郎', '様', 'other@example.com'], ['', '', '']]);
  assert.deepStrictEqual(c.order, ['株式会社サンプル商事', '山田 太郎', '合同会社ミライ']);
  assert.strictEqual(c.byName.get('合同会社ミライ').honorific, '御中');
  assert.strictEqual(c.byName.get('山田 太郎').email, 'taro@example.com');
  assert.strictEqual(c.byName.get('山田 太郎').rowNo, 3);
  assert.deepStrictEqual([...c.duplicates], ['山田 太郎']);
});

test('isValidEmailList はカンマ区切りの複数アドレスも確認する', () => {
  assert.ok(isValidEmailList('a@example.com'));
  assert.ok(isValidEmailList('a@example.com, b@example.co.jp'));
  assert.ok(!isValidEmailList(''));
  assert.ok(!isValidEmailList('a@example'));
  assert.ok(!isValidEmailList('a@example.com, なし'));
});

// ---- 全体の流れ（planInvoices） ----

test('planInvoices は取引先ごとに番号・金額・期限・件名・本文・ファイル名をそろえる', () => {
  const p = plan();
  assert.deepStrictEqual(p.errors, []);
  assert.strictEqual(p.mode, MODE.draft);
  assert.strictEqual(p.invoices.length, 2);

  const [sample, yamada] = p.invoices; // 取引先シートの順
  assert.strictEqual(sample.number, 'INV-202609-001');
  assert.strictEqual(sample.client, '株式会社サンプル商事');
  assert.strictEqual(sample.email, 'billing@example.com');
  assert.strictEqual(sample.totals.total, 4892);
  assert.strictEqual(sample.lines.length, 5);
  assert.strictEqual(formatDateJa(sample.issueDate), '2026年9月30日');
  assert.strictEqual(formatDateJa(sample.dueDate), '2026年10月31日');
  assert.strictEqual(sample.subject, '【請求書】2026年9月分 INV-202609-001');
  assert.strictEqual(sample.body, '株式会社サンプル商事 御中\nご請求金額：4,892円（税込）\nお支払期限：2026年10月31日');
  assert.strictEqual(sample.fileName, '請求書_INV-202609-001_株式会社サンプル商事.pdf');
  assert.strictEqual(sample.alreadySent, false);

  assert.strictEqual(yamada.number, 'INV-202609-002');
  assert.strictEqual(yamada.honorific, '様');
  assert.strictEqual(yamada.totals.total, 55000);
});

test('planInvoices は送信済みの請求書に印をつけ、確認文から外す', () => {
  const historyRows = [[new Date(), 'INV-202609-002', '2026-09', '山田 太郎', 'taro@example.com', 55000, '送信済', '', '']];
  const p = plan({ historyRows });
  const yamada = p.invoices.find((i) => i.client === '山田 太郎');
  assert.strictEqual(yamada.number, 'INV-202609-002');
  assert.strictEqual(yamada.alreadySent, true);
  // 履歴に番号のない取引先は 003 から（002 とぶつからない）
  assert.strictEqual(p.invoices.find((i) => i.client === '株式会社サンプル商事').number, 'INV-202609-003');

  const msg = confirmMessage(p);
  assert.match(msg, /請求書 1件/);
  assert.match(msg, /送信済みのためスキップ: 山田 太郎/);
});

test('planInvoices は未登録の取引先・メールの誤り・重複をエラーにする', () => {
  const rows = [...detailRows, [new Date(2026, 8, 10), '未登録株式会社', '作業', 1, 1000, '10%']]; // 11行目
  const clients = [...clientRows.slice(0, 1), ['山田 太郎', '様', 'taro@'], ['山田 太郎', '様', 'x@example.com']];
  const p = planInvoices({ settingsRows, clientRows: clients, detailRows: rows, historyRows: [], year: 2026, month: 9 });
  assert.deepStrictEqual(p.errors, [
    '取引先「山田 太郎」のメールアドレス「taro@」を確認してください（取引先 3行目）',
    '取引先「山田 太郎」が「取引先」シートに2回以上登録されています',
    '取引先「未登録株式会社」が「取引先」シートにありません（明細 11行目）',
  ]);
});

test('選択した取引先だけ作るときは、他の取引先の入力ミスでは止めない', () => {
  const rows = [...detailRows, [new Date(2026, 8, 10), '合同会社ミライ', '作業', 'x', 1000, '10%']];
  assert.strictEqual(planInvoices({ settingsRows, clientRows, detailRows: rows, historyRows: [], year: 2026, month: 9 }).errors.length, 1);

  const p = planInvoices({
    settingsRows,
    clientRows,
    detailRows: rows,
    historyRows: [],
    year: 2026,
    month: 9,
    onlyClients: ['山田 太郎', '株式会社なし'],
  });
  assert.deepStrictEqual(p.errors, []);
  assert.deepStrictEqual(
    p.invoices.map((i) => i.client),
    ['山田 太郎'],
  );
  assert.strictEqual(p.invoices[0].number, 'INV-202609-001');
  assert.deepStrictEqual(p.missing, ['株式会社なし']);
});

test('「下書きだけ作る」は設定が「送信」でも下書きにする', () => {
  const sendSettings = settingsRows.map((r) => (r[0] === '送信モード' ? ['送信モード', '送信', ''] : r));
  assert.strictEqual(plan({ settingsRows: sendSettings }).mode, MODE.send);
  assert.match(confirmMessage(plan({ settingsRows: sendSettings })), /【送信】します。送信は取り消せません/);

  const forced = plan({ settingsRows: sendSettings, forceDraft: true });
  assert.strictEqual(forced.mode, MODE.draft);
  assert.match(confirmMessage(forced), /下書き」に保存します（送信はしません）/);
});

test('明細がない月・すべて送信済みのときの案内文', () => {
  assert.match(noTargetMessage(plan({ month: 11 })), /2026年11月の明細がありません/);
  const historyRows = [
    [new Date(), 'INV-202609-001', '', '株式会社サンプル商事', '', 0, '送信済', '', ''],
    [new Date(), 'INV-202609-002', '', '山田 太郎', '', 0, '送信済', '', ''],
  ];
  const p = plan({ historyRows });
  assert.ok(p.invoices.every((i) => i.alreadySent));
  assert.match(noTargetMessage(p), /すべて送信済み/);
});

test('結果の文面は件数・失敗・時間切れ・保存先を伝える', () => {
  const inv = (client) => ({ client });
  const msg = resultMessage(
    MODE.draft,
    { done: [inv('甲'), inv('乙')], skipped: [inv('丙')], failed: [{ inv: inv('丁'), message: 'HTTP 403' }], rest: [inv('戊')] },
    'https://drive.example/folder',
  );
  assert.match(msg, /2件を Gmail の下書きに保存しました/);
  assert.match(msg, /スキップ: 丙/);
  assert.match(msg, /丁: HTTP 403/);
  assert.match(msg, /時間切れで未処理: 戊/);
  assert.match(msg, /https:\/\/drive\.example\/folder/);
  assert.match(resultMessage(MODE.send, { done: [inv('甲')], skipped: [], failed: [], rest: [] }, 'u'), /1件を送信しました/);
});

test('formatErrors は多すぎるエラーを省略する', () => {
  const errors = Array.from({ length: 20 }, (_, i) => `エラー${i + 1}`);
  const text = formatErrors(errors);
  assert.match(text, /^・エラー1\n/);
  assert.match(text, /ほか 5件$/);
});

// ---- PDF・テンプレ・その他 ----

test('templateLayout は明細が15行を超えた分だけ下の欄をずらす', () => {
  const small = templateLayout(3);
  assert.strictEqual(small.extraRows, 0);
  assert.strictEqual(small.subtotalRow, 31);
  assert.strictEqual(small.remarksRow, 42);

  const big = templateLayout(20);
  assert.strictEqual(big.extraRows, 5);
  assert.strictEqual(big.insertAfterRow, 29);
  assert.strictEqual(big.itemRows, 20);
  assert.strictEqual(big.itemFirstRow, 15);
  assert.strictEqual(big.subtotalRow, 36);
  assert.strictEqual(big.breakdownFirstRow, 41);
  assert.strictEqual(big.remarksRow, 47);
});

test('buildPdfExportUrl はシート1枚を A4 縦の PDF で書き出す URL を作る', () => {
  const url = new URL(buildPdfExportUrl('abc123', 98765));
  assert.strictEqual(url.origin + url.pathname, 'https://docs.google.com/spreadsheets/d/abc123/export');
  assert.strictEqual(url.searchParams.get('format'), 'pdf');
  assert.strictEqual(url.searchParams.get('gid'), '98765');
  assert.strictEqual(url.searchParams.get('size'), 'A4');
  assert.strictEqual(url.searchParams.get('portrait'), 'true');
  assert.strictEqual(url.searchParams.get('gridlines'), 'false');
});

test('pdfFileName はファイル名に使えない文字を置きかえる', () => {
  assert.strictEqual(pdfFileName({ number: 'INV-202609-001', client: 'A/B:C*社' }), '請求書_INV-202609-001_A_B_C_社.pdf');
});

test('namesFromSelection は選んだ行の取引先名を重複・見出し・空欄なしで返す', () => {
  const rows = [['取引先名', '敬称'], ['甲', '御中'], ['', ''], ['乙', '様'], ['甲', '御中']];
  assert.deepStrictEqual(namesFromSelection(rows, 0), ['甲', '乙']);
  assert.deepStrictEqual(namesFromSelection([[new Date(), ' 丙 ']], 1), ['丙']);
});
