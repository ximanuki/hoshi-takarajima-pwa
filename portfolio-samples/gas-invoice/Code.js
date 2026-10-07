/**
 * 請求書を自動作成して PDF でメール送信する Google Apps Script。
 *
 * 前提: スプレッドシートの「拡張機能」→「Apps Script」にこのコードを貼り、
 *       メニュー「請求書」→「初期設定（シートを用意する）」で次のシートを作る。
 *   取引先        … 取引先名 / 敬称（御中・様）/ メール
 *   明細          … 日付 / 取引先名 / 品目 / 数量 / 単価（税抜）/ 税区分（10% / 8% / 非課税）
 *   設定          … 自社名・住所・登録番号・振込先・支払期限・件名/本文テンプレ など（A列=項目, B列=値）
 *   請求書テンプレ … 請求書のレイアウト。1件ごとにコピーして値を書き込み、PDF にする
 *   送信履歴      … 作成・送信の記録。送信済みの請求書番号は二度と送らない
 *
 * 消費税は適格請求書（インボイス制度）のルールどおり「1枚の請求書ごと・税率ごとに1回だけ」計算し、
 * 1円未満は切り捨てる。安全のため、初期状態は Gmail の下書きを作るだけ（送信しない）。
 */

const CONFIG = {
  sheets: {
    clients: '取引先',
    details: '明細',
    settings: '設定',
    template: '請求書テンプレ',
    history: '送信履歴',
  },
  driveFolderName: '請求書', // マイドライブ直下に「請求書/YYYY-MM」を作って PDF を保存する
  invoicePrefix: 'INV', // 請求書番号の頭（INV-202609-001）
  defaultHonorific: '御中', // 敬称が空欄のとき
  defaultTaxRate: 10, // 税区分が空欄の明細は 10% として扱う
  timezone: 'Asia/Tokyo',
  timeLimitMs: 5 * 60 * 1000, // GAS の実行上限（6分）の手前で止め、残りは再実行に回す
  tmpSheetPrefix: '_作成中_', // PDF 書き出し用に一時的に作るシート名の頭
  defaultSubject: '【請求書】{対象月}分のご請求（{請求書番号}）／{自社名}',
  defaultBody: [
    '{取引先名} {敬称}',
    '',
    'いつもお世話になっております。{自社名}です。',
    '{対象月}分の請求書をお送りいたします。',
    '',
    '請求書番号：{請求書番号}',
    'ご請求金額：{金額}（税込）',
    'お支払期限：{期限}',
    '',
    '請求書は PDF で添付しております。',
    'ご確認のほど、よろしくお願いいたします。',
    '',
    '{自社名}',
  ].join('\n'),
};

// 送信モード（設定シートの「送信モード」）と、送信履歴の「状態」
const MODE = { draft: '下書き', send: '送信' };
const STATUS = { sent: '送信済', draft: '下書き', error: 'エラー', cancelled: '取消' }; // 「取消」は手で書き換える（訂正して出し直すとき）

// 列の位置（各シートの並び順。1行目は見出し）
const COL = {
  clients: { name: 0, honorific: 1, email: 2 },
  details: { date: 0, client: 1, item: 2, qty: 3, price: 4, tax: 5 },
  history: { at: 0, number: 1, month: 2, client: 3, to: 4, total: 5, status: 6, pdf: 7, draftId: 8 },
};

const HEADERS = {
  clients: ['取引先名', '敬称', 'メール'],
  details: ['日付', '取引先名', '品目', '数量', '単価（税抜）', '税区分'],
  history: ['日時', '請求書番号', '対象月', '取引先名', '宛先', '合計金額', '状態', 'PDF', '下書きID'],
};

// 設定シートの A 列に書く項目名
const SETTING_KEYS = {
  companyName: '自社名',
  address: '住所',
  registrationNo: '登録番号',
  bank: '振込先',
  dueDays: '支払期限日数',
  mode: '送信モード',
  subject: '件名テンプレ',
  body: '本文テンプレ',
  remarks: '備考',
};

// 税率（10 / 8 / 0=非課税）と表示名。請求書にはこの順で載せる
const TAX_RATES = [10, 8, 0];
const TAX_LABEL = {
  10: { short: '10%', summary: '10%対象' },
  8: { short: '8%', summary: '8%対象（軽減税率）' },
  0: { short: '非課税', summary: '非課税' },
};

// 「請求書テンプレ」シートのどこに何を書くか（レイアウトを変えたらここを直す）
const TPL = {
  columns: 6, // A〜F列（日付 / 品目 / 数量 / 単価 / 税率 / 金額）
  clientCell: 'A3', // 宛名（取引先名＋敬称）
  issueDateCell: 'F3',
  numberCell: 'F4',
  companyCell: 'D5',
  addressCell: 'D6',
  registrationCell: 'D7',
  totalCell: 'B10', // ご請求金額（税込）
  dueDateCell: 'B11',
  bankCell: 'B12',
  itemFirstRow: 15, // 明細の1行目（14行目が見出し）
  itemRows: 15, // 用意してある明細行の数。超えたら行を挿入して下をずらす
  subtotalRow: 31, // 小計・消費税・合計は F 列
  taxRow: 32,
  totalRow: 33,
  breakdownFirstRow: 36, // 税率別内訳（35行目が見出し。A=区分 / C=対象金額 / E=消費税額）
  breakdownRows: 3,
  reducedNoteRow: 39, // 「※は軽減税率対象」の注記
  remarksRow: 42, // 備考（42〜44行目を結合）
};

/** スプレッドシートを開いたときに「請求書」メニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('請求書')
    .addItem('今月分を作成', 'createThisMonth')
    .addItem('先月分を作成', 'createLastMonth')
    .addItem('選択した取引先だけ作成', 'createSelectedClients')
    .addItem('下書きだけ作る（送信しない）', 'createDraftsOnly')
    .addSeparator()
    .addItem('初期設定（シートを用意する）', 'setupSheets')
    .addToUi();
}

/** 今月分を「設定」の送信モードで作る */
function createThisMonth() {
  runInvoices({ offset: 0 });
}

/** 先月分を「設定」の送信モードで作る（月初にまとめて請求する人向け） */
function createLastMonth() {
  runInvoices({ offset: -1 });
}

/** 今月分を、送信モードに関係なく Gmail の下書きだけ作る */
function createDraftsOnly() {
  runInvoices({ offset: 0, forceDraft: true });
}

