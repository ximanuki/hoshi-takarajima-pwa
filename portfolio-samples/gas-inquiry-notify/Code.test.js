// node --test で実行する。
// 前半: Google のサービスを使わない関数の検証。
// 後半: SpreadsheetApp / MailApp / UrlFetchApp などをモックにして、フォーム送信〜通知〜リマインドの流れを通しで確認する。
const test = require('node:test');
const assert = require('node:assert');
const G = require('./Code.js');
const {
  CONFIG,
  DEFAULT_TEMPLATES,
  parseSettings,
  buildConfig,
  parseTemplates,
  parseBool,
  parseNumber,
  splitList,
  normalizeChatworkRoomId,
  maskSecret,
  fillTemplate,
  listPlaceholders,
  findUnknownPlaceholders,
  renderReply,
  pickTemplate,
  buildTemplateData,
  orderAnswers,
  zipAnswers,
  findAnswer,
  normalizeEmail,
  isValidEmail,
  checkSpam,
  planManagementColumns,
  formatDateJst,
  makeReceiptNo,
  sheetLink,
  toInquiryItems,
  filterOverdue,
  truncate,
  buildInquiryMessage,
  buildReminderMessage,
  sampleAnswers,
  buildSlackPayload,
  buildDiscordPayload,
  buildChatworkRequest,
  buildSlackRequest,
  buildDiscordRequest,
  buildNotifyRequests,
  validateConfig,
} = G;

/** 日本時間で日時を作る（テストの実行環境のタイムゾーンに左右されない） */
const jst = (s) => new Date(`${s}+09:00`);

// おすすめのフォームの質問（SETUP_GUIDE.md と同じ）
const FORM_HEADERS = ['タイムスタンプ', 'お名前', 'メールアドレス', '電話番号', 'お問い合わせ種別', 'ご希望日時', 'お問い合わせ内容'];

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX';
const DISCORD_URL = 'https://discord.com/api/webhooks/123/abc';

const answers = [
  { label: 'お名前', value: '山田 太郎' },
  { label: 'メールアドレス', value: 'taro@example.com' },
  { label: '電話番号', value: '090-0000-0000' },
  { label: 'お問い合わせ種別', value: '予約' },
  { label: 'ご希望日時', value: '10月10日 14:00' },
  { label: 'お問い合わせ内容', value: 'カットの予約をお願いします。' },
];

const message = buildInquiryMessage(answers, {
  nameField: 'お名前',
  kindField: 'お問い合わせ種別',
  receivedAt: jst('2026-10-06T09:05:12'),
  maxChars: 500,
  url: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=0&range=A5',
});

// ---- 差し込み・テンプレート ----

test('fillTemplate は差し込みを埋め、データにない項目は空にする（fallback 指定も可）', () => {
  const data = { お名前: '山田 太郎', 店舗名: 'サンプル商店' };
  assert.strictEqual(fillTemplate('{お名前} 様（{店舗名}）', data), '山田 太郎 様（サンプル商店）');
  assert.strictEqual(fillTemplate('電話: {電話番号}。', data), '電話: 。');
  assert.strictEqual(fillTemplate('電話: {電話番号}', data, '（未入力）'), '電話: （未入力）');
  assert.strictEqual(fillTemplate('{存在しない}{お名前}', {}), '');
  assert.strictEqual(fillTemplate(null, data), '');
});

test('fillTemplate は全角かっこ・空白入り・繰り返し・複数回答・数値にも対応する', () => {
  const data = { お名前: '佐藤', ご希望メニュー: ['カット', 'カラー'], 人数: 2 };
  assert.strictEqual(fillTemplate('｛お名前｝様 { お名前 }様 {お名前}', data), '佐藤様 佐藤様 佐藤');
  assert.strictEqual(fillTemplate('{ご希望メニュー}／{人数}名', data), 'カット、カラー／2名');
  assert.strictEqual(fillTemplate('{}と{\n}はそのまま', data), '{}と{\n}はそのまま');
});

test('listPlaceholders と findUnknownPlaceholders でテンプレートのタイプミスを見つける', () => {
  assert.deepStrictEqual(listPlaceholders('{お名前} 様 {お名前} ｛ご希望日時｝'), ['お名前', 'ご希望日時']);
  const templates = [{ kind: '予約', subject: '{店舗名}', body: '{おなまえ} 様 {ご希望日時}' }];
  assert.deepStrictEqual(findUnknownPlaceholders(templates, ['お名前', 'ご希望日時', '店舗名']), [{ kind: '予約', key: 'おなまえ' }]);
});

test('初期のテンプレートは、おすすめのフォームの質問だけで全部埋まる', () => {
  const templates = parseTemplates([['種別', '件名', '本文'], ...DEFAULT_TEMPLATES]);
  assert.strictEqual(templates.length, 3);
  assert.deepStrictEqual(findUnknownPlaceholders(templates, FORM_HEADERS.concat(['店舗名', '署名', '受付番号', '受付日時'])), []);
});

test('renderReply は件名の改行を空白にし、件名が空なら既定の件名を使う', () => {
  const data = { お名前: '山田\n太郎', 店舗名: 'サンプル商店' };
  assert.deepStrictEqual(renderReply({ subject: '{お名前}様 ご予約', body: '{お名前} 様' }, data), {
    subject: '山田 太郎様 ご予約',
    body: '山田\n太郎 様',
  });
  assert.strictEqual(renderReply({ subject: '', body: 'x' }, data).subject, '【サンプル商店】お問い合わせを受け付けました');
});

