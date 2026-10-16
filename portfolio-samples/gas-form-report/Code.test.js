// node --test で実行する。Google のサービスを使わない関数と、モックで差し替えた onFormSubmit を検証する。
const test = require('node:test');
const assert = require('node:assert');
const { summarizeMonth, toTable, formatReportMail, parseAmount, onFormSubmit, setupTriggers, getResponseSheet } = require('./Code.js');

const rows = [
  [new Date(2026, 8, 3), '佐藤', '営業部', '交通費', 1200, '客先訪問'],
  [new Date(2026, 8, 10), '鈴木', '営業部', '会議費', '¥3,000', '打ち合わせ'],
  [new Date(2026, 8, 15), '高橋', '開発部', '交通費', '800円', '出張'],
  [new Date(2026, 8, 20), '田中', '開発部', '書籍', 4500, '技術書'],
  [new Date(2026, 9, 1), '伊藤', '営業部', '交通費', 999, '翌月分なので対象外'],
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
  const chain = { forSpreadsheet: () => chain, onFormSubmit: () => chain, timeBased: () => chain, onMonthDay: () => chain, atHour: () => chain, create: () => {} };
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
});