/** 「取引先」または「明細」シートで選んだ行の取引先だけ、今月分を作る */
function createSelectedClients() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const nameCol = { [CONFIG.sheets.clients]: COL.clients.name, [CONFIG.sheets.details]: COL.details.client }[sheet.getName()];
  if (nameCol === undefined) {
    ui.alert('「取引先」シート（または「明細」シート）で、作りたい取引先の行を選んでから実行してください。');
    return;
  }
  const rows = [];
  sheet.getActiveRangeList().getRanges().forEach((r) => {
    rows.push(...sheet.getRange(r.getRow(), 1, r.getNumRows(), nameCol + 1).getValues());
  });
  const names = namesFromSelection(rows, nameCol);
  if (!names.length) {
    ui.alert('選んだ行に取引先名がありません。取引先名が入っている行を選んでください。');
    return;
  }
  runInvoices({ offset: 0, onlyClients: names });
}

/** 請求書を作る本体。入力チェック → 確認ダイアログ → 1件ずつ PDF 作成・保存・メール */
function runInvoices(opts) {
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getDocumentLock(); // メニューの二度押しなどで同時に動いて二重送信しないように
  if (!lock.tryLock(3000)) {
    ui.alert('別の作成処理が動いています。終わってからもう一度実行してください。');
    return;
  }
  try {
    const ss = SpreadsheetApp.getActive();
    const { year, month } = targetMonth(new Date(), opts.offset || 0);
    const historySheet = ensureHistorySheet(ss);
    const historyRows = readRows(historySheet, HEADERS.history.length);
    getSheet(ss, CONFIG.sheets.template); // テンプレがなければここで止める
    const plan = planInvoices({
      settingsRows: getSheet(ss, CONFIG.sheets.settings).getDataRange().getValues(),
      clientRows: readRows(getSheet(ss, CONFIG.sheets.clients), HEADERS.clients.length),
      detailRows: readRows(getSheet(ss, CONFIG.sheets.details), HEADERS.details.length),
      historyRows,
      year,
      month,
      onlyClients: opts.onlyClients,
      forceDraft: opts.forceDraft,
    });

    if (plan.errors.length) {
      ui.alert('入力内容を確認してください', formatErrors(plan.errors), ui.ButtonSet.OK);
      return;
    }
    const targets = orderTargets(plan.invoices, historyRows);
    if (!targets.length) {
      ui.alert('作成する請求書はありません', noTargetMessage(plan), ui.ButtonSet.OK);
      return;
    }
    if (ui.alert('確認', confirmMessage(plan), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

    const folder = getMonthFolder(year, month);
    const started = Date.now();
    const result = { done: [], skipped: [], failed: [], rest: [] };
    targets.forEach((inv, i) => {
      if (Date.now() - started > CONFIG.timeLimitMs) {
        result.rest.push(inv);
        return;
      }
      ss.toast(`${i + 1} / ${targets.length}件目: ${inv.client}`, '請求書を作成中', 30);
      try {
        const r = processInvoice(ss, inv, plan, { folder, historySheet, historyRows });
        (r === 'skipped' ? result.skipped : result.done).push(inv);
      } catch (e) {
        appendHistory(historySheet, inv, `${STATUS.error}: ${e.message}`, '', '');
        result.failed.push({ inv, message: e.message });
      }
      SpreadsheetApp.flush(); // 1件ごとに履歴を確定させる（途中で止まっても二重送信しない）
    });
    ui.alert('完了', resultMessage(plan.mode, result, folder.getUrl()), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

/** 1件分: PDF を作って Drive に保存し、送信または下書き作成して履歴に残す */
function processInvoice(ss, inv, plan, ctx) {
  // 下書きを Gmail から手で送った場合などに備え、送信済みフォルダも確認する
  if (wasSentInGmail(inv.number)) {
    appendHistory(ctx.historySheet, inv, `${STATUS.sent}（Gmailの送信済みで確認）`, '', '');
    return 'skipped';
  }
  const blob = createInvoicePdf(ss, inv, plan.settings);
  const file = savePdf(ctx.folder, blob);
  const options = { attachments: [blob], name: plan.settings.companyName };

  if (plan.mode === MODE.send) {
    GmailApp.sendEmail(inv.email, inv.subject, inv.body, options);
    appendHistory(ctx.historySheet, inv, STATUS.sent, file.getUrl(), '');
  } else {
    const draft = GmailApp.createDraft(inv.email, inv.subject, inv.body, options);
    deleteDraftQuietly(latestDraftId(ctx.historyRows, inv.number)); // 作り直したときは古い下書きを消す
    appendHistory(ctx.historySheet, inv, STATUS.draft, file.getUrl(), draft.getId());
  }
  return 'done';
}

/** テンプレをコピーして値を書き込み、PDF にしてから一時シートを消す */
function createInvoicePdf(ss, inv, settings) {
  const template = getSheet(ss, CONFIG.sheets.template);
  const tmpName = `${CONFIG.tmpSheetPrefix}${inv.number}`;
  const leftover = ss.getSheetByName(tmpName); // 前回エラーで残ったもの
  if (leftover) ss.deleteSheet(leftover);

  const sheet = template.copyTo(ss).setName(tmpName);
  try {
    fillInvoiceSheet(sheet, inv, settings);
    SpreadsheetApp.flush();
    return exportSheetAsPdf(ss.getId(), sheet.getSheetId(), inv.fileName);
  } finally {
    ss.deleteSheet(sheet);
  }
}

/** コピーしたテンプレに請求書の内容を書き込む */
function fillInvoiceSheet(sheet, inv, settings) {
  const L = templateLayout(inv.lines.length);
  if (L.extraRows > 0) {
    sheet.insertRowsAfter(L.insertAfterRow, L.extraRows);
    sheet
      .getRange(TPL.itemFirstRow, 1, 1, TPL.columns)
      .copyTo(sheet.getRange(L.insertAfterRow + 1, 1, L.extraRows, TPL.columns), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  sheet.getRange(TPL.clientCell).setValue(`${inv.client} ${inv.honorific}`);
  sheet.getRange(TPL.issueDateCell).setValue(inv.issueDate);
  sheet.getRange(TPL.numberCell).setValue(inv.number);
  sheet.getRange(TPL.companyCell).setValue(settings.companyName);
  sheet.getRange(TPL.addressCell).setValue(settings.address);
  sheet.getRange(TPL.registrationCell).setValue(settings.registrationNo ? `登録番号：${settings.registrationNo}` : '');
  sheet.getRange(TPL.totalCell).setValue(inv.totals.total);
  sheet.getRange(TPL.dueDateCell).setValue(inv.dueDate);
  sheet.getRange(TPL.bankCell).setValue(settings.bank);

  const items = invoiceItemRows(inv.lines);
  sheet.getRange(L.itemFirstRow, 1, items.length, TPL.columns).setValues(items);
  sheet.getRange(L.subtotalRow, TPL.columns).setValue(inv.totals.subtotal);
  sheet.getRange(L.taxRow, TPL.columns).setValue(inv.totals.tax);
  sheet.getRange(L.totalRow, TPL.columns).setValue(inv.totals.total);
  taxBreakdownRows(inv.totals).forEach(([label, base, tax], i) => {
    const row = L.breakdownFirstRow + i;
    sheet.getRange(row, 1).setValue(label);
    sheet.getRange(row, 3).setValue(base);
    sheet.getRange(row, 5).setValue(tax);
  });
  sheet.getRange(L.reducedNoteRow, 1).setValue(inv.totals.hasReduced ? '※は軽減税率（8%）対象品目です。' : '');
  sheet.getRange(L.remarksRow, 1).setValue(settings.remarks);
}

/** シート1枚を Drive の書き出し URL で PDF にする */
function exportSheetAsPdf(spreadsheetId, gid, fileName) {
  const url = buildPdfExportUrl(spreadsheetId, gid);
  const params = { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(url, params);
    const code = res.getResponseCode();
    if (code === 200) return res.getBlob().setName(fileName);
    if (code !== 429 && code < 500) throw new Error(`PDF の書き出しに失敗しました（HTTP ${code}）`);
    Utilities.sleep(3000 * attempt); // 続けて書き出すと 429 が返ることがあるので、待ってから再試行
  }
  throw new Error('PDF の書き出しが混み合っています。数分おいてから再実行してください。');
}

/** マイドライブの「請求書/YYYY-MM」フォルダ（なければ作る） */
function getMonthFolder(year, month) {
  const root = findOrCreateFolder(DriveApp.getRootFolder(), CONFIG.driveFolderName);
  return findOrCreateFolder(root, monthKey(year, month));
}

function findOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 同じ名前の PDF（作り直す前のもの）はゴミ箱に移してから保存する */
function savePdf(folder, blob) {
  const old = folder.getFilesByName(blob.getName());
  while (old.hasNext()) old.next().setTrashed(true);
  return folder.createFile(blob);
}

/** Gmail の送信済みに、この請求書番号を含むメールがあるか */
function wasSentInGmail(number) {
  try {
    return GmailApp.search(`in:sent "${number}"`, 0, 1).length > 0;
  } catch (e) {
    return false; // 検索できなくても送信履歴シートでの確認は済んでいる
  }
}

function deleteDraftQuietly(draftId) {
  if (!draftId) return;
  try {
    GmailApp.getDraft(draftId).deleteDraft();
  } catch (e) {
    // すでに送信・削除されている下書きは何もしない
  }
}

function appendHistory(sheet, inv, status, pdfUrl, draftId) {
  sheet.appendRow([new Date(), inv.number, monthKey(inv.year, inv.month), inv.client, inv.email, inv.totals.total, status, pdfUrl, draftId]);
}

function getSheet(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`シート「${name}」が見つかりません。メニュー「請求書」→「初期設定（シートを用意する）」を実行してください。`);
  return sheet;
}

/** 見出しを除いた行を、決まった列数で読む */
function readRows(sheet, numCols) {
  const last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, numCols).getValues();
}

function ensureHistorySheet(ss) {
  const name = CONFIG.sheets.history;
  const sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  const created = ss.insertSheet(name, ss.getNumSheets());
  setupHistorySheet(created);
  return created;
}

// ---- 初期設定: シートとテンプレを作る（すでにあるシートは触らない） ----

/** 足りないシートを作る。販売用テンプレを作るときも、購入者が作り直すときもこれを1回実行する */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();
  const created = [];
  const make = (name, build) => {
    if (ss.getSheetByName(name)) return;
    build(ss.insertSheet(name, ss.getNumSheets()), ss);
    created.push(name);
  };
  make(CONFIG.sheets.settings, setupSettingsSheet);
  make(CONFIG.sheets.clients, setupClientsSheet);
  make(CONFIG.sheets.details, setupDetailsSheet);
  make(CONFIG.sheets.template, setupTemplateSheet);
  make(CONFIG.sheets.history, setupHistorySheet);

  // 新規スプレッドシートの空の「シート1」は消しておく
  ['シート1', 'Sheet1'].forEach((n) => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getNumSheets() > 1) ss.deleteSheet(s);
  });
  if (ss.getSpreadsheetTimeZone() !== CONFIG.timezone) ss.setSpreadsheetTimeZone(CONFIG.timezone);
  ss.getSheetByName(CONFIG.sheets.settings).activate();

  SpreadsheetApp.getUi().alert(
    created.length
      ? `次のシートを作りました: ${created.join('、')}\n\nまず「設定」シートに自社名・登録番号・振込先を入力してください。`
      : '必要なシートはすべてそろっています。',
  );
}

function setupSettingsSheet(sheet) {
  const rows = [
    ['項目', '値', '説明'],
    [SETTING_KEYS.companyName, '', '請求書とメールに載る屋号・会社名（必須）'],
    [SETTING_KEYS.address, '', '請求書に載る住所・電話番号など（セル内改行は Alt+Enter / Option+Enter）'],
    [SETTING_KEYS.registrationNo, '', 'インボイスの登録番号（T＋13桁）。未登録なら空欄'],
    [SETTING_KEYS.bank, '', '例: 〇〇銀行 〇〇支店 普通 1234567 ヤマダ タロウ'],
    [SETTING_KEYS.dueDays, '', '空欄なら「翌月末」。数字を入れると発行日（対象月の末日）の◯日後'],
    [SETTING_KEYS.mode, MODE.draft, '「下書き」= Gmail の下書きに保存するだけ（おすすめ） / 「送信」= そのまま送信'],
    [SETTING_KEYS.subject, CONFIG.defaultSubject, '差し込み: {取引先名} {敬称} {金額} {期限} {請求書番号} {対象月} {発行日} {自社名}（{請求書番号} は二重送信の確認に使うので件名か本文に残す）'],
    [SETTING_KEYS.body, CONFIG.defaultBody, '件名と同じ差し込みが使えます'],
    [SETTING_KEYS.remarks, 'お振込手数料は貴社にてご負担くださいますようお願いいたします。', '請求書の下に載る備考（空欄可）'],
  ];
  sheet.getRange(1, 2, rows.length, 1).setNumberFormat('@'); // 「30」「翌月末」などを文字のまま残す
  sheet.getRange(1, 1, rows.length, 3).setValues(rows).setVerticalAlignment('top').setWrap(true);
  styleHeader(sheet, 3);
  sheet.getRange(2, 1, rows.length - 1, 1).setFontWeight('bold');
  sheet.getRange(2, 3, rows.length - 1, 1).setFontColor('#666666');
  sheet.setColumnWidth(1, 120).setColumnWidth(2, 420).setColumnWidth(3, 380);
  const modeRow = rows.findIndex((r) => r[0] === SETTING_KEYS.mode) + 1;
  sheet.getRange(modeRow, 2).setDataValidation(listRule([MODE.draft, MODE.send]));
}

function setupClientsSheet(sheet) {
  sheet.getRange(1, 1, 3, 3).setValues([
    HEADERS.clients,
    ['株式会社サンプル商事', '御中', 'billing@example.com'],
    ['山田 太郎', '様', 'taro@example.com'],
  ]);
  styleHeader(sheet, HEADERS.clients.length);
  sheet.getRange('B2:B').setDataValidation(listRule(['御中', '様']));
  sheet.setColumnWidth(1, 220).setColumnWidth(2, 70).setColumnWidth(3, 260);
}

function setupDetailsSheet(sheet, ss) {
  const { year, month } = targetMonth(new Date(), 0);
  const d = (day) => new Date(year, month - 1, day);
  const rows = [
    HEADERS.details,
    [d(5), '株式会社サンプル商事', 'Webサイト保守（月額）', 1, 30000, '10%'],
    [d(12), '株式会社サンプル商事', 'バナー制作', 3, 5000, '10%'],
    [d(15), '株式会社サンプル商事', '打ち合わせ用 飲料・菓子', 2, 1080, '8%'],
    [d(20), '山田 太郎', 'ロゴデザイン', 1, 50000, '10%'],
    [d(20), '山田 太郎', '収入印紙代（立替）', 1, 200, '非課税'],
  ];
  sheet.getRange('F:F').setNumberFormat('@'); // 「10%」が 0.1 に変わらないように
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  styleHeader(sheet, HEADERS.details.length);
  sheet.getRange('A2:A').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('E2:E').setNumberFormat('#,##0');
  const clients = ss.getSheetByName(CONFIG.sheets.clients);
  if (clients) {
    sheet.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(clients.getRange('A2:A'), true).setAllowInvalid(true).build());
  }
  sheet.getRange('F2:F').setDataValidation(listRule(['10%', '8%', '非課税']));
  sheet.setColumnWidth(1, 100).setColumnWidth(2, 200).setColumnWidth(3, 260).setColumnWidth(4, 60).setColumnWidth(5, 100).setColumnWidth(6, 80);
}

function setupHistorySheet(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.history.length).setValues([HEADERS.history]);
  sheet.getRange('B:E').setNumberFormat('@'); // 「2026-09」が日付に変わらないように
  sheet.getRange('G:I').setNumberFormat('@');
  sheet.getRange('A2:A').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet.getRange('F2:F').setNumberFormat('#,##0');
  styleHeader(sheet, HEADERS.history.length);
  sheet.setColumnWidth(1, 130).setColumnWidth(2, 130).setColumnWidth(4, 180).setColumnWidth(5, 200).setColumnWidth(7, 160).setColumnWidth(8, 260);
}

