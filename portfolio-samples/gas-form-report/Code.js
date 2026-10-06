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

/** 最初に1回だけ実行する: フォーム送信時と毎月1日のトリガーを作る */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sendLastMonthReport').timeBased().onMonthDay(1).atHour(9).create();
}

/** フォームが送信されたら承認者にメールで知らせる */
function onFormSubmit(e) {
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
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  buildMonthlyReport(target.getFullYear(), target.getMonth() + 1, true);
}

/** 手動実行用: 今月分の途中経過をシートに出す（メールは送らない） */
function buildThisMonthReport() {
  const now = new Date();
  buildMonthlyReport(now.getFullYear(), now.getMonth() + 1, false);
}

function buildMonthlyReport(year, month, sendMail) {
  const ss = SpreadsheetApp.getActive();
  const values = ss.getSheetByName(CONFIG.responseSheet).getDataRange().getValues().slice(1);
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

// ---- ここから下は Google のサービスを使わない純粋な関数（Node でテストできる） ----

/** 指定月の行を、部署 × 経費区分 で合計する */
function summarizeMonth(rows, year, month) {
  const byDept = {};
  const categories = new Set();
  let total = 0;
  let count = 0;
  rows.forEach((r) => {
    const ts = r[COL.timestamp] instanceof Date ? r[COL.timestamp] : new Date(r[COL.timestamp]);
    if (isNaN(ts) || ts.getFullYear() !== year || ts.getMonth() + 1 !== month) return;
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
  module.exports = { summarizeMonth, toTable, formatReportMail, parseAmount, formatYen };
}
