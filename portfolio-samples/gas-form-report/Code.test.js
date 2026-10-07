// node --test で実行する。Google のサービスを使わない関数だけを検証する。
const test = require('node:test');
const assert = require('node:assert');
const { summarizeMonth, toTable, formatReportMail, parseAmount } = require('./Code.js');

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
