/**
 * 問い合わせ・予約フォームの「自動返信 ＋ チャット通知 ＋ 対応管理」を行う Google Apps Script。
 *
 * できること:
 *  1. フォーム送信時に、お客様へ自動返信メール（「予約」「見積」など種別ごとに文面を切り替え）
 *  2. Slack / Discord / Chatwork へ新着通知（どれを使うかは「設定」シートで選ぶ。複数同時も可）
 *  3. 回答シートに「対応状況」「担当」列（プルダウン）と「処理ログ」列を追加
 *  4. 毎日9時に、一定時間たっても「未対応」のままの問い合わせをチャットでリマインド
 *  5. メールアドレスが不正・NGワードを含む送信は「スパム疑い」にして、返信と通知を止める
 *
 * 前提: Googleフォームの回答先スプレッドシートに、このスクリプトを設定する（拡張機能 → Apps Script）。
 * 最初に setupAll を1回実行する（設定シートの作成・管理列の追加・トリガー登録をまとめて行う）。
 * 文面や通知先は「設定」「返信テンプレート」シートで変える。コードを書き換える必要はない。
 * Chatwork の APIトークンだけはシートに書かず、スクリプトプロパティに保存する。
 */

const CONFIG = {
  settingsSheet: '設定',
  templateSheet: '返信テンプレート',
  defaultResponseSheet: 'フォームの回答 1',
  timestampHeaders: ['タイムスタンプ', 'Timestamp'],
  // 回答シートの右端に追加する管理用の列
  columns: { status: '対応状況', assignee: '担当', log: '処理ログ' },
  status: { todo: '未対応', doing: '対応中', done: '完了', spam: 'スパム疑い' },
  reminderHour: 9, // 毎日この時刻（日本時間）に未対応をリマインドする
  reminderMaxItems: 20, // リマインドに並べる最大件数（残りは「ほか○件」）
  // スクリプトプロパティのキー（Chatwork トークンは必ずこちら。Webhook URL も任意でこちらに置ける）
  props: { chatworkToken: 'CHATWORK_API_TOKEN', slackUrl: 'SLACK_WEBHOOK_URL', discordUrl: 'DISCORD_WEBHOOK_URL' },
  chatworkApiBase: 'https://api.chatwork.com/v2',
  triggerHandlers: ['onFormSubmit', 'sendDailyReminder'],
};

const STATUS_LIST = [CONFIG.status.todo, CONFIG.status.doing, CONFIG.status.done, CONFIG.status.spam];
const MANAGEMENT_HEADERS = [CONFIG.columns.status, CONFIG.columns.assignee, CONFIG.columns.log];

// 「設定」シートの項目名（A列）
const KEY = {
  shopName: '店舗名',
  responseSheet: '回答シート名',
  nameField: 'お名前の項目名',
  emailField: 'メールアドレスの項目名',
  kindField: '種別の項目名',
  autoReply: '自動返信',
  senderName: '差出人名',
  replyTo: '返信先アドレス',
  bcc: '自動返信のBCC',
  signature: '署名',
  slackEnabled: 'Slack通知',
  slackUrl: 'Slack Webhook URL',
  discordEnabled: 'Discord通知',
  discordUrl: 'Discord Webhook URL',
  chatworkEnabled: 'Chatwork通知',
  chatworkRoomId: 'ChatworkルームID',
  maxChars: '通知の文字数上限',
  reminderEnabled: '未対応リマインド',
  reminderHours: 'リマインド対象（経過時間）',
  ngWords: 'NGワード',
  staff: '担当者リスト',
};

// 「設定」シートの初期値 [項目, 値, 説明]
const DEFAULT_SETTINGS = [
  [KEY.shopName, 'サンプル商店', '返信メールの {店舗名} に入ります'],
  [KEY.responseSheet, 'フォームの回答 1', 'フォームの回答が入るシートの名前（画面下のタブ名と同じにする）'],
  [KEY.nameField, 'お名前', 'フォームの「お名前」の質問のタイトル（一字一句同じにする）'],
  [KEY.emailField, 'メールアドレス', 'メールアドレスの質問のタイトル。フォームの「メールアドレスを収集する」を使う場合は「メールアドレス」のまま'],
  [KEY.kindField, 'お問い合わせ種別', '返信テンプレートを切り替える質問のタイトル。切り替えない場合は空欄'],
  [KEY.autoReply, 'する', 'お客様への自動返信メール（する／しない）'],
  [KEY.senderName, 'サンプル商店', 'お客様のメールに表示される差出人名'],
  [KEY.replyTo, '', 'お客様が返信したときの宛先。空欄なら、このスクリプトを設定したGoogleアカウント'],
  [KEY.bcc, '', '自動返信の控えを受け取るアドレス（空欄なら送らない）'],
  [
    KEY.signature,
    ['――――――――――――', 'サンプル商店', 'TEL: 03-0000-0000（10:00〜19:00／火曜定休）', 'https://example.com', '――――――――――――'].join('\n'),
    '返信メールの {署名} に入ります',
  ],
  [KEY.slackEnabled, 'しない', 'Slack に新着を通知する（する／しない）'],
  [KEY.slackUrl, '', 'https://hooks.slack.com/services/… の形のURL'],
  [KEY.discordEnabled, 'しない', 'Discord に新着を通知する（する／しない）'],
  [KEY.discordUrl, '', 'https://discord.com/api/webhooks/… の形のURL'],
  [KEY.chatworkEnabled, 'しない', 'Chatwork に新着を通知する（する／しない）'],
  [KEY.chatworkRoomId, '', 'ルームのURL末尾「#!rid」のあとの数字。トークンはメニュー「Chatworkトークンを登録」から（シートには書かない）'],
  [KEY.maxChars, 500, 'チャット通知に載せる1項目あたりの最大文字数'],
  [KEY.reminderEnabled, 'する', '毎朝9時に、未対応のまま時間がたった問い合わせをチャットで知らせる（する／しない）'],
  [KEY.reminderHours, 24, '何時間以上「未対応」のままならリマインドするか'],
  [
    KEY.ngWords,
    'カジノ,出会い系,相互リンク,被リンク,casino,viagra',
    'これを含む送信は「スパム疑い」にして返信・通知しない（カンマ区切り。大文字小文字・全角半角は区別しない）',
  ],
  [KEY.staff, '店長,スタッフA,スタッフB', '「担当」列のプルダウンに出す名前（カンマ区切り）'],
];

// する／しない のプルダウンにする項目
const BOOL_KEYS = [KEY.autoReply, KEY.slackEnabled, KEY.discordEnabled, KEY.chatworkEnabled, KEY.reminderEnabled];

// 返信テンプレートで使える、フォームの質問以外の差し込み
const BUILTIN_KEYS = ['店舗名', '署名', '受付番号', '受付日時'];