test('pickTemplate は 完全一致 → 部分一致 → その他 → 先頭 の順で選ぶ', () => {
  const t = [
    { kind: '予約', subject: 'A' },
    { kind: '見積', subject: 'B' },
    { kind: '団体予約', subject: 'C' },
    { kind: 'その他', subject: 'D' },
  ];
  assert.strictEqual(pickTemplate(t, '予約').subject, 'A');
  assert.strictEqual(pickTemplate(t, ' 見積 ').subject, 'B');
  assert.strictEqual(pickTemplate(t, 'ご予約').subject, 'A'); // 部分一致
  assert.strictEqual(pickTemplate(t, '団体予約（10名以上）').subject, 'C'); // 長い種別名を優先
  assert.strictEqual(pickTemplate(t, '取材のご依頼').subject, 'D');
  assert.strictEqual(pickTemplate(t, '').subject, 'D');
  assert.strictEqual(pickTemplate([{ kind: '予約', subject: 'A' }], '見積').subject, 'A'); // その他がなければ先頭
  assert.strictEqual(pickTemplate([], '予約'), null);
});

test('buildTemplateData は回答に 店舗名・署名・受付番号・受付日時 を足す', () => {
  const config = buildConfig({ 店舗名: 'カフェ星', 署名: '--\nカフェ星' });
  const data = buildTemplateData(answers, config, jst('2026-10-06T09:05:12'));
  assert.strictEqual(data['お名前'], '山田 太郎');
  assert.strictEqual(data['店舗名'], 'カフェ星');
  assert.strictEqual(data['署名'], '--\nカフェ星');
  assert.strictEqual(data['受付番号'], '20261006-090512');
  assert.strictEqual(data['受付日時'], '2026/10/06 09:05');
});

// ---- 設定シートの読み取り ----

test('buildConfig は設定シートの値を読み、空欄や欠けた行は初期値で補う', () => {
  const values = [
    ['項目', '値', '説明'],
    ['店舗名', 'カフェ星', ''],
    ['自動返信', '', ''], // 空欄 → 初期値「する」
    ['Slack通知', 'する', ''],
    ['Slack Webhook URL', ` ${SLACK_URL} `, ''],
    ['ChatworkルームID', 'https://www.chatwork.com/#!rid123456', ''],
    ['リマインド対象（経過時間）', '４８時間', ''],
    ['NGワード', 'カジノ、ＳＥＯ，\n相互リンク,カジノ', ''],
    ['返信先アドレス', 'ｉｎｆｏ＠ｅｘａｍｐｌｅ．ｃｏｍ', ''],
    ['種別の項目名', '', ''], // 空欄 → 種別で切り替えない
    ['', '見出しのない行は無視', ''],
  ];
  const c = buildConfig(parseSettings(values), { chatworkToken: 'tok' });
  assert.strictEqual(c.shopName, 'カフェ星');
  assert.strictEqual(c.autoReply, true);
  assert.strictEqual(c.slack.enabled, true);
  assert.strictEqual(c.slack.url, SLACK_URL);
  assert.strictEqual(c.discord.enabled, false); // 行がない → 初期値「しない」
  assert.strictEqual(c.emailField, 'メールアドレス'); // 行がない → 初期値
  assert.strictEqual(c.kindField, '');
  assert.strictEqual(c.chatwork.roomId, '123456');
  assert.strictEqual(c.chatwork.token, 'tok');
  assert.strictEqual(c.reminder.hours, 48);
  assert.strictEqual(c.maxChars, 500);
  assert.deepStrictEqual(c.ngWords, ['カジノ', 'ＳＥＯ', '相互リンク']);
  assert.strictEqual(c.replyTo, 'info@example.com');
  assert.strictEqual(c.responseSheet, 'フォームの回答 1');
});

test('Webhook URL はスクリプトプロパティにあればシートより優先する', () => {
  const c = buildConfig({ 'Slack Webhook URL': 'https://hooks.slack.com/services/sheet' }, { slackUrl: SLACK_URL });
  assert.strictEqual(c.slack.url, SLACK_URL);
});

test('parseBool / parseNumber / splitList / normalizeChatworkRoomId / maskSecret', () => {
  ['する', 'はい', 'ON', 'ｏｎ', 'TRUE', true, '○'].forEach((v) => assert.strictEqual(parseBool(v), true, v));
  ['しない', 'いいえ', 'off', '', null, false].forEach((v) => assert.strictEqual(parseBool(v), false, String(v)));
  assert.strictEqual(parseNumber('２４時間', 0), 24);
  assert.strictEqual(parseNumber('', 7), 7);
  assert.deepStrictEqual(splitList(' 店長 , スタッフA、\nスタッフA '), ['店長', 'スタッフA']);
  assert.strictEqual(normalizeChatworkRoomId('123456'), '123456');
  assert.strictEqual(normalizeChatworkRoomId('rid123456'), '123456');
  assert.strictEqual(normalizeChatworkRoomId('https://www.chatwork.com/#!rid１２３'), '123');
  assert.strictEqual(normalizeChatworkRoomId('マイチャット'), '');
  assert.strictEqual(maskSecret('abcdefghijklmnopqrstuvwxyz012345'), 'abcd…（32文字）');
  assert.ok(!maskSecret('abc').includes('abc'));
});

// ---- メールアドレス・スパム判定 ----

test('isValidEmail は実用上のメールアドレスを判定する（携帯キャリアの古い形式も通す）', () => {
  ['taro@example.com', 'taro.yamada+shop@mail.example.co.jp', 'abc..def@docomo.ne.jp', 'abc.@ezweb.ne.jp'].forEach((v) =>
    assert.strictEqual(isValidEmail(v), true, v)
  );
  [
    '',
    'taro',
    'taro@',
    '@example.com',
    'taro@example',
    'taro@@example.com',
    'taro@exa mple.com',
    'たろう@example.com',
    'taro@example.c',
    '...@example.com',
    `${'a'.repeat(65)}@example.com`,
    null,
  ].forEach((v) => assert.strictEqual(isValidEmail(v), false, String(v)));
});