/** 請求書のレイアウトを作る（A4 縦・A〜F列）。セルの位置は TPL と合わせる */
function setupTemplateSheet(sheet) {
  const T = TPL;
  const SOLID = SpreadsheetApp.BorderStyle.SOLID;
  const lastRow = T.remarksRow + 2;
  if (sheet.getMaxColumns() > T.columns) sheet.deleteColumns(T.columns + 1, sheet.getMaxColumns() - T.columns);
  if (sheet.getMaxRows() > lastRow) sheet.deleteRows(lastRow + 1, sheet.getMaxRows() - lastRow);
  [90, 220, 55, 85, 85, 110].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setHiddenGridlines(true);
  sheet.getRange(1, 1, lastRow, T.columns).setFontSize(10).setVerticalAlignment('middle');

  sheet.getRange('A1:F1').merge().setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center');
  sheet.getRange('A1').setValue('請　求　書'); // 結合セルへの書き込みは左上のセルに
  sheet.setRowHeight(1, 48);

  // 宛名・発行日・請求書番号
  sheet.getRange('A3:C3').merge().setFontSize(14).setFontWeight('bold').setBorder(null, null, true, null, null, null, '#333333', SOLID);
  sheet.setRowHeight(3, 30);
  sheet.getRange('E3:E4').setValues([['発行日'], ['請求書番号']]).setHorizontalAlignment('right').setFontColor('#555555');
  sheet.getRange(T.issueDateCell).setNumberFormat('yyyy"年"m"月"d"日"').setHorizontalAlignment('right');
  sheet.getRange(T.numberCell).setNumberFormat('@').setHorizontalAlignment('right');

  // 自社情報（発行者名・住所・登録番号）
  sheet.getRange('D5:F5').merge().setFontWeight('bold');
  sheet.getRange('D6:F6').merge().setWrap(true).setVerticalAlignment('top').setFontSize(9);
  sheet.setRowHeight(6, 36);
  sheet.getRange('D7:F7').merge().setFontSize(9);

  // ご請求金額・期限・振込先
  sheet.getRange('A9:C9').merge();
  sheet.getRange('A9').setValue('下記のとおりご請求申し上げます。');
  sheet.getRange('A10:A12').setValues([['ご請求金額'], ['お支払期限'], ['お振込先']]).setFontWeight('bold');
  sheet
    .getRange('B10:C10')
    .merge()
    .setNumberFormat('#,##0"円"')
    .setFontSize(16)
    .setFontWeight('bold')
    .setHorizontalAlignment('right')
    .setBorder(null, null, true, null, null, null, '#333333', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange('D10').setValue('（税込）').setFontSize(9);
  sheet.setRowHeight(10, 34);
  sheet.getRange('B11:C11').merge().setNumberFormat('yyyy"年"m"月"d"日"').setHorizontalAlignment('left');
  sheet.getRange('B12:F12').merge().setWrap(true);

  // 明細
  const headerRow = T.itemFirstRow - 1;
  sheet
    .getRange(headerRow, 1, 1, T.columns)
    .setValues([['日付', '品目', '数量', '単価', '税率', '金額']])
    .setFontWeight('bold')
    .setBackground('#eeeeee')
    .setHorizontalAlignment('center');
  sheet.getRange(headerRow, 1, T.itemRows + 1, T.columns).setBorder(true, true, true, true, true, true, '#999999', SOLID);
  sheet.getRange(T.itemFirstRow, 1, T.itemRows, 1).setNumberFormat('yyyy/m/d').setHorizontalAlignment('center');
  sheet.getRange(T.itemFirstRow, 3, T.itemRows, 1).setHorizontalAlignment('right');
  sheet.getRange(T.itemFirstRow, 4, T.itemRows, 1).setNumberFormat('#,##0');
  sheet.getRange(T.itemFirstRow, 5, T.itemRows, 1).setHorizontalAlignment('center');
  sheet.getRange(T.itemFirstRow, 6, T.itemRows, 1).setNumberFormat('#,##0');

  // 小計・消費税・合計
  sheet.getRange(T.subtotalRow, 5, 3, 1).setValues([['小計（税抜）'], ['消費税'], ['合計（税込）']]).setHorizontalAlignment('right');
  sheet.getRange(T.subtotalRow, 6, 3, 1).setNumberFormat('#,##0').setBorder(true, true, true, true, true, true, '#999999', SOLID);
  sheet.getRange(T.totalRow, 5, 1, 2).setFontWeight('bold');

  // 税率ごとの内訳（適格請求書の記載事項）
  const bHead = T.breakdownFirstRow - 1;
  for (let r = bHead; r < T.breakdownFirstRow + T.breakdownRows; r++) {
    sheet.getRange(r, 1, 1, 2).merge();
    sheet.getRange(r, 3, 1, 2).merge();
    sheet.getRange(r, 5, 1, 2).merge();
  }
  sheet.getRange(bHead, 1, 1, T.columns).setFontWeight('bold').setBackground('#eeeeee').setHorizontalAlignment('center');
  sheet.getRange(bHead, 1).setValue('税率区分');
  sheet.getRange(bHead, 3).setValue('対象金額（税抜）');
  sheet.getRange(bHead, 5).setValue('消費税額');
  sheet.getRange(T.breakdownFirstRow, 3, T.breakdownRows, 4).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sheet.getRange(bHead, 1, T.breakdownRows + 1, T.columns).setBorder(true, true, true, true, true, true, '#999999', SOLID);

  sheet.getRange(T.reducedNoteRow, 1, 1, T.columns).merge().setFontSize(9);
  sheet.getRange(T.remarksRow - 1, 1).setValue('備考').setFontWeight('bold');
  sheet.getRange(T.remarksRow, 1, 3, T.columns).merge().setWrap(true).setVerticalAlignment('top').setBorder(true, true, true, true, null, null, '#999999', SOLID);
}

function styleHeader(sheet, numCols) {
  sheet.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#e8eafc');
  sheet.setFrozenRows(1);
}

function listRule(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
}

// ---- ここから下は Google のサービスを使わない純粋な関数（Node でテストできる） ----

/** シートの各行から、請求書の計画（宛先・番号・金額・件名/本文・エラー）を作る */
function planInvoices({ settingsRows, clientRows, detailRows, historyRows, year, month, onlyClients, forceDraft }) {
  const { settings, errors: settingErrors } = parseSettings(settingsRows);
  const clients = parseClients(clientRows);
  const { lines, errors: lineErrors } = collectLines(detailRows, year, month);
  const only = onlyClients && onlyClients.length ? new Set(onlyClients) : null;
  const inScope = (name) => !only || only.has(name);

  const errors = [...settingErrors];
  lineErrors.filter((e) => !e.client || inScope(e.client)).forEach((e) => errors.push(`明細 ${e.rowNo}行目: ${e.message}`));

  const groups = groupByClient(lines.filter((l) => inScope(l.client)), clients.order);
  groups.forEach((g) => {
    const c = clients.byName.get(g.client);
    if (!c) {
      errors.push(`取引先「${g.client}」が「取引先」シートにありません（明細 ${g.lines.map((l) => l.rowNo).join('・')}行目）`);
    } else if (!isValidEmailList(c.email)) {
      errors.push(`取引先「${g.client}」のメールアドレス「${c.email}」を確認してください（取引先 ${c.rowNo}行目）`);
    }
    if (clients.duplicates.has(g.client)) errors.push(`取引先「${g.client}」が「取引先」シートに2回以上登録されています`);
  });

  const numbers = assignInvoiceNumbers(
    groups.map((g) => g.client),
    year,
    month,
    historyRows,
  );
  const sent = sentInvoiceNumbers(historyRows);
  const issueDate = endOfMonth(year, month); // 月末締め: 発行日は対象月の末日
  const dueDate = calcDueDate(issueDate, settings.dueDays);

  const invoices = groups.map((g) => {
    const c = clients.byName.get(g.client) || { honorific: CONFIG.defaultHonorific, email: '' };
    const inv = {
      number: numbers[g.client],
      client: g.client,
      honorific: c.honorific,
      email: c.email,
      year,
      month,
      lines: g.lines,
      totals: calcInvoiceTotals(g.lines),
      issueDate,
      dueDate,
    };
    inv.alreadySent = sent.has(inv.number);
    const vars = templateVars(inv, settings);
    inv.subject = fillTemplate(settings.subjectTemplate, vars);
    inv.body = fillTemplate(settings.bodyTemplate, vars);
    inv.fileName = pdfFileName(inv);
    return inv;
  });

  const missing = only ? [...only].filter((name) => !groups.some((g) => g.client === name)) : [];
  return { settings, mode: forceDraft ? MODE.draft : settings.mode, year, month, invoices, errors, missing };
}

/** 明細シートの行から、指定月の明細だけを取り出して検証する */
function collectLines(rows, year, month) {
  const C = COL.details;
  const lines = [];
  const errors = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2; // 1行目は見出し
    const client = str(r[C.client]);
    const item = str(r[C.item]);
    if (!client && !item && str(r[C.qty]) === '' && str(r[C.price]) === '') return; // 空行
    const date = toDate(r[C.date]);
    if (!date) {
      errors.push({ rowNo, client, message: `日付「${str(r[C.date])}」が読み取れません（例: 2026/09/30）` });
      return;
    }
    if (!isInMonth(date, year, month)) return;

    const qty = parseNumber(r[C.qty]);
    const price = parseNumber(r[C.price]);
    const rate = parseTaxRate(r[C.tax]);
    const rowErrors = [];
    if (!client) rowErrors.push('取引先名が空です');
    if (!item) rowErrors.push('品目が空です');
    if (isNaN(qty)) rowErrors.push(`数量「${str(r[C.qty])}」が数字ではありません`);
    if (isNaN(price)) rowErrors.push(`単価「${str(r[C.price])}」が数字ではありません`);
    if (rate === null) rowErrors.push(`税区分「${str(r[C.tax])}」は 10% / 8% / 非課税 のどれかにしてください`);
    if (rowErrors.length) {
      rowErrors.forEach((message) => errors.push({ rowNo, client, message }));
      return;
    }
    lines.push({ rowNo, date, client, item, qty, price, rate, amount: truncYen(qty * price) });
  });
  return { lines, errors };
}