// 件名が空欄のテンプレートに使う件名
const DEFAULT_SUBJECT = '【{店舗名}】お問い合わせを受け付けました';

// 「返信テンプレート」シートの初期値 [種別, 件名, 本文]
const DEFAULT_TEMPLATES = [
  [
    '予約',
    '【{店舗名}】ご予約のお問い合わせを受け付けました（受付番号 {受付番号}）',
    [
      '{お名前} 様',
      '',
      'このたびは{店舗名}にご予約のお問い合わせをいただき、ありがとうございます。',
      '以下の内容で受け付けました。',
      '',
      '■受付番号：{受付番号}',
      '■受付日時：{受付日時}',
      '■ご希望日時：{ご希望日時}',
      '■内容：',
      '{お問い合わせ内容}',
      '',
      'ご予約は、担当者からの確定のご連絡をもって成立となります。',
      '通常1営業日以内にご連絡しますので、今しばらくお待ちください。',
      '',
      '※このメールは自動でお送りしています。',
      '{署名}',
    ].join('\n'),
  ],
  [
    '見積',
    '【{店舗名}】お見積りのご依頼を受け付けました（受付番号 {受付番号}）',
    [
      '{お名前} 様',
      '',
      'このたびは{店舗名}にお見積りのご依頼をいただき、ありがとうございます。',
      '以下の内容で受け付けました。',
      '',
      '■受付番号：{受付番号}',
      '■受付日時：{受付日時}',
      '■内容：',
      '{お問い合わせ内容}',
      '',
      '内容を確認のうえ、2営業日以内にお見積りをお送りします。',
      '追加の資料などがありましたら、このメールにご返信ください。',
      '',
      '※このメールは自動でお送りしています。',
      '{署名}',
    ].join('\n'),
  ],
  [
    'その他',
    DEFAULT_SUBJECT + '（受付番号 {受付番号}）',
    [
      '{お名前} 様',
      '',
      'このたびは{店舗名}にお問い合わせいただき、ありがとうございます。',
      '以下の内容で受け付けました。',
      '',
      '■受付番号：{受付番号}',
      '■受付日時：{受付日時}',
      '■内容：',
      '{お問い合わせ内容}',
      '',
      '担当者より順にご連絡しますので、今しばらくお待ちください。',
      '',
      '※このメールは自動でお送りしています。',
      '{署名}',
    ].join('\n'),
  ],
];

// ---- メニュー・初期設定 ----

/** スプレッドシートを開いたときにメニュー「問い合わせ管理」を出す */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('問い合わせ管理')
    .addItem('初期設定（最初に1回）', 'setupAll')
    .addSeparator()
    .addItem('テスト通知を送る（チャット）', 'sendTestNotification')
    .addItem('自動返信のテストメールを送る', 'sendTestReply')
    .addItem('未対応リマインドを今すぐ送る', 'runReminderNow')
    .addSeparator()
    .addItem('Chatworkトークンを登録', 'registerChatworkToken')
    .addItem('設定をチェック', 'checkSettings')
    .addToUi();
}

/** 最初に1回だけ実行する: シートの準備とトリガー登録をまとめて行う（何度実行しても大丈夫） */
function setupAll() {
  const ss = SpreadsheetApp.getActive();
  setupSheets(ss);
  setupTriggers();
  const config = loadConfig(ss);
  const sheet = getResponseSheet(ss, config);
  const warnings = validateConfig(config, sheet ? getHeaders_(sheet) : []);
  alert_(
    [
      '初期設定が完了しました。',
      '「設定」「返信テンプレート」シートを編集してから、メニューの「テスト通知を送る」で確認してください。',
      ...formatWarnings_(warnings),
    ].join('\n')
  );
}

/** 最初に1回だけ実行する: フォーム送信時と毎日9時のトリガーを作る（このスクリプトの分だけ作り直す） */
function setupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => CONFIG.triggerHandlers.includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sendDailyReminder').timeBased().everyDays(1).atHour(CONFIG.reminderHour).nearMinute(0).create();
}

/** 「設定」「返信テンプレート」シートを作り、回答シートに管理用の列を足す（既存の値は消さない） */
function setupSheets(ss) {
  ss = ss || SpreadsheetApp.getActive();
  setupSettingsSheet_(ss);
  setupTemplateSheet_(ss);
  const config = loadConfig(ss);
  const sheet = getResponseSheet(ss, config);
  if (sheet) setupResponseSheet_(sheet, config);
}

function setupSettingsSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.settingsSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.settingsSheet);
    sheet.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold').setBackground('#e8eafc');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 220).setColumnWidth(2, 380).setColumnWidth(3, 480);
  }
  // 足りない項目だけ追記する（項目が増えたバージョンに差し替えても、入力済みの値は残る）
  const keys = sheet.getDataRange().getValues().map((r) => String(r[0]).trim());
  const missing = DEFAULT_SETTINGS.filter(([k]) => !keys.includes(k));
  if (missing.length) sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);

  const yesNo = SpreadsheetApp.newDataValidation().requireValueInList(['する', 'しない'], true).setAllowInvalid(false).build();
  sheet.getDataRange().getValues().forEach((r, i) => {
    if (BOOL_KEYS.includes(String(r[0]).trim())) sheet.getRange(i + 1, 2).setDataValidation(yesNo);
  });
  sheet.getRange(1, 1, sheet.getLastRow(), 3).setVerticalAlignment('top').setWrap(true);
}

function setupTemplateSheet_(ss) {
  if (ss.getSheetByName(CONFIG.templateSheet)) return;
  const sheet = ss.insertSheet(CONFIG.templateSheet);
  const rows = [['種別', '件名', '本文'], ...DEFAULT_TEMPLATES];
  sheet.getRange(1, 1, rows.length, 3).setValues(rows).setVerticalAlignment('top').setWrap(true);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eafc');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 120).setColumnWidth(2, 420).setColumnWidth(3, 620);
}

function setupResponseSheet_(sheet, config) {
  const cols = ensureManagementColumns(sheet);
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  applyManagementValidation_(sheet, cols, config, 2, rows);
  applyStatusColors_(sheet, cols[CONFIG.columns.status], rows);
  sheet.setColumnWidth(cols[CONFIG.columns.log], 360);
  return cols;
}

