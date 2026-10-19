#!/usr/bin/env node
// 生成した「入力ファイルだけ」を読み直して、文書のルールで判定し直し、正解（truth）と突き合わせる自己点検。
//   node verify.mjs --data <入力フォルダ> --sealed <正解フォルダ> [--prev 2026-04-01]
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const DATA = arg('data');
const SEALED = arg('sealed');
const PREV = arg('prev', '2026-04-01');

function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(f);
      f = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      f = '';
      rows.push(row);
      row = [];
    } else f += ch;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
const readCsv = (rel) => parseCsv(decode(fs.readFileSync(path.join(DATA, rel))));
const table = (rel) => {
  const [h, ...rows] = readCsv(rel);
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
};
const day = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000);
function parseDate(s) {
  s = s.normalize('NFKC').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return day(+m[1], +m[2], +m[3]);
  throw new Error('date? ' + s);
}
const normProd = (s) => s.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—―−ーｰ－]/g, '');
const norm6 = (s) => s.normalize('NFKC').replace(/\D/g, '').padStart(6, '0');
const mul = (L, r) => Math.floor((L * r) / 1000);
const INF = day(9999, 12, 31);

// ---- マスタ
const tiers = Object.fromEntries(table('掛率ランク表.csv').map((r) => [r['掛率ランク'], { lo: Math.round(parseFloat(r['下限(%)']) * 10), hi: Math.round(parseFloat(r['上限(%)']) * 10) }]));
const custs = new Map(table('得意先マスタ.csv').map((r) => [norm6(r['得意先コード']), { tier: r['掛率ランク'], rate: Math.round(parseFloat(r['掛率(%)']) * 10) }]));
const prods = new Map(table('商品マスタ.csv').map((r) => [normProd(r['商品コード']), r]));
const versions = new Map();
for (const r of table('定価履歴.csv')) {
  const k = normProd(r['商品コード']);
  if (!versions.has(k)) versions.set(k, []);
  versions.get(k).push({ start: parseDate(r['適用開始日']), price: Number(r['定価(円)']) });
}
for (const v of versions.values()) v.sort((a, b) => a.start - b.start);
const specials = new Map();
for (const r of table('特値登録一覧.csv')) {
  const k = norm6(r['得意先CD']) + '|' + normProd(r['品番']);
  if (!specials.has(k)) specials.set(k, []);
  specials.get(k).push({ price: Number(r['特価']), start: parseDate(r['有効開始日']), end: parseDate(r['有効終了日']) });
}
const R2 = parseDate(PREV);
const agr = new Map();
for (const r of table('価格改定回答状況_最新版.csv')) {
  const t = r['合意状況'].normalize('NFKC').trim();
  let status = 'agreed';
  if (/一部/.test(t)) status = 'partial';
  else if (/見送|合意に至らず|未合意/.test(t)) status = 'declined';
  else if (/協議中/.test(t)) status = 'negotiating';
  agr.set(norm6(r['得意先コード']), {
    status,
    apply: r['適用日'] ? parseDate(r['適用日']) : null,
    excl: new Set(r['対象外カテゴリ'].split(/[;；、,\s]+/).filter(Boolean)),
  });
}
function segs(c, pk) {
  const vs = (versions.get(pk) || []).map((v) => ({ ...v, drop: false }));
  const i = vs.findIndex((v, idx) => idx > 0 && v.start === R2);
  const a = agr.get(c);
  if (i > 0 && a) {
    const cat = prods.get(pk)['カテゴリコード'];
    const kept = a.status === 'declined' || a.status === 'negotiating' || (a.status === 'partial' && a.excl.has(cat));
    if (kept) vs[i].drop = true;
    else if (a.apply && a.apply > R2) vs[i].start = a.apply;
  }
  const out = [];
  for (const v of vs) {
    if (v.drop) continue;
    if (out.length && out[out.length - 1].price === v.price) continue;
    out.push({ start: v.start, price: v.price });
  }
  return out;
}
function parseVol(remark) {
  const s = remark.normalize('NFKC');
  const m = s.match(/数量値引\s*([0-9]+(?:\.[0-9]+)?)\s*%/) || s.match(/まとめ買い\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*引/);
  return m ? Math.round(parseFloat(m[1]) * 10) : null;
}