test('normalizeEmail は全角・空白・mailto: を整える', () => {
  assert.strictEqual(normalizeEmail(' ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ '), 'taro@example.com');
  assert.strictEqual(normalizeEmail('taro @example.com'), 'taro@example.com');
  assert.strictEqual(normalizeEmail('mailto:taro@example.com'), 'taro@example.com');
  assert.strictEqual(normalizeEmail(undefined), '');
});

test('checkSpam: 正常な問い合わせはスパム扱いしない', () => {
  const r = checkSpam(answers, { email: 'taro@example.com', ngWords: ['カジノ', 'casino'] });
  assert.deepStrictEqual(r, { isSpam: false, reasons: [], ngHits: [] });
});

test('checkSpam: NGワードは大文字小文字・全角半角を区別せずに見つける', () => {
  const spam = [
    { label: 'お名前', value: 'ＣＡＳＩＮＯ運営事務局' },
    { label: 'お問い合わせ内容', value: 'ｵﾝﾗｲﾝｶｼﾞﾉのご案内' },
  ];
  const r = checkSpam(spam, { email: 'x@example.com', ngWords: ['casino', 'カジノ', '相互リンク'] });
  assert.strictEqual(r.isSpam, true);
  assert.deepStrictEqual(r.ngHits, ['casino', 'カジノ']);
  assert.match(r.reasons[0], /NGワード「casino」「カジノ」/);
});

test('checkSpam: メールアドレスが不正・空ならスパム疑い（メール欄のないフォームは requireEmail:false）', () => {
  assert.match(checkSpam(answers, { email: 'taro@', ngWords: [] }).reasons[0], /形式が正しくありません（taro@）/);
  assert.match(checkSpam(answers, { email: '', ngWords: [] }).reasons[0], /空です/);
  assert.strictEqual(checkSpam(answers, { email: '', ngWords: [], requireEmail: false }).isSpam, false);
  const both = checkSpam([{ label: '内容', value: '相互リンクのお願い' }], { email: 'bad', ngWords: ['相互リンク'] });
  assert.strictEqual(both.reasons.length, 2);
});

// ---- 回答の並び・管理列 ----

test('orderAnswers はシートの列順に並べ、タイムスタンプと管理列を除き、複数回答をつなぐ', () => {
  const headers = ['タイムスタンプ', 'お名前', 'メールアドレス', 'ご希望メニュー', 'お問い合わせ内容', '対応状況', '担当', '処理ログ'];
  const namedValues = {
    お問い合わせ内容: ['よろしくお願いします'],
    タイムスタンプ: ['2026/10/06 9:00:00'],
    'お名前 ': ['山田'], // 見出しの前後の空白は無視
    ご希望メニュー: ['カット', 'カラー'],
    メールアドレス: ['taro@example.com'],
    後から追加した質問: ['あり'],
  };
  const exclude = ['対応状況', '担当', '処理ログ', 'タイムスタンプ'];
  const r = orderAnswers(headers, namedValues, exclude);
  assert.deepStrictEqual(
    r.map((a) => a.label),
    ['お名前', 'メールアドレス', 'ご希望メニュー', 'お問い合わせ内容', '後から追加した質問']
  );
  assert.strictEqual(r[2].value, 'カット、カラー');
  assert.deepStrictEqual(zipAnswers(['A', '', 'B'], ['1', '2']), { A: ['1'] });
});

test('findAnswer は設定チェックと同じ基準（全角半角・空白を無視）で回答を探す', () => {
  const list = [
    { label: 'Eメール', value: 'a@example.com' },
    { label: 'お 名前', value: '山田' },
  ];
  assert.strictEqual(findAnswer(list, 'Ｅメール'), 'a@example.com');
  assert.strictEqual(findAnswer(list, 'お名前'), '山田');
  assert.strictEqual(findAnswer(list, ''), '');
  assert.strictEqual(findAnswer(list, '電話番号'), '');
  // 設定チェックで OK と言われる書き方なら、実際の処理でも見つかる
  const c = buildConfig({ メールアドレスの項目名: 'Ｅメール', お名前の項目名: 'お名前', 種別の項目名: '' });
  c.templates = parseTemplates([['種別', '件名', '本文'], ['その他', '件名', '本文']]);
  assert.doesNotMatch(validateConfig(c, ['タイムスタンプ', 'お 名前', 'Eメール']).join('\n'), /見つかりません/);
});

test('planManagementColumns は既存の列を使い、ない列だけ右端に足す', () => {
  assert.deepStrictEqual(planManagementColumns(['タイムスタンプ', 'お名前', '', ''], ['対応状況', '担当', '処理ログ']), {
    cols: { 対応状況: 3, 担当: 4, 処理ログ: 5 },
    toAdd: [
      { name: '対応状況', col: 3 },
      { name: '担当', col: 4 },
      { name: '処理ログ', col: 5 },
    ],
  });
  assert.deepStrictEqual(planManagementColumns(['タイムスタンプ', '対応状況', 'お名前'], ['対応状況', '担当']), {
    cols: { 対応状況: 2, 担当: 4 },
    toAdd: [{ name: '担当', col: 4 }],
  });
});

// ---- 日付 ----

test('formatDateJst / makeReceiptNo は実行環境のタイムゾーンに関係なく日本時間で書く', () => {
  assert.strictEqual(formatDateJst(jst('2026-01-02T03:04:05')), '2026/01/02 03:04');
  assert.strictEqual(makeReceiptNo(jst('2026-01-02T03:04:05')), '20260102-030405');
  assert.strictEqual(formatDateJst(new Date('2026-10-05T23:30:00Z')), '2026/10/06 08:30'); // UTC では前日
  assert.strictEqual(formatDateJst('日付ではない'), '');
  assert.strictEqual(makeReceiptNo(null), '');
});