/** 回答シートに「対応状況」「担当」「処理ログ」列がなければ右端に足し、列番号（1始まり）を返す */
function ensureManagementColumns(sheet) {
  const plan = planManagementColumns(getHeaders_(sheet), MANAGEMENT_HEADERS);
  plan.toAdd.forEach(({ name, col }) => {
    if (col > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
    sheet.getRange(1, col).setValue(name).setFontWeight('bold').setBackground('#fff4d6');
  });
  return plan.cols;
}

function applyManagementValidation_(sheet, cols, config, startRow, numRows) {
  const statusRule = SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build();
  sheet.getRange(startRow, cols[CONFIG.columns.status], numRows, 1).setDataValidation(statusRule);
  if (config.staff.length) {
    // 担当は一覧にない名前も入れられるようにしておく
    const staffRule = SpreadsheetApp.newDataValidation().requireValueInList(config.staff, true).setAllowInvalid(true).build();
    sheet.getRange(startRow, cols[CONFIG.columns.assignee], numRows, 1).setDataValidation(staffRule);
  }
}

/** 対応状況ごとに色をつける（未対応=赤、対応中=黄、完了=緑、スパム疑い=灰） */
function applyStatusColors_(sheet, statusCol, numRows) {
  const range = sheet.getRange(2, statusCol, numRows, 1);
  const colors = [
    [CONFIG.status.todo, '#fde2e1', '#b3261e'],
    [CONFIG.status.doing, '#fff4d6', '#7a5900'],
    [CONFIG.status.done, '#e6f4ea', '#1e6b34'],
    [CONFIG.status.spam, '#eeeeee', '#777777'],
  ];
  const others = sheet.getConditionalFormatRules().filter((r) => !r.getRanges().some((rg) => rg.getColumn() === statusCol));
  const rules = colors.map(([text, bg, fg]) =>
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([range]).build()
  );
  sheet.setConditionalFormatRules(others.concat(rules));
}

// ---- フォーム送信時 ----

/** フォームが送信されたら: スパム判定 → 自動返信 → チャット通知 → 対応状況と処理ログを書く */
function onFormSubmit(e) {
  if (!e || !e.range) {
    throw new Error(
      'onFormSubmit はフォーム送信時に自動で動く関数です。動作確認はフォームから実際に送信するか、メニューの「テスト通知を送る」を使ってください。'
    );
  }
  const ss = SpreadsheetApp.getActive();
  const config = loadConfig(ss);
  const sheet = e.range.getSheet();
  // 同じスプレッドシートに別のフォームもつながっている場合は、設定した回答シート以外を無視する
  if (ss.getSheetByName(config.responseSheet) && sheet.getName() !== config.responseSheet) return;
  const row = e.range.getRow();

  // 管理列の準備と「処理済みか」の確認はロックして行う（同時送信・トリガーの二重起動で二重送信しないため）
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let cols;
  try {
    cols = ensureManagementColumns(sheet);
    if (String(sheet.getRange(row, cols[CONFIG.columns.log]).getValue()).trim()) return; // 処理済み
    sheet.getRange(row, cols[CONFIG.columns.log]).setValue('処理中…');
  } finally {
    lock.releaseLock();
  }

  const logCell = sheet.getRange(row, cols[CONFIG.columns.log]);
  const statusCell = sheet.getRange(row, cols[CONFIG.columns.status]);
  try {
    applyManagementValidation_(sheet, cols, config, row, 1);
    const headers = getHeaders_(sheet);
    const namedValues = e.namedValues || zipAnswers(headers, e.values || []);
    const answers = orderAnswers(headers, namedValues, MANAGEMENT_HEADERS.concat(CONFIG.timestampHeaders));
    const receivedAt = readTimestamp_(sheet, headers, row);
    const email = normalizeEmail(findAnswer(answers, config.emailField));
    const spam = checkSpam(answers, { email, ngWords: config.ngWords, requireEmail: !!config.emailField });
    const logs = [];

    if (spam.isSpam) {
      statusCell.setValue(CONFIG.status.spam);
      logs.push(`スパム疑いのため返信・通知なし（${spam.reasons.join(' / ')}）`);
    } else {
      statusCell.setValue(CONFIG.status.todo);
      if (config.autoReply) {
        logs.push(sendAutoReply_(email, buildTemplateData(answers, config, receivedAt), findAnswer(answers, config.kindField), config));
      }
      const message = buildInquiryMessage(answers, {
        nameField: config.nameField,
        kindField: config.kindField,
        receivedAt,
        maxChars: config.maxChars,
        url: sheetLink(ss.getUrl(), sheet.getSheetId(), row),
      });
      notifyAll_(config, message).forEach((r) => logs.push(r));
    }
    logCell.setValue(`${formatDateJst(new Date())} ${logs.join(' / ') || '処理完了'}`);
  } catch (err) {
    logCell.setValue(`${formatDateJst(new Date())} エラー: ${err.message}`);
    throw err; // 実行ログとエラー通知メールにも残す
  }
}

/** お客様へ自動返信する。結果を処理ログ用の短い文で返す */
function sendAutoReply_(to, data, kind, config) {
  if (!to) return '返信: メールアドレスの項目名が未設定のため送信せず';
  const tpl = pickTemplate(config.templates, kind);
  if (!tpl) return '返信: テンプレートがないため送信せず';
  if (MailApp.getRemainingDailyQuota() < 1) return '返信: 本日のメール送信上限に達したため送信せず';
  const mail = renderReply(tpl, data);
  const options = Object.assign(mailOptions_(config), { to, subject: mail.subject, body: mail.body });
  if (config.bcc) options.bcc = config.bcc;
  try {
    MailApp.sendEmail(options);
    return `返信: 送信済（${tpl.kind || '既定'}）`;
  } catch (err) {
    return `返信: 失敗（${err.message}）`;
  }
}

function mailOptions_(config) {
  const options = { name: config.senderName || config.shopName || '' };
  if (config.replyTo) options.replyTo = config.replyTo;
  return options;
}

/** 「する」になっているチャットすべてに送る。結果を ["Slack: OK", ...] の形で返す */
function notifyAll_(config, message) {
  return buildNotifyRequests(config, message).map((req) => `${req.service}: ${req.error ? req.error : sendRequest_(req)}`);
}

/** 1回だけ再送する（混雑時の 429 / サーバー側の 5xx / 通信エラー） */
function sendRequest_(req) {
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(req.url, Object.assign({ muteHttpExceptions: true }, req.params));
      const code = res.getResponseCode();
      if (code >= 200 && code < 300) return 'OK';
      last = `失敗（HTTP ${code} ${truncate(res.getContentText(), 80)}）`;
      if (code !== 429 && code < 500) return last;
    } catch (err) {
      last = `失敗（${err.message}）`;
    }
    if (attempt === 1) Utilities.sleep(1500);
  }
  return last;
}

// ---- 毎日のリマインド ----

/** 毎日9時（トリガー）: 一定時間たっても「未対応」の問い合わせをチャットに知らせる */
function sendDailyReminder() {
  console.log(runReminder_({ force: false }).summary);
}

/** メニューから: 今すぐリマインドを送る（「未対応リマインド」が「しない」でも送る） */
function runReminderNow() {
  alert_(runReminder_({ force: true }).summary);
}