// ---- 売上明細を読み直して判定
const truth = parseCsv(fs.readFileSync(path.join(SEALED, 'truth/lines.csv'), 'utf8'));
const th = truth[0];
const T = truth.slice(1).map((r) => Object.fromEntries(th.map((k, i) => [k, r[i]])));
const files = [...new Set(T.map((t) => t.file))];
const got = new Map();
for (const f of files) {
  const [h, ...rows] = readCsv(f);
  rows.forEach((r, i) => {
    const o = Object.fromEntries(h.map((k, j) => [k, r[j] ?? '']));
    got.set(f + '#' + (i + 1), o);
  });
}
let bad = 0;
const diffs = {};
const note = (k, msg) => {
  diffs[k] = (diffs[k] || 0) + 1;
  if (diffs[k] <= 3) console.log('DIFF', k, msg);
  bad++;
};
for (const t of T) {
  const o = got.get(t.file + '#' + t.row);
  if (!o) {
    note('missing-row', t.file + '#' + t.row);
    continue;
  }
  const d = parseDate(o['伝票日付']);
  const c = norm6(o['得意先CD']);
  const pk = normProd(o['品番']);
  const qty = Number(o['数量']);
  const billed = Number(o['売単価']);
  const remark = o['摘要'];
  const cost100 = Math.round(parseFloat(o['原価単価']) * 100);
  if (`${o['伝票No']}-${o['明細No']}` !== t.line_id) note('line_id', t.line_id);
  let label;
  let ref = '';
  let short = 0;
  const cu = custs.get(c);
  if (!prods.has(pk) || !cu) label = 'ok_non_product';
  else if (qty < 0) label = 'ok_return';
  else if (billed === 0 && /見本|サンプル|無償|試供/.test(remark.normalize('NFKC'))) label = 'ok_sample';
  else {
    const sg = segs(c, pk);
    const L = (() => {
      let r = null;
      for (const s of sg) if (s.start <= d) r = s.price;
      return r;
    })();
    const idx = sg.findIndex((s, i) => s.start <= d && (!sg[i + 1] || sg[i + 1].start > d));
    const prevL = idx > 0 ? sg[idx - 1].price : null;
    const co = (() => {
      let r = null;
      for (const s of versions.get(pk)) if (s.start <= d) r = s.price;
      return r;
    })();
    const sps = specials.get(c + '|' + pk) || [];
    let sp = null;
    for (const s of sps) if (s.start <= d && d <= s.end && (!sp || s.start > sp.start)) sp = s;
    const normal = mul(L, cu.rate);
    ref = sp ? sp.price : normal;
    const below = 90 * billed < cost100;
    if (billed === ref) {
      if (sp) label = 'ok_special';
      else if (L === co) label = 'ok';
      else {
        const a = agr.get(c);
        label = a.status === 'declined' || a.status === 'negotiating' || (a.status === 'partial' && a.excl.has(prods.get(pk)['カテゴリコード'])) ? 'ok_declined' : 'ok_deferred';
      }
      if (below) {
        label = 'leak_below_margin_floor';
        short = (Math.ceil(cost100 / 90) - billed) * qty;
      }
    } else if (billed > ref) label = 'overcharge';
    else {
      const v = parseVol(remark);
      if (v !== null && Math.floor((ref * (1000 - v)) / 1000) === billed) {
        label = 'ok_volume_discount';
        ref = billed;
        if (below) {
          label = 'leak_below_margin_floor';
          short = (Math.ceil(cost100 / 90) - billed) * qty;
        }
      } else if (!sp && prevL !== null && mul(prevL, cu.rate) === billed) {
        label = 'leak_old_price';
        short = (ref - billed) * qty;
      } else if (sps.some((s) => s.end < d && s.price === billed)) {
        label = 'leak_expired_special';
        short = (ref - billed) * qty;
      } else if (billed < mul(L, tiers[cu.tier].lo) || billed > mul(L, tiers[cu.tier].hi)) {
        label = 'leak_rate_out_of_tier';
        short = (ref - billed) * qty;
      } else label = 'unexplained';
    }
  }
  // 突き合わせ
  const [pat, A, B] = t.ambiguity ? t.ambiguity.split('|') : [];
  if (t.label === 'ambiguous') {
    const a = A.slice(2);
    const b = B.slice(2);
    const okA = pat === 'PARTIAL_NO_CATEGORY' ? label === a : false;
    const okB = pat !== 'PARTIAL_NO_CATEGORY' ? label === b : true;
    // PARTIAL_NO_CATEGORY は「対象外カテゴリが空の一部合意」を全品目合意として読むと A になる
    if (!(okA || okB)) note('ambiguous:' + pat, `${t.line_id} got=${label} A=${a} B=${b}`);
  } else if (label !== t.label) note('label', `${t.file}#${t.row} ${t.line_id} truth=${t.label} got=${label}`);
  else if (t.label.startsWith('leak') && Number(t.shortfall_yen) !== short) note('shortfall', `${t.line_id} truth=${t.shortfall_yen} got=${short}`);
}
console.log('main lines', T.length, 'mismatches', bad, JSON.stringify(diffs));

// ---- 反映チェック
const fu = parseCsv(fs.readFileSync(path.join(SEALED, 'truth/followup_lines.csv'), 'utf8'));
const fh = fu[0];
const F = fu.slice(1).map((r) => Object.fromEntries(fh.map((k, i) => [k, r[i]])));
const master = new Map();
for (const r of table('next/新単価マスタ_20261101.csv')) master.set(norm6(r['得意先CD']) + '|' + normProd(r['品番']), { eff: parseDate(r['適用開始日']), nw: Number(r['売単価']), old: Number(r['旧売単価']) });
const nov = table('next/売上明細_202611.csv');
let fbad = 0;
F.forEach((t, i) => {
  const o = nov[i];
  const d = parseDate(o['伝票日付']);
  const c = norm6(o['得意先CD']);
  const pk = normProd(o['品番']);
  const qty = Number(o['数量']);
  const billed = Number(o['売単価']);
  let label;
  if (!prods.has(pk) || !custs.has(c)) label = 'ok_non_product';
  else if (qty < 0) label = 'ok_return';
  else if (billed === 0 && /見本|サンプル|無償|試供/.test(o['摘要'].normalize('NFKC'))) label = 'ok_sample';
  else {
    const e = master.get(c + '|' + pk);
    if (!e) label = 'not_in_master';
    else {
      const exp = d < e.eff ? e.old : e.nw;
      const v = parseVol(o['摘要']);
      if (billed === exp) label = d < e.eff ? 'ok_before_effective' : 'ok_new_price';
      else if (v !== null && Math.floor((exp * (1000 - v)) / 1000) === billed) label = 'ok_volume_discount';
      else if (d >= e.eff && billed === e.old) label = 'still_old_price';
      else label = 'ambiguous';
    }
  }
  if (label !== t.label) {
    fbad++;
    if (fbad <= 5) console.log('FU DIFF', t.line_id, t.label, label);
  }
});
console.log('followup lines', F.length, 'mismatches', fbad);
process.exit(bad || fbad ? 1 : 0);