/** 明細を取引先ごとにまとめる。並びは「取引先」シートの順（載っていない取引先は名前順で後ろ） */
function groupByClient(lines, clientOrder) {
  const map = new Map();
  lines.forEach((l) => {
    if (!map.has(l.client)) map.set(l.client, []);
    map.get(l.client).push(l);
  });
  const order = clientOrder || [];
  const rank = (name) => (order.indexOf(name) < 0 ? Infinity : order.indexOf(name));
  return [...map.keys()]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((client) => ({ client, lines: map.get(client).slice().sort((a, b) => a.date - b.date || a.rowNo - b.rowNo) }));
}

/**
 * 1枚の請求書の金額を計算する（適格請求書のルール）。
 * 税率ごとに税抜金額を合計してから、税率ごとに1回だけ消費税を計算し、1円未満を切り捨てる。
 * 明細1行ずつ消費税を計算して足すことはしない。
 */
function calcInvoiceTotals(lines) {
  const byRate = {};
  lines.forEach((l) => {
    byRate[l.rate] = byRate[l.rate] || { rate: l.rate, base: 0, tax: 0 };
    byRate[l.rate].base += l.amount;
  });
  let subtotal = 0;
  let tax = 0;
  TAX_RATES.forEach((rate) => {
    const g = byRate[rate];
    if (!g) return;
    g.tax = rate === 0 ? 0 : truncYen((g.base * rate) / 100);
    subtotal += g.base;
    tax += g.tax;
  });
  return { byRate, subtotal, tax, total: subtotal + tax, hasReduced: Boolean(byRate[8]) };
}