function runReminder_(opts) {
  const ss = SpreadsheetApp.getActive();
  const config = loadConfig(ss);
  if (!config.reminder.enabled && !(opts && opts.force)) return { sent: 0, summary: '「未対応リマインド」が「しない」のため送りませんでした' };
  const sheet = getResponseSheet(ss, config);
  if (!sheet) return { sent: 0, summary: `回答シート「${config.responseSheet}」が見つかりません` };

  const hours = config.reminder.hours;
  const overdue = filterOverdue(toInquiryItems(sheet.getDataRange().getValues(), config), new Date(), hours);
  if (!overdue.length) return { sent: 0, summary: `${hours}時間以上たった未対応の問い合わせはありません` };

  const message = buildReminderMessage(overdue, { hours, url: sheetLink(ss.getUrl(), sheet.getSheetId()) });
  const results = notifyAll_(config, message);
  if (!results.length) return { sent: 0, summary: `未対応が ${overdue.length}件 ありますが、チャット通知が1つも「する」になっていません` };
  return { sent: overdue.length, summary: [`未対応 ${overdue.length}件 をリマインドしました`, ...results].join('\n') };
}

// ---- メニューの各機能 ----

/** チャットにテスト通知を送り、結果を表示する */
function sendTestNotification() {
  const ss = SpreadsheetApp.getActive();
  const config = loadConfig(ss);
  const results = notifyAll_(config, buildTestMessage(config.shopName, ss.getUrl()));
  alert_(
    results.length
      ? ['テスト通知の結果:', ...results].join('\n')
      : 'チャット通知が1つも「する」になっていません。「設定」シートの「Slack通知」などを「する」にしてください。'
  );
}

/** 返信テンプレートごとに、入力したアドレスへテストメールを送る */
function sendTestReply() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '自動返信のテスト',
    'テストメールを受け取るアドレスを入力してください。\n返信テンプレートの種別ごとに1通ずつ届きます。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const to = normalizeEmail(res.getResponseText());
  if (!isValidEmail(to)) {
    ui.alert(`メールアドレスの形式が正しくありません: ${to}`);
    return;
  }
  const ss = SpreadsheetApp.getActive();
  const config = loadConfig(ss);
  if (!config.templates.length) {
    ui.alert('「返信テンプレート」シートにテンプレートがありません。');
    return;
  }
  const sheet = getResponseSheet(ss, config);
  const headers = sheet ? getHeaders_(sheet) : [];
  const lines = config.templates.map((tpl) => {
    const answers = sampleAnswers(headers, config, tpl.kind, to);
    const mail = renderReply(tpl, buildTemplateData(answers, config, new Date()));
    MailApp.sendEmail(Object.assign(mailOptions_(config), { to, subject: `[テスト] ${mail.subject}`, body: mail.body }));
    return `・${tpl.kind || '（種別なし）'}: ${mail.subject}`;
  });
  ui.alert([`${to} に ${lines.length}通 送りました。`, ...lines].join('\n'));
}

/** Chatwork の APIトークンをスクリプトプロパティに保存する（シートには残さない） */
function registerChatworkToken() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const current = props.getProperty(CONFIG.props.chatworkToken);
  const res = ui.prompt(
    'Chatwork APIトークンの登録',
    `${current ? `登録済み: ${maskSecret(current)}\n` : ''}APIトークンを貼り付けてください（空欄のままOKで削除）。`,
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const token = res.getResponseText().trim();
  if (token) {
    props.setProperty(CONFIG.props.chatworkToken, token);
    ui.alert(`登録しました: ${maskSecret(token)}`);
  } else {
    props.deleteProperty(CONFIG.props.chatworkToken);
    ui.alert('トークンを削除しました。');
  }
}

/** 設定の書き間違い（項目名・URL・差し込み名など）をチェックして表示する */
function checkSettings() {
  const ss = SpreadsheetApp.getActive();
  const config = loadConfig(ss);
  const sheet = getResponseSheet(ss, config);
  const warnings = validateConfig(config, sheet ? getHeaders_(sheet) : []);
  alert_(warnings.length ? formatWarnings_(warnings).join('\n') : '設定に問題は見つかりませんでした。');
}

// ---- シートの読み書き ----

/** 「設定」「返信テンプレート」シートとスクリプトプロパティから設定を読む */
function loadConfig(ss) {
  const settings = ss.getSheetByName(CONFIG.settingsSheet);
  if (!settings) {
    throw new Error('「設定」シートがありません。setupAll（メニュー「問い合わせ管理」→「初期設定」）を実行してください。');
  }
  const props = PropertiesService.getScriptProperties();
  const secrets = {
    chatworkToken: props.getProperty(CONFIG.props.chatworkToken) || '',
    slackUrl: props.getProperty(CONFIG.props.slackUrl) || '',
    discordUrl: props.getProperty(CONFIG.props.discordUrl) || '',
  };
  const config = buildConfig(parseSettings(settings.getDataRange().getValues()), secrets);
  const tplSheet = ss.getSheetByName(CONFIG.templateSheet);
  config.templates = tplSheet ? parseTemplates(tplSheet.getDataRange().getValues()) : [];
  return config;
}

/** 回答シートを探す。名前が変わっていたら「フォームの回答」で始まるシートを使う */
function getResponseSheet(ss, config) {
  return (
    ss.getSheetByName(config.responseSheet) ||
    ss.getSheets().find((s) => /^(フォームの回答|Form Responses)/.test(s.getName())) ||
    null
  );
}

function getHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
}

function readTimestamp_(sheet, headers, row) {
  const i = findHeader(headers, CONFIG.timestampHeaders);
  return toDate(i >= 0 ? sheet.getRange(row, i + 1).getValue() : null) || new Date();
}

/** 画面に表示する。エディタから実行したとき（画面がない）は実行ログに出す */
function alert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    console.log(message);
  }
}

function formatWarnings_(warnings) {
  return warnings.length ? ['', '次の点を確認してください:', ...warnings.map((w) => `・${w}`)] : [];
}

// ---- ここから下は Google のサービスを使わない純粋な関数（Node でテストできる） ----

/** null / undefined を空文字にして文字列にする */
function textOf(v) {
  return v == null ? '' : String(v);
}

/** 全角英数・全角記号を半角にそろえる（ＡＢＣ→ABC、＠→@、半角カナ→全角カナ） */
function toHalfWidth(v) {
  return textOf(v).normalize('NFKC');
}

/** 項目名や種別を比べるための正規化（全角半角・空白の違いを無視） */
function normalizeKey(v) {
  return toHalfWidth(v).replace(/\s+/g, '');
}

/** 「設定」シートの値（1行目は見出し）を { 項目: 値 } にする */
function parseSettings(values) {
  const map = {};
  (values || []).slice(1).forEach((r) => {
    const key = String(r[0] == null ? '' : r[0]).trim();
    if (key) map[key] = r[1];
  });
  return map;
}

