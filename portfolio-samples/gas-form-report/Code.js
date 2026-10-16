/**
 * 経費申請フォーム → 承認者への通知 → 月次集計レポート を自動化する Google Apps Script。
 *
 * 前提: Googleフォームの回答先スプレッドシートに、このスクリプトを設定する。
 * フォームの項目: 氏名 / 部署 / 経費区分 / 金額 / 内容
 */

const CONFIG = {
  responseSheet: 'フォームの回答 1',
  approverEmail: 'approver@example.com', // 承認者のアドレス（納品時に依頼主のものへ変更）
  reportEmail: 'manager@example.com', // 月次レポートの送り先
  timezone: 'Asia/Tokyo',
};

// 列の位置（フォームの回答シートの並び順）
const COL = { timestamp: 0, name: 1, dept: 2, category: 3, amount: 4, note: 5 };

const HANDLERS = ['onFormSubmit', 'sendLastMonthReport'];

/** 最初に1回だけ実行する: フォーム送信時と毎月1日のトリガーを作る（何度実行しても1組だけになる） */
function setupTriggers() {
  // このスクリプトのトリガーだけを作り直し、同じプロジェクトにある別の自動処理のトリガーには触れない
  ScriptApp.getProjectTriggers()
    .filter((t) => HANDLERS.includes(t.getHandlerFunction()))
    .forEach((t) => ScriptApp.deleteTrigger(t));
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  // 時刻は CONFIG.timezone（日本時間）で決める。スクリプトのタイムゾーンが違っていても毎月1日の朝9時台に動く
  ScriptApp.newTrigger('sendLastMonthReport').timeBased().onMonthDay(1).atHour(9).inTimezone(CONFIG.timezone).create();
}

/** フォームが送信されたら承認者にメールで知らせる */
function onFormSubmit(e) {
  // トリガーはスプレッドシート全体に付くので、同じファイルにつないだ別のフォームの送信でも呼ばれる。
  // 回答シート以外からの送信は、列の並びが違うので何もしない
  const target = getResponseSheet(SpreadsheetApp.getActive());
  if (e.range && target && e.range.getSheet().getSheetId() !== target.getSheetId()) return;
  const row = e.values; // 文字列の配列
  const amount = parseAmount(row[COL.amount]);
  const subject = `【経費申請】${row[COL.name]}さん ${formatYen(amount)}`;
  const body = [
    '経費申請が届きました。',
    '',
    `申請者: ${row[COL.name]}（${row[COL.dept]}）`,
    `区分　: ${row[COL.category]}`,
    `金額　: ${formatYen(amount)}`,
    `内容　: ${row[COL.note]}`,
    '',
    `一覧: ${SpreadsheetApp.getActive().getUrl()}`,
  ].join('\n');
  MailApp.sendEmail(CONFIG.approverEmail, subject, body);
}

/** 先月分を集計してシートを作り、レポートをメールする（毎月1日に自動実行） */
function sendLastMonthReport() {
  const { year, month } = reportMonth(new Date(), -1);
  buildMonthlyReport(year, month, true);
}

/** 手動実行用: 今月分の途中経過をシートに出す（メールは送らない） */
function buildThisMonthReport() {
  const { year, month } = reportMonth(new Date(), 0);
  buildMonthlyReport(year, month, false);
}

function buildMonthlyReport(year, month, sendMail) {
  const ss = SpreadsheetApp.getActive();
  const source = getResponseSheet(ss);
  if (!source) {
    throw new Error(`回答シートが見つかりません。CONFIG.responseSheet（今は「${CONFIG.responseSheet}」）に回答シートの名前を書いてください。`);
  }
  const values = source.getDataRange().getValues().slice(1);
  const summary = summarizeMonth(values, year, month);

  const name = `集計_${year}-${String(month).padStart(2, '0')}`;
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  const table = toTable(summary);
  sheet.getRange(1, 1, table.length, table[0].length).setValues(table);
  sheet.getRange(1, 1, 1, table[0].length).setFontWeight('bold').setBackground('#e8eafc');
  sheet.getRange(2, 2, table.length - 1, table[0].length - 1).setNumberFormat('#,##0');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, table[0].length);

  if (sendMail) {
    MailApp.sendEmail(CONFIG.reportEmail, `【経費レポート】${year}年${month}月`, formatReportMail(summary, ss.getUrl()));
  }
}