/** 請求書の「税率別内訳」欄に書く行 [区分, 対象金額, 消費税額]（使った税率だけ） */
function taxBreakdownRows(totals) {
  return TAX_RATES.filter((rate) => totals.byRate[rate]).map((rate) => {
    const g = totals.byRate[rate];
    return [TAX_LABEL[rate].summary, g.base, rate === 0 ? '—' : g.tax];
  });
}

/** 請求書の明細欄に書く行 [日付, 品目, 数量, 単価, 税率, 金額]。軽減税率の品目には ※ をつける */
function invoiceItemRows(lines) {
  return lines.map((l) => [l.date, l.rate === 8 ? `${l.item} ※` : l.item, l.qty, l.price, TAX_LABEL[l.rate].short, l.amount]);
}

/**
 * 請求書番号を決める（INV-202609-001）。
 * 送信履歴に同じ月・同じ取引先の番号があればそれを使い回し、なければその月の最大番号の次にする。
 * こうしておくと、取引先が増えても既存の番号がずれず、二重送信の判定が効く。
 * 状態を「取消」にした番号は使い回さない（訂正版は新しい番号で作り直す）。
 */
function assignInvoiceNumbers(clientNames, year, month, historyRows, prefix) {
  const H = COL.history;
  const ym = `${year}${pad2(month)}`;
  const rows = historyRows || [];
  const cancelled = new Set(rows.filter((r) => str(r[H.status]).startsWith(STATUS.cancelled)).map((r) => str(r[H.number])));
  const existing = new Map();
  let maxSeq = 0;
  rows.forEach((r) => {
    const number = str(r[H.number]);
    const parsed = parseInvoiceNumber(number);
    if (!parsed || parsed.yyyymm !== ym) return;
    maxSeq = Math.max(maxSeq, parsed.seq); // 取消した番号も欠番として数える
    if (cancelled.has(number)) return;
    const client = str(r[H.client]);
    const isSent = str(r[H.status]).startsWith(STATUS.sent);
    if (client && (!existing.has(client) || isSent)) existing.set(client, number); // 送信済みの番号を優先
  });
  const result = {};
  clientNames.forEach((name) => {
    result[name] = existing.get(name) || formatInvoiceNumber(prefix || CONFIG.invoicePrefix, year, month, ++maxSeq);
  });
  return result;
}