test('sheetLink はシートと行を開くリンクを作る', () => {
  assert.strictEqual(sheetLink('https://docs.google.com/spreadsheets/d/x/edit#gid=9', 0, 5), 'https://docs.google.com/spreadsheets/d/x/edit#gid=0&range=A5');
  assert.strictEqual(sheetLink('https://docs.google.com/spreadsheets/d/x/edit', 12), 'https://docs.google.com/spreadsheets/d/x/edit#gid=12');
});

// ---- 未対応リマインド ----

const NOW = jst('2026-10-06T09:00:00');
const sheetValues = [
  ['タイムスタンプ', 'お名前', 'メールアドレス', 'お問い合わせ種別', 'お問い合わせ内容', '対応状況', '担当', '処理ログ'],
  [jst('2026-10-04T10:00:00'), '古い未対応', 'a@example.com', '予約', '', '未対応', '', ''], // 47時間
  [jst('2026-10-05T09:00:00'), 'ちょうど24時間', 'b@example.com', '見積', '', '未対応', '店長', ''],
  [jst('2026-10-05T09:00:01'), '24時間まで1秒', 'c@example.com', '予約', '', '未対応', '', ''],
  [jst('2026-10-03T09:00:00'), '対応中', 'd@example.com', '予約', '', '対応中', '店長', ''],
  [jst('2026-10-02T09:00:00'), '完了', 'e@example.com', '予約', '', '完了', '店長', ''],
  [jst('2026-10-01T09:00:00'), 'スパム', 'f@example.com', '', '', 'スパム疑い', '', ''],
  [jst('2026-09-30T09:00:00'), '状況が空欄', 'g@example.com', '', '', '', '', ''],
  ['', '日付なし', 'h@example.com', '', '', '未対応', '', ''],
  [jst('2026-10-06T10:00:00'), '未来の日時', 'i@example.com', '', '', '未対応', '', ''],
  [jst('2026-10-05T06:00:00'), '前後に空白', 'j@example.com', 'その他', '', ' 未対応 ', '', ''], // 27時間
];
const reminderConfig = buildConfig({});

test('filterOverdue は「未対応」で N 時間以上たったものだけを古い順に返す（固定の日時で確認）', () => {
  const overdue = filterOverdue(toInquiryItems(sheetValues, reminderConfig), NOW, 24);
  assert.deepStrictEqual(
    overdue.map((it) => [it.name, it.row, it.elapsedHours]),
    [
      ['古い未対応', 2, 47],
      ['前後に空白', 11, 27],
      ['ちょうど24時間', 3, 24],
    ]
  );
  assert.strictEqual(filterOverdue(toInquiryItems(sheetValues, reminderConfig), NOW, 48).length, 0);
  assert.strictEqual(filterOverdue(toInquiryItems(sheetValues, reminderConfig), NOW, 1).length, 4); // 1秒差も入る
});

test('toInquiryItems は必要な列がなければ空を返す', () => {
  assert.deepStrictEqual(toInquiryItems([['タイムスタンプ', 'お名前'], [NOW, 'x']], reminderConfig), []);
  assert.deepStrictEqual(toInquiryItems([], reminderConfig), []);
});

test('buildReminderMessage は件数・経過時間・担当・行番号を並べ、多いときは「ほか○件」', () => {
  const overdue = filterOverdue(toInquiryItems(sheetValues, reminderConfig), NOW, 24);
  const m = buildReminderMessage(overdue, { hours: 24, url: 'https://example.com/sheet' });
  assert.strictEqual(m.title, '【未対応リマインド】24時間以上たった未対応が 3件 あります');
  assert.strictEqual(m.fields[0].label, '[予約] 古い未対応 様');
  assert.strictEqual(m.fields[0].value, '受付 2026/10/04 10:00（47時間経過）／担当: 未定／2行目');
  assert.match(m.fields[2].value, /担当: 店長/);

  const many = Array.from({ length: 25 }, (_, i) => ({ row: i + 2, timestamp: NOW, name: `客${i}`, kind: '', assignee: '', elapsedHours: 30 }));
  const m2 = buildReminderMessage(many, { hours: 24, maxItems: 20 });
  assert.strictEqual(m2.fields.length, 21);
  assert.strictEqual(m2.fields[20].label, 'ほか 5件');
});

// ---- 通知メッセージ（Slack / Discord / Chatwork） ----

test('buildInquiryMessage はタイトル・受付番号・回答を並べる', () => {
  assert.strictEqual(message.title, '【新着問い合わせ】予約／山田 太郎 様');
  assert.deepStrictEqual(message.fields.slice(0, 3), [
    { label: '受付番号', value: '20261006-090512' },
    { label: '受付日時', value: '2026/10/06 09:05' },
    { label: 'お名前', value: '山田 太郎' },
  ]);
  const long = buildInquiryMessage([{ label: '内容', value: 'あ'.repeat(1000) }], { maxChars: 100 });
  assert.strictEqual(long.title, '【新着問い合わせ】お名前なし');
  assert.strictEqual(long.fields[0].value.length, 100);
  assert.ok(long.fields[0].value.endsWith('…'));
});

test('buildSlackPayload は text と blocks（header / section / context）の形にする', () => {
  const p = buildSlackPayload(message);
  assert.strictEqual(p.text, message.title);
  assert.deepStrictEqual(
    p.blocks.map((b) => b.type),
    ['header', 'section', 'context']
  );
  assert.deepStrictEqual(p.blocks[0].text, { type: 'plain_text', text: message.title, emoji: true });
  assert.strictEqual(p.blocks[1].text.type, 'mrkdwn');
  assert.match(p.blocks[1].text.text, /\*お名前\*\n山田 太郎/);
  assert.match(p.blocks[1].text.text, /\*電話番号\*\n090-0000-0000/);
  assert.strictEqual(p.blocks[2].elements[0].text, `<${message.url}|スプレッドシートを開く>`);
});