/**
 * 回答シートを探す。CONFIG.responseSheet の名前が無いとき（英語環境で「Form Responses 1」になっている等）は、
 * フォームの回答シートらしい名前の最初のシートを使う
 */
function getResponseSheet(ss) {
  return (
    ss.getSheetByName(CONFIG.responseSheet) ||
    ss.getSheets().find((sh) => /^(フォームの回答|Form Responses)/.test(sh.getName())) ||
    null
  );
}

// ---- ここから下は Google のサービスを使わない純粋な関数（Node でテストできる） ----

/** 指定月の行を、部署 × 経費区分 で合計する */
function summarizeMonth(rows, year, month) {
  const byDept = {};
  const categories = new Set();
  let total = 0;
  let count = 0;
  rows.forEach((r) => {
    const ym = yearMonthOf(r[COL.timestamp]);
    if (!ym || ym.year !== year || ym.month !== month) return;
    const amount = parseAmount(r[COL.amount]);
    const dept = String(r[COL.dept] || '未入力').trim();
    const cat = String(r[COL.category] || 'その他').trim();
    byDept[dept] = byDept[dept] || {};
    byDept[dept][cat] = (byDept[dept][cat] || 0) + amount;
    categories.add(cat);
    total += amount;
    count += 1;
  });
  return { year, month, byDept, categories: [...categories].sort(), total, count };
}

/**
 * タイムスタンプが CONFIG.timezone（日本時間）で何年何月かを返す。読めなければ null。
 * Code.js だけを貼り付けた場合など、スクリプトのタイムゾーンが日本時間でないと、
 * 日本時間の10月1日0時30分が UTC では9月30日になり、前の月に数えられてしまうのを防ぐ
 */
function yearMonthOf(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : civilYearMonth(v);
  // 文字のタイムスタンプ（「2026/10/01 0:30:00」など）は、書かれている日付をそのまま使う
  const m = String(v || '').trim().match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月]\d{1,2}/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : civilYearMonth(d);
}

/** ある瞬間が CONFIG.timezone で何年何月か */
function civilYearMonth(d) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timezone, year: 'numeric', month: 'numeric' })
    .formatToParts(d)
    .forEach((p) => (parts[p.type] = Number(p.value)));
  return { year: parts.year, month: parts.month };
}

/** 実行した瞬間から見た集計対象の月（日本時間で判定）。offset = 0 で今月、-1 で先月 */
function reportMonth(now, offset) {
  const { year, month } = civilYearMonth(now);
  const d = new Date(year, month - 1 + (offset || 0), 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 集計結果をシートに書ける2次元配列にする（最終行・最終列に合計） */
function toTable(summary) {
  const header = ['部署', ...summary.categories, '合計'];
  const depts = Object.keys(summary.byDept).sort();
  const body = depts.map((d) => {
    const cells = summary.categories.map((c) => summary.byDept[d][c] || 0);
    return [d, ...cells, cells.reduce((a, b) => a + b, 0)];
  });
  const colTotals = summary.categories.map((c) => depts.reduce((a, d) => a + (summary.byDept[d][c] || 0), 0));
  return [header, ...body, ['合計', ...colTotals, summary.total]];
}

function formatReportMail(summary, url) {
  const lines = [`${summary.year}年${summary.month}月の経費申請は ${summary.count}件、合計 ${formatYen(summary.total)} でした。`, ''];
  Object.keys(summary.byDept).sort().forEach((d) => {
    const sum = Object.values(summary.byDept[d]).reduce((a, b) => a + b, 0);
    lines.push(`・${d}: ${formatYen(sum)}`);
  });
  lines.push('', `詳細: ${url}`);
  return lines.join('\n');
}

/** 「1,200」「¥1200」「1200円」などの入力を数値にする */
function parseAmount(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatYen(n) {
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

if (typeof module !== 'undefined') {
  module.exports = { summarizeMonth, toTable, formatReportMail, parseAmount, formatYen, onFormSubmit, setupTriggers, getResponseSheet, yearMonthOf, reportMonth };
}
