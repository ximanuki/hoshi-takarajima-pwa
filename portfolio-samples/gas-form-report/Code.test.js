// node --test で実行する。Google のサービスを使わない関数と、モックで差し替えた onFormSubmit を検証する。
const test = require('node:test');
const assert = require('node:assert');
const { summarizeMonth, toTable, formatReportMail, parseAmount, onFormSubmit, setupTriggers, getResponseSheet, yearMonthOf, reportMonth } = require('./Code.js');

/** 日本時間のその日時を表す Date（回答シートのタイムスタンプは日本時間で記録される） */
const jst = (y, mo, d, h = 0, mi = 0) => new Date(Date.UTC(y, mo, d, h - 9, mi));

const rows = [
  [jst(2026, 8, 3, 10), '佐藤', '営業部', '交通費', 1200, '客先訪問'],
  [jst(2026, 8, 10, 14), '鈴木', '営業部', '会議費', '¥3,000', '打ち合わせ'],
  [jst(2026, 8, 15, 9), '高橋', '開発部', '交通費', '800円', '出張'],
  [jst(2026, 8, 20, 18), '田中', '開発部', '書籍', 4500, '技術書'],
  [jst(2026, 9, 1, 0, 30), '伊藤', '営業部', '交通費', 999, '翌月1日の0時半なので対象外'],
  ['', '', '', '', '', ''],
];

test('parseAmount は記号や単位つきの入力を数値にする', () => {
  assert.strictEqual(parseAmount('¥3,000'), 3000);
  assert.strictEqual(parseAmount('800円'), 800);
  assert.strictEqual(parseAmount(1200), 1200);
  assert.strictEqual(parseAmount('なし'), 0);
});

test('summarizeMonth は指定月だけを部署×区分で合計する', () => {
  const s = summarizeMonth(rows, 2026, 9);
  assert.strictEqual(s.count, 4);
  assert.strictEqual(s.total, 9500);
  assert.deepStrictEqual(s.byDept['営業部'], { 交通費: 1200, 会議費: 3000 });
  assert.deepStrictEqual(s.categories, ['交通費', '会議費', '書籍'].sort());
});

test('月の判定は日本時間で行う（スクリプトのタイムゾーンが日本時間でなくても）', () => {
  // 日本時間 2026-10-01 00:30 は UTC では 9月30日 15:30
  assert.deepStrictEqual(yearMonthOf(jst(2026, 9, 1, 0, 30)), { year: 2026, month: 10 });
  assert.deepStrictEqual(yearMonthOf(jst(2026, 8, 30, 23, 59)), { year: 2026, month: 9 });
  // 文字のタイムスタンプは書かれた日付のまま
  assert.deepStrictEqual(yearMonthOf('2026/10/01 0:30:00'), { year: 2026, month: 10 });
  assert.strictEqual(yearMonthOf(''), null);
  assert.strictEqual(yearMonthOf('なし'), null);
  // 実行時刻も日本時間の「今日」で月を決める（UTC 9/30 20:00 = 日本時間 10/1 05:00）
  assert.deepStrictEqual(reportMonth(new Date(Date.UTC(2026, 8, 30, 20)), 0), { year: 2026, month: 10 });
  assert.deepStrictEqual(reportMonth(new Date(Date.UTC(2026, 8, 30, 20)), -1), { year: 2026, month: 9 });
  assert.deepStrictEqual(reportMonth(jst(2026, 0, 1, 9), -1), { year: 2025, month: 12 });
});

test('toTable は合計行・合計列つきの表を作る', () => {
  const t = toTable(summarizeMonth(rows, 2026, 9));
  const header = t[0];
  assert.strictEqual(header[0], '部署');
  assert.strictEqual(header.at(-1), '合計');
  assert.deepStrictEqual(t.at(-1).slice(0, 1), ['合計']);
  assert.strictEqual(t.at(-1).at(-1), 9500);
  t.slice(1, -1).forEach((r) => {
    assert.strictEqual(r.at(-1), r.slice(1, -1).reduce((a, b) => a + b, 0));
  });
});

test('formatReportMail は件数と部署別合計を書く', () => {
  const body = formatReportMail(summarizeMonth(rows, 2026, 9), 'https://example.com/sheet');
  assert.match(body, /4件、合計 9,500円/);
  assert.match(body, /営業部: 4,200円/);
  assert.match(body, /開発部: 5,300円/);
});

/** モック: 名前と id だけを持つシートと、それを並べたスプレッドシート */
const sheet = (name, id) => ({ getName: () => name, getSheetId: () => id });
function installGas(t, sheets) {
  const sent = [];
  const ss = {
    getSheetByName: (n) => sheets.find((sh) => sh.getName() === n) || null,
    getSheets: () => sheets.slice(),
    getUrl: () => 'https://example.com/sheet',
  };
  globalThis.MailApp = { sendEmail: (...args) => sent.push(args) };
  globalThis.SpreadsheetApp = { getActive: () => ss };
  t.after(() => {
    delete globalThis.MailApp;
    delete globalThis.SpreadsheetApp;
  });
  return sent;
}
const submitFrom = (sh) => ({
  range: { getSheet: () => sh },
  values: ['2026/09/03 10:00:00', '佐藤', '営業部', '交通費', '1200', '客先訪問'],
});

test('onFormSubmit は設定した回答シート以外（別のフォーム）からの送信を無視する', (t) => {
  const mine = sheet('フォームの回答 1', 0);
  const other = sheet('フォームの回答 2', 7);
  const sent = installGas(t, [mine, other]);

  onFormSubmit(submitFrom(other));
  assert.strictEqual(sent.length, 0);

  onFormSubmit(submitFrom(mine));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0][1], /佐藤さん 1,200円/);
});

test('英語環境で回答シートが「Form Responses 1」でも、送信を受け付ける', (t) => {
  const mine = sheet('Form Responses 1', 0);
  const other = sheet('Form Responses 2', 7);
  const sent = installGas(t, [mine, other]);
  assert.strictEqual(getResponseSheet(SpreadsheetApp.getActive()), mine);

  onFormSubmit(submitFrom(mine));
  assert.strictEqual(sent.length, 1);
  onFormSubmit(submitFrom(other));
  assert.strictEqual(sent.length, 1);
});

test('setupTriggers は同じプロジェクトにある別の処理のトリガーを消さない', (t) => {
  const trig = (fn) => ({ getHandlerFunction: () => fn });
  const existing = [trig('onFormSubmit'), trig('sendLastMonthReport'), trig('otherAutomation')];
  const deleted = [];
  const created = [];
  const zones = [];
  const chain = {
    forSpreadsheet: () => chain,
    onFormSubmit: () => chain,
    timeBased: () => chain,
    onMonthDay: () => chain,
    atHour: () => chain,
    inTimezone: (tz) => (zones.push(tz), chain),
    create: () => {},
  };
  globalThis.ScriptApp = {
    getProjectTriggers: () => existing,
    deleteTrigger: (tr) => deleted.push(tr.getHandlerFunction()),
    newTrigger: (fn) => (created.push(fn), chain),
  };
  globalThis.SpreadsheetApp = { getActive: () => ({}) };
  t.after(() => {
    delete globalThis.ScriptApp;
    delete globalThis.SpreadsheetApp;
  });

  setupTriggers();
  assert.deepStrictEqual(deleted, ['onFormSubmit', 'sendLastMonthReport']);
  assert.deepStrictEqual(created, ['onFormSubmit', 'sendLastMonthReport']);
  // 月次レポートの「毎月1日9時」は日本時間で決める
  assert.deepStrictEqual(zones, ['Asia/Tokyo']);
});