test('buildSlackPayload は <!channel> などを無効にし、長い内容を Slack の上限に収める', () => {
  const p = buildSlackPayload({
    title: '<!channel> '.repeat(30),
    fields: [
      { label: '内容', value: '<!channel> & <https://evil.example|click>' },
      { label: '長文', value: 'あ'.repeat(5000) },
      { label: '空欄', value: '' },
    ],
    url: '',
  });
  assert.ok(!p.text.includes('<!channel>'));
  assert.match(p.blocks[1].text.text, /&lt;!channel&gt; &amp; &lt;https:\/\/evil\.example\|click&gt;/);
  assert.ok(p.blocks[0].text.text.length <= 150);
  assert.ok(p.blocks[1].text.text.length <= 3000);
  assert.strictEqual(p.blocks.length, 2); // URL がなければ context なし
});

test('buildDiscordPayload は content と embeds[0].fields の形にし、メンションを無効にする', () => {
  const p = buildDiscordPayload(Object.assign({}, message, { fields: message.fields.concat([{ label: '空欄', value: '  ' }]) }));
  assert.strictEqual(p.content, message.title);
  assert.deepStrictEqual(p.allowed_mentions, { parse: [] });
  assert.strictEqual(p.embeds.length, 1);
  const e = p.embeds[0];
  assert.strictEqual(e.url, message.url);
  assert.strictEqual(e.title, 'スプレッドシートを開く');
  assert.strictEqual(typeof e.color, 'number');
  assert.deepStrictEqual(e.fields[2], { name: 'お名前', value: '山田 太郎', inline: false });
  assert.strictEqual(e.fields.at(-1).value, '（未入力）'); // Discord は空の値を受け付けない
});

test('buildDiscordPayload は項目が多く長くても Discord の上限（25項目・1項目1024字・合計6000字）に収まる', () => {
  const fields = Array.from({ length: 40 }, (_, i) => ({ label: `質問${i}`, value: 'い'.repeat(2000) }));
  const p = buildDiscordPayload({ kind: 'inquiry', title: 'x'.repeat(3000), fields, url: 'https://example.com' });
  const e = p.embeds[0];
  assert.ok(p.content.length <= 2000);
  assert.ok(e.fields.length <= 25);
  e.fields.forEach((f) => assert.ok(f.value.length <= 1024 && f.name.length <= 256));
  const total = e.title.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(total <= 6000, `合計 ${total} 文字`);
});

test('buildChatworkRequest は API の URL・トークンのヘッダー・[info] 形式の本文を作る', () => {
  const tricky = Object.assign({}, message, { fields: [{ label: 'お名前', value: '[toall][To:123]山田' }] });
  const req = buildChatworkRequest('123456', 'secret-token', tricky);
  assert.strictEqual(req.url, 'https://api.chatwork.com/v2/rooms/123456/messages');
  assert.strictEqual(req.params.method, 'post');
  assert.deepStrictEqual(req.params.headers, { 'X-ChatWorkToken': 'secret-token' });
  assert.deepStrictEqual(Object.keys(req.params.payload), ['body']);
  const body = req.params.payload.body;
  assert.ok(body.startsWith(`[info][title]${message.title}[/title]`));
  assert.ok(body.endsWith(`${message.url}[/info]`));
  assert.match(body, /■お名前\n［toall］［To:123］山田/); // 回答の中のタグは全角にして無効化
});

test('buildSlackRequest / buildDiscordRequest は JSON を POST する', () => {
  [buildSlackRequest(SLACK_URL, message), buildDiscordRequest(DISCORD_URL, message)].forEach((req) => {
    assert.strictEqual(req.params.method, 'post');
    assert.strictEqual(req.params.contentType, 'application/json');
    assert.doesNotThrow(() => JSON.parse(req.params.payload));
  });
  assert.strictEqual(buildSlackRequest(SLACK_URL, message).url, SLACK_URL);
});

test('buildNotifyRequests は「する」の通知先だけを作り、設定が足りないものは error にする', () => {
  const base = buildConfig({});
  assert.deepStrictEqual(buildNotifyRequests(base, message), []);

  const c = buildConfig(
    { Slack通知: 'する', 'Slack Webhook URL': SLACK_URL, Discord通知: 'する', Chatwork通知: 'する', ChatworkルームID: '99' },
    {}
  );
  const reqs = buildNotifyRequests(c, message);
  assert.deepStrictEqual(
    reqs.map((r) => [r.service, r.error || 'ok']),
    [
      ['Slack', 'ok'],
      ['Discord', 'Webhook URL が未設定です'],
      ['Chatwork', 'APIトークンが未登録です（メニュー「Chatworkトークンを登録」）'],
    ]
  );
});

test('truncate は絵文字（サロゲートペア）の途中で切らない', () => {
  assert.strictEqual(truncate('abc', 5), 'abc');
  assert.strictEqual(truncate('abcdef', 4), 'abc…');
  assert.strictEqual(truncate('a😀😀', 3), 'a…');
  assert.strictEqual(truncate('abc', 0), '');
});

// ---- 設定チェック ----

test('validateConfig は初期設定のままなら「チャット通知なし」だけを知らせる', () => {
  const c = buildConfig({});
  c.templates = parseTemplates([['種別', '件名', '本文'], ...DEFAULT_TEMPLATES]);
  const w = validateConfig(c, FORM_HEADERS);
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /チャット通知が1つも「する」になっていません/);
});