/** { 項目: 値 } を、コードで使いやすい設定オブジェクトにする。項目の行がなければ初期値を使う */
function buildConfig(map, secrets) {
  const s = secrets || {};
  const defaults = DEFAULT_SETTINGS.reduce((acc, [k, v]) => Object.assign(acc, { [k]: v }), {});
  const has = (k) => Object.prototype.hasOwnProperty.call(map, k);
  // 文字列の項目: 行があればその値（空欄なら空欄のまま）、行がなければ初期値
  const str = (k) => textOf(has(k) ? map[k] : defaults[k]).trim();
  // する／しない・数値の項目: 空欄のときも初期値
  const blankToDefault = (k) => (has(k) && textOf(map[k]).trim() !== '' ? map[k] : defaults[k]);
  const bool = (k) => parseBool(blankToDefault(k));
  const num = (k) => parseNumber(blankToDefault(k), parseNumber(defaults[k], 0));
  return {
    shopName: str(KEY.shopName),
    responseSheet: str(KEY.responseSheet) || CONFIG.defaultResponseSheet,
    nameField: str(KEY.nameField),
    emailField: str(KEY.emailField),
    kindField: str(KEY.kindField),
    autoReply: bool(KEY.autoReply),
    senderName: str(KEY.senderName),
    replyTo: normalizeEmail(str(KEY.replyTo)),
    bcc: normalizeEmail(str(KEY.bcc)),
    signature: str(KEY.signature),
    slack: { enabled: bool(KEY.slackEnabled), url: (s.slackUrl || str(KEY.slackUrl)).trim() },
    discord: { enabled: bool(KEY.discordEnabled), url: (s.discordUrl || str(KEY.discordUrl)).trim() },
    chatwork: {
      enabled: bool(KEY.chatworkEnabled),
      roomId: normalizeChatworkRoomId(str(KEY.chatworkRoomId)),
      token: String(s.chatworkToken || '').trim(),
    },
    maxChars: num(KEY.maxChars),
    reminder: { enabled: bool(KEY.reminderEnabled), hours: num(KEY.reminderHours) },
    ngWords: splitList(str(KEY.ngWords)),
    staff: splitList(str(KEY.staff)),
    templates: [],
  };
}

/** 「返信テンプレート」シートの値（1行目は見出し）を [{ kind, subject, body }] にする */
function parseTemplates(values) {
  return (values || [])
    .slice(1)
    .map((r) => ({
      kind: String(r[0] == null ? '' : r[0]).trim(),
      subject: String(r[1] == null ? '' : r[1]).trim(),
      body: String(r[2] == null ? '' : r[2]),
    }))
    .filter((t) => t.subject || t.body.trim());
}

/** 「する」「はい」「ON」「TRUE」などを true にする */
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = toHalfWidth(v).trim().toLowerCase();
  return ['する', 'はい', '有効', 'on', 'true', 'yes', '1', '○'].includes(s);
}

/** 「24」「２４時間」などを数値にする。読めなければ fallback */
function parseNumber(v, fallback) {
  if (typeof v === 'number' && isFinite(v)) return v;
  const n = parseFloat(toHalfWidth(v).replace(/[^\d.]/g, ''));
  return isNaN(n) ? fallback : n;
}

/** カンマ・読点・改行区切りの文字列をリストにする（空・重複は除く） */
function splitList(text) {
  const items = String(text == null ? '' : text)
    .split(/[,、，\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(items)];
}

/** Chatwork のルームIDを取り出す。「123456」「rid123456」「https://www.chatwork.com/#!rid123456」のどれでもよい */
function normalizeChatworkRoomId(v) {
  const s = toHalfWidth(v).trim();
  const m = s.match(/rid(\d+)/i) || s.match(/^(\d+)$/);
  return m ? m[1] : '';
}

/** トークンなどを画面に出すときは先頭だけ見せる */
function maskSecret(s) {
  const str = String(s == null ? '' : s);
  if (!str) return '';
  return `${str.slice(0, Math.min(4, Math.floor(str.length / 3)))}…（${str.length}文字）`;
}

// 差し込み: {お名前} のほか、全角の ｛お名前｝ や { お名前 } も受け付ける
function placeholderRegex() {
  return /[{｛]\s*([^{}｛｝\r\n]{1,40}?)\s*[}｝]/g;
}

/** 「{お名前} 様」のような差し込みを埋める。データにない項目は fallback（省略時は空文字）にする */
function fillTemplate(template, data, fallback) {
  const fb = fallback === undefined ? '' : String(fallback);
  const index = {};
  Object.keys(data || {}).forEach((k) => {
    index[normalizeKey(k)] = data[k];
  });
  return String(template == null ? '' : template).replace(placeholderRegex(), (_, key) => {
    const nk = normalizeKey(key);
    return Object.prototype.hasOwnProperty.call(index, nk) ? answerToString(index[nk]) : fb;
  });
}

/** テンプレートに出てくる差し込み名の一覧（重複なし） */
function listPlaceholders(template) {
  const keys = [];
  String(template == null ? '' : template).replace(placeholderRegex(), (_, key) => {
    if (!keys.includes(key.trim())) keys.push(key.trim());
    return '';
  });
  return keys;
}

/** テンプレートの差し込みのうち、フォームの質問にも組み込みの項目にもないもの（タイプミス検出用） */
function findUnknownPlaceholders(templates, knownKeys) {
  const known = new Set((knownKeys || []).map(normalizeKey));
  const result = [];
  (templates || []).forEach((t) => {
    listPlaceholders(`${t.subject}\n${t.body}`).forEach((key) => {
      if (!known.has(normalizeKey(key))) result.push({ kind: t.kind, key });
    });
  });
  return result;
}

/** テンプレートからメールの件名と本文を作る（件名の改行は空白にする） */
function renderReply(template, data) {
  const subject = fillTemplate(template.subject || DEFAULT_SUBJECT, data)
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim();
  return { subject, body: fillTemplate(template.body, data) };
}

const FALLBACK_KINDS = ['その他', '既定', 'default', '*', ''];
function isFallbackKind(kind) {
  return FALLBACK_KINDS.includes(normalizeKey(kind).toLowerCase());
}

/**
 * お問い合わせ種別に合うテンプレートを選ぶ。
 * 完全一致 → 部分一致（「ご予約」は「予約」に合う。長い種別名を優先）→「その他」→ 先頭のテンプレート の順。
 */
function pickTemplate(templates, kind) {
  if (!templates || !templates.length) return null;
  const k = normalizeKey(kind);
  if (k) {
    const exact = templates.find((t) => normalizeKey(t.kind) === k);
    if (exact) return exact;
    const partial = templates
      .filter((t) => !isFallbackKind(t.kind) && k.includes(normalizeKey(t.kind)))
      .sort((a, b) => normalizeKey(b.kind).length - normalizeKey(a.kind).length)[0];
    if (partial) return partial;
  }
  return templates.find((t) => isFallbackKind(t.kind)) || templates[0];
}

/** 差し込みに使うデータ: フォームの回答 ＋ 店舗名・署名・受付番号・受付日時 */
function buildTemplateData(answers, config, receivedAt) {
  return Object.assign(answersToMap(answers), {
    店舗名: config.shopName,
    署名: config.signature,
    受付番号: makeReceiptNo(receivedAt),
    受付日時: formatDateJst(receivedAt),
  });
}

/** 回答の値を文字列にする（チェックボックスの複数回答は「、」でつなぐ） */
function answerToString(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v
      .map((x) => answerToString(x))
      .filter(Boolean)
      .join('、');
  }
  if (v instanceof Date) return formatDateJst(v);
  return String(v).trim();
}