function formatInvoiceNumber(prefix, year, month, seq) {
  return `${prefix}-${year}${pad2(month)}-${String(seq).padStart(3, '0')}`;
}

function parseInvoiceNumber(number) {
  const m = String(number || '').match(/^(.+)-(\d{6})-(\d+)$/);
  return m ? { prefix: m[1], yyyymm: m[2], seq: Number(m[3]) } : null;
}

/** 送信済みでない請求書を、まだ一度も作っていないものから順に並べる（時間切れで止まっても再実行で先に進む） */
function orderTargets(invoices, historyRows) {
  const seen = new Set((historyRows || []).map((r) => str(r[COL.history.number])));
  return invoices.filter((inv) => !inv.alreadySent).sort((a, b) => Number(seen.has(a.number)) - Number(seen.has(b.number)));
}

/** 送信履歴のうち「送信済」の請求書番号 */
function sentInvoiceNumbers(historyRows) {
  const H = COL.history;
  return new Set(
    (historyRows || [])
      .filter((r) => str(r[H.status]).startsWith(STATUS.sent))
      .map((r) => str(r[H.number]))
      .filter(Boolean),
  );
}

/** その請求書番号で最後に作った Gmail 下書きの ID（作り直すときに古い下書きを消すため） */
function latestDraftId(historyRows, number) {
  const H = COL.history;
  let id = '';
  (historyRows || []).forEach((r) => {
    if (str(r[H.number]) === number && str(r[H.draftId])) id = str(r[H.draftId]);
  });
  return id;
}