test('validateConfig は書き間違いを直し方つきで知らせる', () => {
  const c = buildConfig({
    お名前の項目名: '氏名',
    Slack通知: 'する',
    'Slack Webhook URL': 'https://example.com/hook',
    Discord通知: 'する',
    'Discord Webhook URL': DISCORD_URL,
    Chatwork通知: 'する',
    自動返信のBCC: 'owner@',
    'リマインド対象（経過時間）': '0',
  });
  c.templates = [{ kind: '予約', subject: '{店舗名}', body: '{おなまえ} 様' }];
  const w = validateConfig(c, FORM_HEADERS).join('\n');
  assert.match(w, /「お名前の項目名」の「氏名」がフォームの質問に見つかりません/);
  assert.match(w, /返信テンプレート「予約」の \{おなまえ\}/);
  assert.match(w, /Slack Webhook URL は https:\/\/hooks\.slack\.com\//);
  assert.doesNotMatch(w, /Discord Webhook URL/);
  assert.match(w, /ChatworkルームIDが空/);
  assert.match(w, /APIトークンが未登録/);
  assert.match(w, /「自動返信のBCC」のメールアドレスの形式/);
  assert.match(w, /1以上の数字/);
  assert.match(validateConfig(c, []).join('\n'), /回答シート「フォームの回答 1」が見つかりません/);
});

test('sampleAnswers は回答シートの質問ごとにテスト用の値を入れる', () => {
  const c = buildConfig({});
  const r = sampleAnswers(FORM_HEADERS.concat(['対応状況']), c, '見積', 'me@example.com');
  const map = Object.fromEntries(r.map((a) => [a.label, a.value]));
  assert.strictEqual(map['メールアドレス'], 'me@example.com');
  assert.strictEqual(map['お問い合わせ種別'], '見積');
  assert.strictEqual(map['電話番号'], '（電話番号のテスト入力）');
  assert.ok(!('タイムスタンプ' in map) && !('対応状況' in map));
});

// =====================================================================
// ここから: Google のサービスをモックにした通しの動作確認（スモークテスト）
// 実際の Google 環境の動きまでは再現しない。コードの流れ（どの順に何を呼ぶか）を確かめるためのもの。
// =====================================================================

/** どのメソッドを呼んでも自分を返す（書式設定やビルダーの代わり）。build() だけは onBuild の結果 */
function chainable(onBuild) {
  const proxy = new Proxy({}, { get: (_, prop) => (prop === 'build' ? () => (onBuild ? onBuild() : {}) : () => proxy) });
  return proxy;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getRow() {
    return this.row;
  }
  getColumn() {
    return this.col;
  }
  getSheet() {
    return this.sheet;
  }
  getValues() {
    return Array.from({ length: this.numRows }, (_, r) => Array.from({ length: this.numCols }, (_, c) => this.sheet.cell(this.row + r, this.col + c)));
  }
  getValue() {
    return this.sheet.cell(this.row, this.col);
  }
  setValues(values) {
    values.forEach((r, i) => r.forEach((v, j) => this.sheet.set(this.row + i, this.col + j, v)));
    return this;
  }
  setValue(v) {
    this.sheet.set(this.row, this.col, v);
    return this;
  }
  setDataValidation(rule) {
    this.sheet.validations.push({ row: this.row, col: this.col, numRows: this.numRows });
    return this;
  }
}

/** 定義していないメソッド（setFontWeight など）は何もせず自分を返す */
function rangeProxy(range) {
  const p = new Proxy(range, { get: (t, prop) => (prop in t ? t[prop] : () => p) });
  return p;
}

class FakeSheet {
  constructor(name, rows, id, maxCols) {
    this.name = name;
    this.rows = rows.map((r) => r.slice());
    this.id = id;
    this.maxRows = 1000;
    this.maxCols = maxCols || Math.max(1, ...rows.map((r) => r.length));
    this.validations = [];
    this.cfRules = [];
  }
  getName() {
    return this.name;
  }
  getSheetId() {
    return this.id;
  }
  cell(r, c) {
    const row = this.rows[r - 1];
    return row && row[c - 1] !== undefined ? row[c - 1] : '';
  }
  set(r, c, v) {
    if (c > this.maxCols) throw new Error(`列 ${c} はシートの範囲外です（最大 ${this.maxCols}）`);
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some((v) => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.rows.forEach((r) => r.forEach((v, i) => (v !== '' && v != null && i + 1 > m ? (m = i + 1) : 0)));
    return m;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  insertColumnsAfter(after, n) {
    this.maxCols += n;
    return this;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (c + nc - 1 > this.maxCols) throw new Error(`列 ${c + nc - 1} はシートの範囲外です（最大 ${this.maxCols}）`);
    return rangeProxy(new FakeRange(this, r, c, nr, nc));
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  getConditionalFormatRules() {
    return this.cfRules;
  }
  setConditionalFormatRules(rules) {
    this.cfRules = rules;
  }
  setFrozenRows() {
    return this;
  }
  setColumnWidth() {
    return this;
  }
  /** テスト用: 見出し名でセルを読む */
  get(row, header) {
    return this.cell(row, this.rows[0].indexOf(header) + 1);
  }
}

class FakeSpreadsheet {
  constructor(sheets) {
    this.sheets = sheets;
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.getName() === name) || null;
  }
  getSheets() {
    return this.sheets.slice();
  }
  insertSheet(name) {
    const s = new FakeSheet(name, [], 100 + this.sheets.length, 26);
    this.sheets.push(s);
    return s;
  }
  getUrl() {
    return 'https://docs.google.com/spreadsheets/d/TEST/edit';
  }
}

/** GAS のグローバル（SpreadsheetApp など）をモックに差し替える。呼ばれた内容は env に記録する */
function installGas(ss, props) {
  const env = { mails: [], fetches: [], triggers: [], alerts: [], props: Object.assign({}, props), status: () => 200 };
  const globals = {
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => ({ alert: (m) => env.alerts.push(m) }),
      newDataValidation: () => chainable(),
      newConditionalFormatRule: () => chainable(() => ({ getRanges: () => [] })),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: (fn) => {
        env.triggers.push(fn);
        return chainable();
      },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in env.props ? env.props[k] : null),
        setProperty: (k, v) => (env.props[k] = v),
        deleteProperty: (k) => delete env.props[k],
      }),
    },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (o) => env.mails.push(o) },
    UrlFetchApp: {
      fetch: (url, params) => {
        env.fetches.push({ url, params });
        const code = env.status(url);
        return { getResponseCode: () => code, getContentText: () => (code < 300 ? 'ok' : 'no_service') };
      },
    },
    Utilities: { sleep: () => {} },
  };
  Object.assign(globalThis, globals);
  env.restore = () => Object.keys(globals).forEach((k) => delete globalThis[k]);
  return env;
}