/**
 * フォームの回答（e.namedValues）を、シートの列の並び順で [{ label, value }] にする。
 * exclude の見出し（タイムスタンプ・管理列）は除く。シートにない質問は最後に足す。
 */
function orderAnswers(headers, namedValues, exclude) {
  const nv = {};
  Object.keys(namedValues || {}).forEach((k) => {
    nv[String(k).trim()] = namedValues[k];
  });
  const skip = new Set((exclude || []).map(normalizeKey));
  const seen = new Set();
  const result = [];
  const add = (label) => {
    const key = String(label == null ? '' : label).trim();
    if (!key || seen.has(key) || skip.has(normalizeKey(key)) || !(key in nv)) return;
    seen.add(key);
    result.push({ label: key, value: answerToString(nv[key]) });
  };
  (headers || []).forEach(add);
  Object.keys(nv).forEach(add);
  return result;
}

/** e.namedValues がないとき用: 見出しと e.values から { 見出し: [値] } を作る */
function zipAnswers(headers, values) {
  const map = {};
  (headers || []).forEach((h, i) => {
    if (String(h).trim() && i < values.length) map[String(h).trim()] = [values[i]];
  });
  return map;
}

/** 回答から、指定した質問の値を取り出す（全角半角・空白の違いは無視。設定チェックと同じ基準） */
function findAnswer(answers, label) {
  if (!label) return '';
  const k = normalizeKey(label);
  const hit = (answers || []).find((a) => normalizeKey(a.label) === k);
  return hit ? hit.value : '';
}

function answersToMap(answers) {
  const map = {};
  (answers || []).forEach((a) => {
    map[a.label] = a.value;
  });
  return map;
}

/** 全角の「＠」や空白が混ざったメールアドレスを整える */
function normalizeEmail(v) {
  return toHalfWidth(v)
    .replace(/\s+/g, '')
    .replace(/^mailto:/i, '');
}

// ローカル部（@の前）は、ドットの連続や@直前のドットも許す（docomo・au の古いアドレスに実在するため）
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** メールアドレスとして送信できる形か（厳密な RFC ではなく、実用上の判定） */
function isValidEmail(v) {
  const s = String(v == null ? '' : v);
  if (!s || s.length > 254) return false;
  const local = s.slice(0, s.lastIndexOf('@'));
  if (!local || local.length > 64 || !/[^.]/.test(local)) return false;
  return EMAIL_RE.test(s);
}

/** NGワードを含むか（大文字小文字・全角半角を区別しない）。含まれた語を返す */
function findNgWords(text, ngWords) {
  const hay = toHalfWidth(text).toLowerCase();
  return (ngWords || []).filter((w) => {
    const needle = toHalfWidth(w).trim().toLowerCase();
    return needle && hay.includes(needle);
  });
}

/**
 * スパム判定。メールアドレスが不正、または回答のどこかに NGワードがあればスパム疑い。
 * options: { email, ngWords, requireEmail（既定 true。メール欄のないフォームなら false） }
 */
function checkSpam(answers, options) {
  const o = options || {};
  const reasons = [];
  if (o.requireEmail !== false && !isValidEmail(o.email)) {
    reasons.push(o.email ? `メールアドレスの形式が正しくありません（${o.email}）` : 'メールアドレスが空です');
  }
  const text = (answers || []).map((a) => (typeof a === 'string' ? a : a.value)).join('\n');
  const hits = findNgWords(text, o.ngWords);
  if (hits.length) reasons.push(`NGワード「${hits.join('」「')}」を含みます`);
  return { isSpam: reasons.length > 0, reasons, ngHits: hits };
}

/** 管理列の位置を決める。既にあればその列、なければ右端に足す列（どちらも1始まり） */
function planManagementColumns(headers, names) {
  const trimmed = (headers || []).map((h) => String(h == null ? '' : h).trim());
  let last = trimmed.length;
  while (last > 0 && trimmed[last - 1] === '') last--;
  const cols = {};
  const toAdd = [];
  names.forEach((name) => {
    const i = trimmed.indexOf(name);
    if (i >= 0) {
      cols[name] = i + 1;
    } else {
      last += 1;
      cols[name] = last;
      toAdd.push({ name, col: last });
    }
  });
  return { cols, toAdd };
}

/** 見出しの位置（0始まり）。候補のどれかに合えばよい。なければ -1 */
function findHeader(headers, names) {
  const hs = (headers || []).map(normalizeKey);
  const list = [].concat(names).filter((n) => n);
  for (let i = 0; i < list.length; i++) {
    const idx = hs.indexOf(normalizeKey(list[i]));
    if (idx >= 0) return idx;
  }
  return -1;
}

function toDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// 日本はサマータイムがないので UTC+9 固定で計算する（実行環境のタイムゾーンに左右されない）
function jstParts(d) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    y: String(j.getUTCFullYear()),
    mo: p(j.getUTCMonth() + 1),
    d: p(j.getUTCDate()),
    h: p(j.getUTCHours()),
    mi: p(j.getUTCMinutes()),
    s: p(j.getUTCSeconds()),
  };
}

/** 日本時間で「2026/10/06 09:05」の形にする */
function formatDateJst(v) {
  const d = toDate(v);
  if (!d) return '';
  const t = jstParts(d);
  return `${t.y}/${t.mo}/${t.d} ${t.h}:${t.mi}`;
}

/** 受付番号: 受付日時（日本時間）から作る「20261006-090512」。行を並べ替えても変わらない */
function makeReceiptNo(v) {
  const d = toDate(v);
  if (!d) return '';
  const t = jstParts(d);
  return `${t.y}${t.mo}${t.d}-${t.h}${t.mi}${t.s}`;
}

/** スプレッドシートの特定のシート・行を開くリンク */
function sheetLink(url, gid, row) {
  const base = String(url || '').split('#')[0];
  if (!base) return '';
  return `${base}#gid=${gid}${row ? `&range=A${row}` : ''}`;
}