/** 設定シート（A列=項目, B列=値）を読む。未入力はおすすめの初期値にする */
function parseSettings(rows) {
  const raw = {};
  (rows || []).forEach((r) => {
    const key = str(r[0]);
    if (key && !(key in raw)) raw[key] = r[1];
  });
  const get = (name) => str(raw[SETTING_KEYS[name]]);
  const errors = [];
  const settings = {
    companyName: get('companyName'),
    address: get('address'),
    registrationNo: normalizeRegistrationNumber(get('registrationNo')),
    bank: get('bank'),
    dueDays: null, // null = 翌月末
    mode: MODE.draft,
    subjectTemplate: get('subject') || CONFIG.defaultSubject,
    bodyTemplate: get('body') || CONFIG.defaultBody,
    remarks: get('remarks'),
  };

  if (!settings.companyName) errors.push('設定: 「自社名」を入力してください');
  if (settings.registrationNo && !isValidRegistrationNumber(settings.registrationNo)) {
    errors.push(`設定: 登録番号「${get('registrationNo')}」は「T＋13桁の数字」で入力してください（未登録なら空欄）`);
  }
  const due = toHalfWidth(get('dueDays')).replace(/日後?$/, '');
  if (due && due !== '翌月末') {
    const n = parseNumber(due);
    if (Number.isInteger(n) && n >= 0) settings.dueDays = n;
    else errors.push(`設定: 支払期限日数「${get('dueDays')}」は空欄（翌月末）か日数の数字にしてください`);
  }
  const mode = get('mode');
  if (mode === MODE.send) settings.mode = MODE.send;
  else if (mode && mode !== MODE.draft) errors.push(`設定: 送信モードは「${MODE.draft}」か「${MODE.send}」にしてください（いま: ${mode}）`);
  return { settings, errors };
}

/** 取引先シートを読む。名前の重複は記録しておき、使うときにエラーにする */
function parseClients(rows) {
  const C = COL.clients;
  const byName = new Map();
  const order = [];
  const duplicates = new Set();
  (rows || []).forEach((r, i) => {
    const name = str(r[C.name]);
    if (!name) return;
    if (byName.has(name)) {
      duplicates.add(name);
      return;
    }
    byName.set(name, {
      name,
      honorific: str(r[C.honorific]) || CONFIG.defaultHonorific,
      email: toHalfWidth(str(r[C.email])).replace(/\s/g, ''),
      rowNo: i + 2,
    });
    order.push(name);
  });
  return { byName, order, duplicates };
}