/** フォームの回答シートだけがあるスプレッドシートで setupAll を実行した状態を作る */
function setupShop(t) {
  const resp = new FakeSheet('フォームの回答 1', [FORM_HEADERS], 0);
  const ss = new FakeSpreadsheet([resp]);
  const env = installGas(ss, { CHATWORK_API_TOKEN: 'cw-token-123' });
  t.after(() => env.restore());
  G.setupAll();
  return { ss, resp, env };
}

function setSetting(ss, key, value) {
  const row = ss.getSheetByName('設定').rows.find((r) => r[0] === key);
  assert.ok(row, `設定の項目「${key}」がありません`);
  row[1] = value;
}

function enableAllChats(ss) {
  setSetting(ss, 'Slack通知', 'する');
  setSetting(ss, 'Slack Webhook URL', SLACK_URL);
  setSetting(ss, 'Discord通知', 'する');
  setSetting(ss, 'Discord Webhook URL', DISCORD_URL);
  setSetting(ss, 'Chatwork通知', 'する');
  setSetting(ss, 'ChatworkルームID', '123456');
}

/** Google フォームが回答シートに1行書き込んだ状態を作り、トリガーに渡るイベント e を返す */
function submit(resp, values, at) {
  const row = resp.getLastRow() + 1;
  const cells = FORM_HEADERS.map((h) => (h === 'タイムスタンプ' ? at : values[h] || ''));
  cells.forEach((v, i) => resp.set(row, i + 1, v));
  const namedValues = {};
  FORM_HEADERS.forEach((h, i) => (namedValues[h] = [h === 'タイムスタンプ' ? '2026/10/06 9:05:12' : String(cells[i])]));
  return { range: resp.getRange(row, 1, 1, FORM_HEADERS.length), namedValues, values: cells.map(String) };
}

const customer = {
  お名前: '山田 太郎',
  メールアドレス: 'ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ',
  電話番号: '090-0000-0000',
  お問い合わせ種別: 'ご予約',
  ご希望日時: '10月10日 14:00',
  お問い合わせ内容: 'カットの予約をお願いします。',
};

test('[モック] setupAll は設定シート・テンプレート・管理列・トリガーを用意する', (t) => {
  const { ss, resp, env } = setupShop(t);
  assert.ok(ss.getSheetByName('設定'));
  assert.strictEqual(ss.getSheetByName('返信テンプレート').getLastRow(), 4);
  assert.deepStrictEqual(resp.rows[0].slice(7), ['対応状況', '担当', '処理ログ']);
  assert.deepStrictEqual(env.triggers, ['onFormSubmit', 'sendDailyReminder']);
  assert.ok(resp.validations.some((v) => v.col === 8 && v.row === 2)); // 対応状況のプルダウン
  assert.ok(resp.validations.some((v) => v.col === 9 && v.row === 2)); // 担当のプルダウン
  assert.strictEqual(resp.cfRules.length, 4); // 対応状況の色分け
  assert.match(env.alerts[0], /初期設定が完了しました/);

  // 2回目を実行しても列や設定行は増えない
  const settingRows = ss.getSheetByName('設定').getLastRow();
  G.setupAll();
  assert.strictEqual(resp.getLastColumn(), 10);
  assert.strictEqual(ss.getSheetByName('設定').getLastRow(), settingRows);
});

test('[モック] フォーム送信 → 自動返信 → Slack/Discord/Chatwork 通知 → 未対応・処理ログ', (t) => {
  const { ss, resp, env } = setupShop(t);
  enableAllChats(ss);
  setSetting(ss, '自動返信のBCC', 'owner@example.com');
  const e = submit(resp, customer, jst('2026-10-06T09:05:12'));
  G.onFormSubmit(e);

  assert.strictEqual(env.mails.length, 1);
  const mail = env.mails[0];
  assert.strictEqual(mail.to, 'taro@example.com'); // 全角で入力されても半角に直して送る
  assert.strictEqual(mail.bcc, 'owner@example.com');
  assert.strictEqual(mail.name, 'サンプル商店');
  assert.strictEqual(mail.subject, '【サンプル商店】ご予約のお問い合わせを受け付けました（受付番号 20261006-090512）');
  assert.match(mail.body, /^山田 太郎 様\n/);
  assert.match(mail.body, /■ご希望日時：10月10日 14:00/);
  assert.match(mail.body, /カットの予約をお願いします。/);
  assert.doesNotMatch(mail.body, /[{｛]/); // 差し込みが残っていない

  assert.deepStrictEqual(
    env.fetches.map((f) => f.url),
    [SLACK_URL, DISCORD_URL, 'https://api.chatwork.com/v2/rooms/123456/messages']
  );
  const slack = JSON.parse(env.fetches[0].params.payload);
  assert.strictEqual(slack.text, '【新着問い合わせ】ご予約／山田 太郎 様');
  assert.match(slack.blocks[2].elements[0].text, /#gid=0&range=A2\|/); // その行へのリンク
  assert.strictEqual(env.fetches[2].params.headers['X-ChatWorkToken'], 'cw-token-123');

  assert.strictEqual(resp.get(2, '対応状況'), '未対応');
  const log = resp.get(2, '処理ログ');
  assert.match(log, /返信: 送信済（予約）/);
  assert.match(log, /Slack: OK \/ Discord: OK \/ Chatwork: OK/);

  // トリガーが二重に起動しても、2回目は何もしない
  G.onFormSubmit(e);
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.fetches.length, 3);
});

test('[モック] 1つの通知先が失敗しても、ほかの通知と返信は続ける', (t) => {
  const { ss, resp, env } = setupShop(t);
  enableAllChats(ss);
  env.status = (url) => (url === SLACK_URL ? 404 : 200);
  G.onFormSubmit(submit(resp, customer, jst('2026-10-06T09:05:12')));
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.fetches.length, 3);
  assert.match(resp.get(2, '処理ログ'), /Slack: 失敗（HTTP 404 no_service）/);
  assert.match(resp.get(2, '処理ログ'), /Discord: OK/);
});