/** 回答シートの値（1行目は見出し）を、リマインド判定用の [{ row, timestamp, status, ... }] にする */
function toInquiryItems(values, config) {
  if (!values || values.length < 2) return [];
  const headers = values[0];
  const c = {
    ts: findHeader(headers, CONFIG.timestampHeaders),
    status: findHeader(headers, CONFIG.columns.status),
    assignee: findHeader(headers, CONFIG.columns.assignee),
    name: findHeader(headers, config.nameField),
    kind: findHeader(headers, config.kindField),
  };
  if (c.ts < 0 || c.status < 0) return [];
  const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
  return values
    .slice(1)
    .map((r, i) => ({
      row: i + 2,
      timestamp: toDate(r[c.ts]),
      status: cell(r, c.status),
      assignee: cell(r, c.assignee),
      name: cell(r, c.name),
      kind: cell(r, c.kind),
    }))
    .filter((it) => it.timestamp);
}

/** 「未対応」のまま hours 時間以上たったものを、古い順に返す（経過時間 elapsedHours つき） */
function filterOverdue(items, now, hours) {
  const limit = hours * 3600 * 1000;
  return (items || [])
    .filter((it) => {
      const ts = toDate(it.timestamp);
      return String(it.status).trim() === CONFIG.status.todo && ts && now - ts >= limit;
    })
    .map((it) => Object.assign({}, it, { elapsedHours: Math.floor((now - toDate(it.timestamp)) / 3600000) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** 長い文字列を max 文字（UTF-16 単位）に切り詰める。絵文字の途中では切らない */
function truncate(text, max) {
  const s = String(text == null ? '' : text);
  if (max <= 0) return '';
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * チャット通知の中身（サービス共通の形）: { kind, title, fields: [{ label, value }], url }
 * これを Slack / Discord / Chatwork それぞれの形式に変換して送る。
 */
function buildInquiryMessage(answers, opts) {
  const o = opts || {};
  const kind = findAnswer(answers, o.kindField);
  const name = findAnswer(answers, o.nameField);
  const title = `【新着問い合わせ】${kind ? `${kind}／` : ''}${name ? `${name} 様` : 'お名前なし'}`;
  const head = o.receivedAt
    ? [
        { label: '受付番号', value: makeReceiptNo(o.receivedAt) },
        { label: '受付日時', value: formatDateJst(o.receivedAt) },
      ]
    : [];
  const max = o.maxChars > 0 ? o.maxChars : 500;
  const fields = head.concat((answers || []).map((a) => ({ label: a.label, value: truncate(a.value, max) })));
  return { kind: 'inquiry', title, fields, url: o.url || '' };
}

/** 未対応リマインドの中身。多すぎるときは maxItems 件まで並べて「ほか○件」 */
function buildReminderMessage(items, opts) {
  const o = opts || {};
  const max = o.maxItems || CONFIG.reminderMaxItems;
  const shown = items.slice(0, max);
  const fields = shown.map((it) => ({
    label: `${it.kind ? `[${it.kind}] ` : ''}${it.name ? `${it.name} 様` : 'お名前なし'}`,
    value: `受付 ${formatDateJst(it.timestamp)}（${it.elapsedHours}時間経過）／担当: ${it.assignee || '未定'}／${it.row}行目`,
  }));
  if (items.length > shown.length) {
    fields.push({ label: `ほか ${items.length - shown.length}件`, value: 'スプレッドシートで確認してください' });
  }
  return {
    kind: 'reminder',
    title: `【未対応リマインド】${o.hours}時間以上たった未対応が ${items.length}件 あります`,
    fields,
    url: o.url || '',
  };
}

function buildTestMessage(shopName, url) {
  return {
    kind: 'test',
    title: '【テスト通知】問い合わせ通知の設定ができました',
    fields: [
      { label: '店舗名', value: shopName || '（未設定）' },
      { label: 'メモ', value: 'このメッセージが届いていれば、フォームが送信されたときの通知もここに届きます。' },
    ],
    url: url || '',
  };
}

/** テストメール用の回答: 回答シートの質問ごとにテスト用の値を入れる */
function sampleAnswers(headers, config, kind, email) {
  const skip = new Set(MANAGEMENT_HEADERS.concat(CONFIG.timestampHeaders).map(normalizeKey));
  const labels = (headers || []).map((h) => String(h).trim()).filter((h) => h && !skip.has(normalizeKey(h)));
  [config.nameField, config.emailField, config.kindField, 'お問い合わせ内容'].forEach((f) => {
    if (f && !labels.some((l) => normalizeKey(l) === normalizeKey(f))) labels.push(f);
  });
  return labels.map((label) => {
    const k = normalizeKey(label);
    let value = `（${label}のテスト入力）`;
    if (k === normalizeKey(config.nameField)) value = '山田 太郎（テスト）';
    else if (k === normalizeKey(config.emailField)) value = email || 'test@example.com';
    else if (k === normalizeKey(config.kindField)) value = kind || '';
    else if (k === normalizeKey('お問い合わせ内容')) value = 'これはテスト送信です。実際のお問い合わせではありません。';
    return { label, value };
  });
}

/** Slack の mrkdwn で特別な意味を持つ記号を無効にする（<!channel> などのメンション悪用を防ぐ） */
function escapeSlack(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Slack Incoming Webhook に送る JSON */
function buildSlackPayload(message) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: truncate(message.title, 150), emoji: true } }];
  const lines = (message.fields || []).map((f) => `*${escapeSlack(f.label)}*\n${escapeSlack(textOf(f.value).trim()) || '（未入力）'}`);
  if (lines.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(lines.join('\n\n'), 3000) } });
  if (message.url) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${message.url}|スプレッドシートを開く>` }] });
  return { text: escapeSlack(message.title), blocks };
}

const DISCORD_COLORS = { inquiry: 0x1a73e8, reminder: 0xe8710a, test: 0x188038 };

/** Discord Webhook に送る JSON（Discord の文字数上限に収まるように切り詰める） */
function buildDiscordPayload(message) {
  const fields = [];
  let budget = 5500; // 埋め込み全体の上限 6000 文字より少し余裕をもたせる
  (message.fields || []).slice(0, 25).forEach((f) => {
    const name = truncate(textOf(f.label).trim() || '-', 256);
    const room = Math.min(1024, budget - name.length);
    if (room < 20) return;
    const value = truncate(textOf(f.value).trim() || '（未入力）', room);
    fields.push({ name, value, inline: false });
    budget -= name.length + value.length;
  });
  const payload = {
    content: truncate(message.title, 2000),
    allowed_mentions: { parse: [] }, // 回答に @everyone などが書かれていても通知が飛ばないようにする
  };
  if (fields.length || message.url) {
    const embed = { color: DISCORD_COLORS[message.kind] || DISCORD_COLORS.inquiry, fields };
    if (message.url) {
      embed.title = 'スプレッドシートを開く';
      embed.url = message.url;
    }
    payload.embeds = [embed];
  }
  return payload;
}

/** Chatwork に送るメッセージ本文。回答に含まれる [toall] などのタグは全角にして無効にする */
function buildChatworkBody(message) {
  const safe = (s) =>
    textOf(s)
      .replace(/\[/g, '［')
      .replace(/\]/g, '］');
  const lines = (message.fields || []).map((f) => `■${safe(f.label)}\n${safe(textOf(f.value).trim()) || '（未入力）'}`);
  if (message.url) lines.push(message.url);
  return `[info][title]${safe(message.title)}[/title]${lines.join('\n\n')}[/info]`;
}

/** UrlFetchApp.fetch(url, params) にそのまま渡せる形 */
function buildSlackRequest(webhookUrl, message) {
  return {
    url: webhookUrl,
    params: { method: 'post', contentType: 'application/json', payload: JSON.stringify(buildSlackPayload(message)) },
  };
}

function buildDiscordRequest(webhookUrl, message) {
  return {
    url: webhookUrl,
    params: { method: 'post', contentType: 'application/json', payload: JSON.stringify(buildDiscordPayload(message)) },
  };
}

function buildChatworkRequest(roomId, token, message) {
  return {
    url: `${CONFIG.chatworkApiBase}/rooms/${encodeURIComponent(roomId)}/messages`,
    params: { method: 'post', headers: { 'X-ChatWorkToken': token }, payload: { body: buildChatworkBody(message) } },
  };
}

/** 「する」になっている通知先ごとのリクエスト。設定が足りないものは error つきで返す */
function buildNotifyRequests(config, message) {
  const reqs = [];
  if (config.slack.enabled) {
    reqs.push(
      config.slack.url
        ? Object.assign({ service: 'Slack' }, buildSlackRequest(config.slack.url, message))
        : { service: 'Slack', error: 'Webhook URL が未設定です' }
    );
  }
  if (config.discord.enabled) {
    reqs.push(
      config.discord.url
        ? Object.assign({ service: 'Discord' }, buildDiscordRequest(config.discord.url, message))
        : { service: 'Discord', error: 'Webhook URL が未設定です' }
    );
  }
  if (config.chatwork.enabled) {
    if (!config.chatwork.token) reqs.push({ service: 'Chatwork', error: 'APIトークンが未登録です（メニュー「Chatworkトークンを登録」）' });
    else if (!config.chatwork.roomId) reqs.push({ service: 'Chatwork', error: 'ルームIDが未設定です' });
    else reqs.push(Object.assign({ service: 'Chatwork' }, buildChatworkRequest(config.chatwork.roomId, config.chatwork.token, message)));
  }
  return reqs;
}

/** 設定の書き間違いを見つけて、直し方を添えた文のリストで返す（問題なければ空） */
function validateConfig(config, headers) {
  const w = [];
  const hs = (headers || []).filter((h) => String(h).trim() !== '');
  if (!hs.length) {
    w.push(`回答シート「${config.responseSheet}」が見つかりません。フォームの「回答」タブからスプレッドシートにリンクし、「回答シート名」を確認してください。`);
  } else {
    [
      [KEY.nameField, config.nameField],
      [KEY.emailField, config.emailField],
      [KEY.kindField, config.kindField],
    ].forEach(([key, v]) => {
      if (v && findHeader(hs, v) < 0) w.push(`「${key}」の「${v}」がフォームの質問に見つかりません（質問のタイトルと同じ文字にしてください）`);
    });
    findUnknownPlaceholders(config.templates, hs.concat(BUILTIN_KEYS)).forEach(({ kind, key }) => {
      w.push(`返信テンプレート「${kind || '（種別なし）'}」の {${key}} に当たる質問がありません（空欄で送られます）`);
    });
  }
  if (config.autoReply && !config.emailField) w.push('自動返信が「する」ですが、「メールアドレスの項目名」が空です');
  if (config.autoReply && !config.templates.length) w.push('「返信テンプレート」シートにテンプレートが1つもありません');
  [
    [KEY.replyTo, config.replyTo],
    [KEY.bcc, config.bcc],
  ].forEach(([key, v]) => {
    if (v && !v.split(',').every(isValidEmail)) w.push(`「${key}」のメールアドレスの形式が正しくありません`);
  });
  if (config.slack.enabled) {
    if (!config.slack.url) w.push('Slack通知が「する」ですが、Slack Webhook URL が空です');
    else if (!/^https:\/\/hooks\.slack\.com\//.test(config.slack.url)) w.push('Slack Webhook URL は https://hooks.slack.com/ で始まるURLを入れてください');
  }
  if (config.discord.enabled) {
    if (!config.discord.url) w.push('Discord通知が「する」ですが、Discord Webhook URL が空です');
    else if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(config.discord.url)) {
      w.push('Discord Webhook URL は https://discord.com/api/webhooks/ で始まるURLを入れてください');
    }
  }
  if (config.chatwork.enabled) {
    if (!config.chatwork.roomId) w.push('ChatworkルームIDが空か、形式が正しくありません（数字だけを入れてください）');
    if (!config.chatwork.token) w.push('Chatwork の APIトークンが未登録です（メニュー「Chatworkトークンを登録」から登録）');
  }
  if (!config.slack.enabled && !config.discord.enabled && !config.chatwork.enabled) {
    w.push('チャット通知が1つも「する」になっていません（自動返信と対応管理だけ使う場合はこのままでOK）');
  }
  if (!(config.reminder.hours > 0)) w.push('「リマインド対象（経過時間）」には1以上の数字を入れてください');
  return w;
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG,
    KEY,
    DEFAULT_SETTINGS,
    DEFAULT_TEMPLATES,
    // 純粋な関数
    toHalfWidth,
    normalizeKey,
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
    answerToString,
    orderAnswers,
    zipAnswers,
    findAnswer,
    answersToMap,
    normalizeEmail,
    isValidEmail,
    findNgWords,
    checkSpam,
    planManagementColumns,
    findHeader,
    toDate,
    formatDateJst,
    makeReceiptNo,
    sheetLink,
    toInquiryItems,
    filterOverdue,
    truncate,
    buildInquiryMessage,
    buildReminderMessage,
    buildTestMessage,
    sampleAnswers,
    escapeSlack,
    buildSlackPayload,
    buildDiscordPayload,
    buildChatworkBody,
    buildSlackRequest,
    buildDiscordRequest,
    buildChatworkRequest,
    buildNotifyRequests,
    validateConfig,
    // Google のサービスを使う関数（テストではモックで動かす）
    setupAll,
    setupSheets,
    setupTriggers,
    loadConfig,
    onFormSubmit,
    sendDailyReminder,
    runReminder_,
  };
}