/** 「a@example.com, b@example.com」のようなカンマ区切りにも対応 */
function isValidEmailList(s) {
  const list = String(s || '')
    .split(/[,、;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return list.length > 0 && list.every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}

/** 登録番号の入力ゆれ（全角・ハイフン・小文字・T の付け忘れ）をそろえる */
function normalizeRegistrationNumber(s) {
  const v = toHalfWidth(String(s || ''))
    .replace(/[\s\-‐－ー]/g, '')
    .toUpperCase();
  return /^\d{13}$/.test(v) ? `T${v}` : v;
}

function isValidRegistrationNumber(s) {
  return /^T\d{13}$/.test(s);
}

/** 「10%」「10％」「0.1」（パーセント表示のセル）「軽減8%」「非課税」などを 10 / 8 / 0 にする。読めなければ null */
function parseTaxRate(v) {
  if (v === '' || v === null || v === undefined) return CONFIG.defaultTaxRate;
  if (typeof v === 'number') {
    if (v === 0.1 || v === 10) return 10;
    if (v === 0.08 || v === 8) return 8;
    if (v === 0) return 0;
    return null;
  }
  const s = toHalfWidth(String(v)).replace(/\s/g, '');
  if (s === '') return CONFIG.defaultTaxRate;
  if (/非課税|不課税|対象外/.test(s)) return 0;
  const digits = s.replace(/[^\d.]/g, ''); // 「8%（軽減）」「※8％」なども数字だけ見る
  if (digits === '') return null;
  const n = Number(digits);
  if (n === 10 || n === 0.1) return 10;
  if (n === 8 || n === 0.08) return 8;
  if (n === 0) return 0;
  return null;
}

/** 「1,200」「¥1,200」「１２００円」などを数値にする。読めなければ NaN */
function parseNumber(v) {
  if (typeof v === 'number') return v;
  const s = toHalfWidth(str(v)).replace(/[,\s円¥￥]/g, '');
  if (s === '') return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 1円未満を切り捨てる（0 に近い方へ）。0.29×100 のような小数の誤差は先に丸めて吸収する */
function truncYen(x) {
  const abs = Math.floor(Math.round(Math.abs(x) * 1e6) / 1e6);
  return x < 0 ? 0 - abs : abs; // 0 - 0 は -0 にならない
}

/** 日付セル（Date）または「2026/09/30」「2026-09-30」「2026年9月30日」を Date にする */
function toDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  const s = toHalfWidth(str(v));
  const m = s.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 && date.getDate() === d ? date : null; // 2026/02/30 などは弾く
}

function isInMonth(date, year, month) {
  return date.getFullYear() === year && date.getMonth() + 1 === month;
}

/** 実行日から見た対象月。offset = 0 で今月、-1 で先月 */
function targetMonth(now, offset) {
  const d = new Date(now.getFullYear(), now.getMonth() + (offset || 0), 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** その月の末日（month は 1〜12。13 を渡すと翌年1月） */
function endOfMonth(year, month) {
  return new Date(year, month, 0);
}

/** 支払期限: 日数が空欄（null）なら翌月末、数字なら発行日の◯日後 */
function calcDueDate(issueDate, days) {
  if (days === null || days === undefined || days === '') {
    return endOfMonth(issueDate.getFullYear(), issueDate.getMonth() + 2);
  }
  return new Date(issueDate.getFullYear(), issueDate.getMonth(), issueDate.getDate() + Number(days));
}

/** 件名・本文テンプレに差し込む値 */
function templateVars(inv, settings) {
  return {
    取引先名: inv.client,
    敬称: inv.honorific,
    金額: formatYen(inv.totals.total),
    期限: formatDateJa(inv.dueDate),
    請求書番号: inv.number,
    対象月: `${inv.year}年${inv.month}月`,
    発行日: formatDateJa(inv.issueDate),
    自社名: settings.companyName,
  };
}

/** 「{取引先名} 様」のような差し込みを埋める。全角の｛｝でもよい。知らない名前はそのまま残す */
function fillTemplate(template, vars) {
  return String(template || '').replace(/[{｛]([^{}｛｝]+)[}｝]/g, (match, key) => {
    const k = key.trim();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : match;
  });
}

/** Drive の書き出し URL（A4 縦・幅に合わせる・枠線なし） */
function buildPdfExportUrl(spreadsheetId, gid) {
  const params = {
    format: 'pdf',
    gid,
    size: 'A4',
    portrait: 'true',
    fitw: 'true',
    gridlines: 'false',
    printtitle: 'false',
    sheetnames: 'false',
    pagenum: 'UNDEFINED',
    fzr: 'false',
    horizontal_alignment: 'CENTER',
    top_margin: '0.5',
    bottom_margin: '0.5',
    left_margin: '0.5',
    right_margin: '0.5',
  };
  const query = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${query}`;
}

/** 「請求書_INV-202609-001_株式会社サンプル.pdf」。ファイル名に使えない文字は _ にする */
function pdfFileName(inv) {
  return `請求書_${inv.number}_${String(inv.client).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
}

/** 選んだ行から取引先名を重複なしで取り出す（見出し行は除く） */
function namesFromSelection(rows, nameCol) {
  const names = [];
  (rows || []).forEach((r) => {
    const name = str(r[nameCol]);
    if (name && name !== HEADERS.clients[COL.clients.name] && !names.includes(name)) names.push(name);
  });
  return names;
}

/** 実行前の確認ダイアログの文面 */
function confirmMessage(plan) {
  const targets = plan.invoices.filter((inv) => !inv.alreadySent);
  const skipped = plan.invoices.filter((inv) => inv.alreadySent);
  const action =
    plan.mode === MODE.send
      ? 'メールで【送信】します。送信は取り消せません。'
      : 'Gmail の「下書き」に保存します（送信はしません）。';
  const lines = [`${plan.year}年${plan.month}月分の請求書 ${targets.length}件を PDF で作成し、${action}`, ''];
  targets.forEach((inv) => lines.push(`・${inv.client} ${inv.honorific}　${formatYen(inv.totals.total)}（${inv.number}）→ ${inv.email}`));
  if (skipped.length) lines.push('', `送信済みのためスキップ: ${skipped.map((inv) => inv.client).join('、')}`);
  if (plan.missing.length) lines.push('', `この月の明細がない取引先: ${plan.missing.join('、')}`);
  lines.push('', 'よろしいですか？');
  return lines.join('\n');
}

/** 作るものがなかったときの説明 */
function noTargetMessage(plan) {
  if (!plan.invoices.length) {
    const lines = [`${plan.year}年${plan.month}月の明細がありません。「明細」シートの日付を確認してください。`];
    if (plan.missing.length) lines.push(`（選んだ取引先: ${plan.missing.join('、')}）`);
    return lines.join('\n');
  }
  return `${plan.year}年${plan.month}月分はすべて送信済みです（「送信履歴」シートに記録があります）。`;
}

/** 実行後の結果ダイアログの文面 */
function resultMessage(mode, result, folderUrl) {
  const n = result.done.length;
  const lines = [mode === MODE.send ? `${n}件を送信しました。` : `${n}件を Gmail の下書きに保存しました。`];
  if (result.skipped.length) lines.push(`送信済みのためスキップ: ${result.skipped.map((inv) => inv.client).join('、')}`);
  if (result.failed.length) {
    lines.push('', `失敗 ${result.failed.length}件（「送信履歴」シートにも記録しました）:`);
    result.failed.forEach((f) => lines.push(`・${f.inv.client}: ${f.message}`));
  }
  if (result.rest.length) {
    lines.push('', `時間切れで未処理: ${result.rest.map((inv) => inv.client).join('、')}`, 'もう一度同じメニューを実行してください（送信済みの分は自動でスキップされます）。');
  }
  lines.push('', `PDF の保存先: ${folderUrl}`);
  if (mode !== MODE.send && result.done.length) lines.push('', 'Gmail の「下書き」で内容と添付 PDF を確認してから送信してください。');
  return lines.join('\n');
}

/** 入力エラーの一覧（多すぎるときは先頭だけ） */
function formatErrors(errors, max) {
  const limit = max || 15;
  const lines = errors.slice(0, limit).map((e) => `・${e}`);
  if (errors.length > limit) lines.push(`ほか ${errors.length - limit}件`);
  return lines.join('\n');
}

/** 明細が多いときに下の欄がどれだけずれるか（テンプレの行番号を計算する） */
function templateLayout(itemCount, tpl) {
  const T = tpl || TPL;
  const extraRows = Math.max(0, itemCount - T.itemRows);
  const shift = (row) => row + extraRows;
  return {
    extraRows,
    insertAfterRow: T.itemFirstRow + T.itemRows - 1,
    itemFirstRow: T.itemFirstRow,
    itemRows: T.itemRows + extraRows,
    subtotalRow: shift(T.subtotalRow),
    taxRow: shift(T.taxRow),
    totalRow: shift(T.totalRow),
    breakdownFirstRow: shift(T.breakdownFirstRow),
    reducedNoteRow: shift(T.reducedNoteRow),
    remarksRow: shift(T.remarksRow),
  };
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function formatYen(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}円`;
}

function formatDateJa(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 全角の英数字・記号を半角にする */
function toHalfWidth(s) {
  return String(s)
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONFIG,
    MODE,
    STATUS,
    TPL,
    planInvoices,
    collectLines,
    groupByClient,
    calcInvoiceTotals,
    taxBreakdownRows,
    invoiceItemRows,
    assignInvoiceNumbers,
    orderTargets,
    formatInvoiceNumber,
    parseInvoiceNumber,
    sentInvoiceNumbers,
    latestDraftId,
    parseSettings,
    parseClients,
    isValidEmailList,
    normalizeRegistrationNumber,
    isValidRegistrationNumber,
    parseTaxRate,
    parseNumber,
    truncYen,
    toDate,
    isInMonth,
    targetMonth,
    endOfMonth,
    calcDueDate,
    templateVars,
    fillTemplate,
    buildPdfExportUrl,
    pdfFileName,
    namesFromSelection,
    confirmMessage,
    noTargetMessage,
    resultMessage,
    formatErrors,
    templateLayout,
    monthKey,
    formatYen,
    formatDateJa,
    toHalfWidth,
  };
}