test('[モック] 混雑（HTTP 429）のときは1回だけ再送する', (t) => {
  const { ss, resp, env } = setupShop(t);
  setSetting(ss, 'Slack通知', 'する');
  setSetting(ss, 'Slack Webhook URL', SLACK_URL);
  let calls = 0;
  env.status = () => (++calls === 1 ? 429 : 200);
  G.onFormSubmit(submit(resp, customer, jst('2026-10-06T09:05:12')));
  assert.strictEqual(env.fetches.length, 2);
  assert.match(resp.get(2, '処理ログ'), /Slack: OK/);
});

test('[モック] NGワードを含む送信はスパム疑いにして、返信も通知もしない', (t) => {
  const { ss, resp, env } = setupShop(t);
  enableAllChats(ss);
  G.onFormSubmit(submit(resp, Object.assign({}, customer, { お問い合わせ内容: 'オンラインカジノのご案内' }), jst('2026-10-06T09:05:12')));
  assert.strictEqual(env.mails.length, 0);
  assert.strictEqual(env.fetches.length, 0);
  assert.strictEqual(resp.get(2, '対応状況'), 'スパム疑い');
  assert.match(resp.get(2, '処理ログ'), /スパム疑いのため返信・通知なし（NGワード「カジノ」を含みます）/);
});

test('[モック] メールアドレスが不正な送信もスパム疑いにする', (t) => {
  const { ss, resp, env } = setupShop(t);
  enableAllChats(ss);
  G.onFormSubmit(submit(resp, Object.assign({}, customer, { メールアドレス: 'taro@example' }), jst('2026-10-06T09:05:12')));
  assert.strictEqual(env.mails.length + env.fetches.length, 0);
  assert.strictEqual(resp.get(2, '対応状況'), 'スパム疑い');
  assert.match(resp.get(2, '処理ログ'), /メールアドレスの形式が正しくありません/);
});

test('[モック] 自動返信「しない」・通知なしでも、対応状況は未対応になる', (t) => {
  const { ss, resp, env } = setupShop(t);
  setSetting(ss, '自動返信', 'しない');
  G.onFormSubmit(submit(resp, customer, jst('2026-10-06T09:05:12')));
  assert.strictEqual(env.mails.length + env.fetches.length, 0);
  assert.strictEqual(resp.get(2, '対応状況'), '未対応');
  assert.match(resp.get(2, '処理ログ'), /処理完了/);
});

test('[モック] 設定の項目名が全角・空白違いでも、メールアドレスと種別を見つけて返信する', (t) => {
  const { ss, resp, env } = setupShop(t);
  setSetting(ss, 'メールアドレスの項目名', 'メール アドレス');
  setSetting(ss, '種別の項目名', 'お問い合わせ種別　'); // 全角スペースつき
  G.onFormSubmit(submit(resp, Object.assign({}, customer, { お問い合わせ種別: '見積' }), jst('2026-10-06T09:05:12')));
  assert.strictEqual(resp.get(2, '対応状況'), '未対応');
  assert.strictEqual(env.mails.length, 1);
  assert.match(env.mails[0].subject, /お見積りのご依頼/);
});

test('[モック] エディタから onFormSubmit を直接実行すると、分かりやすいエラーにする', (t) => {
  setupShop(t);
  assert.throws(() => G.onFormSubmit(), /フォーム送信時に自動で動く関数です/);
});

test('[モック] 毎日のリマインドは、時間がたった未対応だけをチャットに送る', (t) => {
  const { ss, resp, env } = setupShop(t);
  setSetting(ss, 'Discord通知', 'する');
  setSetting(ss, 'Discord Webhook URL', DISCORD_URL);
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
  [
    [hoursAgo(30), '佐藤', '未対応'],
    [hoursAgo(2), '鈴木', '未対応'],
    [hoursAgo(50), '高橋', '完了'],
  ].forEach(([at, name, status]) => {
    submit(resp, Object.assign({}, customer, { お名前: name }), at);
    resp.set(resp.getLastRow(), 8, status);
  });

  G.sendDailyReminder();
  assert.strictEqual(env.fetches.length, 1);
  const discord = JSON.parse(env.fetches[0].params.payload);
  assert.strictEqual(discord.content, '【未対応リマインド】24時間以上たった未対応が 1件 あります');
  assert.match(discord.embeds[0].fields[0].name, /佐藤 様/);

  // 「未対応リマインド」を「しない」にすると、毎日のリマインドは送らない（メニューからは送れる）
  setSetting(ss, '未対応リマインド', 'しない');
  G.sendDailyReminder();
  assert.strictEqual(env.fetches.length, 1);
  assert.strictEqual(G.runReminder_({ force: true }).sent, 1);
  assert.strictEqual(env.fetches.length, 2);
});
