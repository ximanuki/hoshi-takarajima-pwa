#!/usr/bin/env node
/**
 * gen-4: 架空の包装資材・紙製品メーカー「白波紙工株式会社」（直販と代理店）のデータ生成器（ブラインド評価用）
 * 会社名・得意先名・仕入先名・商品・価格・取引はすべて架空です。実在の企業・団体・人物・取引とは関係ありません。
 * Node.js 22 / 依存なし / 固定シード（時計・ロケール・Math.random 不使用）
 *   node generate.mjs --data <入力フォルダ> --sealed <正解フォルダ>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ---------- 引数
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DATA_DIR = path.resolve(argOf('--data', 'out/data'));
const SEALED_DIR = path.resolve(argOf('--sealed', 'out/sealed'));

// ---------- 乱数（mulberry32, 固定シード）
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(0x47454E34 ^ 20261019);
const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const rf = (lo, hi) => lo + rand() * (hi - lo);
const pick = (a) => a[Math.floor(rand() * a.length)];
const chance = (p) => rand() < p;
function shuffle(a) { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }
function wpick(items, weights) { let s = 0; for (const w of weights) s += w; let x = rand() * s; for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x < 0) return items[i]; } return items[items.length - 1]; }

// ---------- 日付（UTC の日数で扱う。時計は使わない）
const DAY = 86400000;
const dayOf = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
const ymdOf = (day) => { const t = new Date(day * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay() }; };
const p2 = (n) => String(n).padStart(2, '0');
const iso = (day) => { const { y, m, d } = ymdOf(day); return `${y}-${p2(m)}-${p2(d)}`; };
const excelDate = (day) => { const { y, m, d } = ymdOf(day); return `${y}/${m}/${d}`; };
const warekiA = (day) => { const { y, m, d } = ymdOf(day); return `R${p2(y - 2018)}/${p2(m)}/${p2(d)}`; };
const warekiLong = (day) => { const { y, m, d } = ymdOf(day); return `令和${y - 2018}年${m}月${d}日`; };
const monthEnd = (y, m) => dayOf(y, m + 1, 1) - 1;

const HIST_START = dayOf(2024, 4, 1);
const SALES_START = dayOf(2025, 1, 1);
const SALES_END = dayOf(2026, 9, 30);
const LAST12_START = dayOf(2025, 10, 1);
const REV1 = dayOf(2025, 4, 1);
const REV2 = dayOf(2026, 4, 1);           // 合意状況ファイルが答えている「前回の改定」
const REV3 = dayOf(2026, 12, 1);          // next/ の次回改定
const COST_RISE = dayOf(2026, 7, 1);      // 原紙値上げ・仕入値上げ（定価は据え置き）
const PF_DOWN = dayOf(2025, 10, 1);
const TP_AUG = dayOf(2026, 8, 1);
const NEXT_START = dayOf(2026, 12, 1);
const NEXT_END = dayOf(2026, 12, 29);

// ---------- 文字
function fw(s) { let o = ''; for (const ch of s) { const c = ch.codePointAt(0); if (c === 0x20) o += '　'; else if (c >= 0x21 && c <= 0x7E) o += String.fromCodePoint(c + 0xFEE0); else o += ch; } return o; }
const fl = Math.floor;
const comma = (n) => { const neg = n < 0; const s = String(Math.abs(n)); let o = ''; for (let i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) o += ','; o += s[i]; } return (neg ? '-' : '') + o; };
const sen2 = (sen) => { const a = Math.abs(sen); return (sen < 0 ? '-' : '') + fl(a / 100) + '.' + p2(a % 100); };
const sen2comma = (sen) => { const a = Math.abs(sen); return (sen < 0 ? '-' : '') + comma(fl(a / 100)) + '.' + p2(a % 100); };
const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
function roundList(x, up) { const unit = x < 1000 ? 10 : x < 10000 ? 50 : 100; return (up ? Math.ceil(x / unit - 1e-9) : Math.round(x / unit)) * unit; }

// ---------- CP932 エンコーダ（TextDecoder の逆引きで作る。依存なし）
function buildCp932() {
  const dec = new TextDecoder('shift_jis');
  const map = new Map();
  for (let i = 0; i < 0x80; i++) map.set(String.fromCharCode(i), [i]);
  for (let i = 0xA1; i <= 0xDF; i++) { const s = dec.decode(new Uint8Array([i])); if (s.length === 1 && s !== '�') map.set(s, [i]); }
  const leads = []; for (let b = 0x81; b <= 0x9F; b++) leads.push(b); for (let b = 0xE0; b <= 0xFC; b++) leads.push(b);
  for (const lead of leads) for (let trail = 0x40; trail <= 0xFC; trail++) {
    if (trail === 0x7F) continue;
    const s = dec.decode(new Uint8Array([lead, trail]));
    if (s.length === 1 && s !== '�' && !map.has(s)) map.set(s, [lead, trail]);
  }
  return (str) => { const out = []; for (const ch of str) { const b = map.get(ch); if (!b) throw new Error(`CP932 に無い文字: ${ch} U+${ch.codePointAt(0).toString(16)}`); for (const x of b) out.push(x); } return Buffer.from(out); };
}
const toCp932 = buildCp932();

// ---------- CSV
const esc = (v) => { const s = String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvAllQuoted = (rows, eol = '\r\n') => rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join(eol) + eol;
const csvMin = (rows, eol = '\r\n') => rows.map((r) => r.map(esc).join(',')).join(eol) + eol;

// ============================================================
// 掛率ランク（架空）
// ============================================================
const TIERS = {
  S: { name: '代理店・二次卸', std: 580, lo: 560, hi: 600, desc: '再販する包装資材商社・二次卸' },
  A: { name: '大口直需', std: 650, lo: 630, hi: 680, desc: '年間取引額の大きい直販の得意先' },
  B: { name: '一般直需', std: 720, lo: 700, hi: 750, desc: '直販の一般得意先' },
  C: { name: '小口直需', std: 800, lo: 780, hi: 830, desc: '小口・不定期の直販得意先' },
  D: { name: 'スポット・新規', std: 900, lo: 880, hi: 950, desc: 'スポット取引・取引開始1年未満' },
};

// ============================================================
// カテゴリと商品（架空）
// ============================================================
const CATDEF = {
  CB: { name: '段ボールケース', ratio: [55, 15, 15, 15], raw: '段ボール原紙（ライナー・中しん）', plant: 'F01', codeBase: 1000, rev1: [6, 9], rev2: [5, 8], rev3: [4, 7], cost1: [4.5, 6], cost2: [6, 8], r0: [0.41, 0.46] },
  CK: { name: '紙器・化粧箱', ratio: [45, 25, 12, 18], raw: '板紙（コートボール・高級白板紙）', plant: 'F01', codeBase: 2000, rev1: [6, 9], rev2: [5, 8], rev3: [4, 7], cost1: [4.5, 6], cost2: [6, 8], r0: [0.40, 0.45] },
  PB: { name: '紙袋', ratio: [50, 22, 10, 18], raw: 'クラフト紙', plant: 'F02', codeBase: 3000, rev1: [6, 8], rev2: [5, 7], rev3: [4, 6], cost1: [4.5, 6], cost2: [6, 8], r0: [0.41, 0.46] },
  WP: { name: '包装紙・ラッピング', ratio: [52, 18, 12, 18], raw: '包装用紙・薄葉紙', plant: 'F02', codeBase: 3500, rev1: [6, 8], rev2: [5, 7], rev3: [4, 6], cost1: [4.5, 6], cost2: [6, 8], r0: [0.41, 0.46] },
  KK: { name: '紙管・紙芯', ratio: [48, 20, 17, 15], raw: '紙管原紙', plant: 'F02', codeBase: 4000, rev1: [6, 9], rev2: [5, 8], rev3: [4, 7], cost1: [4.5, 6], cost2: [6, 8], r0: [0.41, 0.46] },
  KS: { name: '紙製緩衝材', ratio: [50, 18, 17, 15], raw: '古紙パルプ・更紙', plant: 'F03', codeBase: 4500, rev1: [6, 8], rev2: [5, 7], rev3: [4, 6], cost1: [4.5, 6], cost2: [6, 8], r0: [0.41, 0.46] },
  FT: { name: '紙製食品容器', ratio: [47, 23, 15, 15], raw: '食品用板紙・耐油紙', plant: 'F03', codeBase: 5000, rev1: [6, 9], rev2: [5, 8], rev3: [4, 7], cost1: [4.5, 6], cost2: [6, 8], r0: [0.40, 0.45] },
  LB: { name: 'ラベル・シール', ratio: [40, 30, 10, 20], raw: 'ラベル原紙・粘着剤', plant: 'F03', codeBase: 6000, rev1: [3, 5], rev2: [3, 4], rev3: [3, 3], cost1: [2.5, 3.5], cost2: [3, 4], r0: [0.38, 0.43] },
  TP: { name: 'テープ・結束資材（仕入品）', ratio: [70, 8, 7, 15], raw: '仕入品（粘着テープ・PPバンド）', plant: null, codeBase: 7000, rev1: [4, 5], rev2: [0, 0], rev3: [5, 5], cost1: [3, 3], cost2: [8, 10], r0: [0.42, 0.45] },
  PF: { name: 'ポリ袋・フィルム（仕入品）', ratio: [72, 7, 8, 13], raw: '仕入品（ポリエチレン・OPP）', plant: null, codeBase: 7500, rev1: [0, 0], rev2: [0, 0], rev3: [0, 0], cost1: [0, 0], cost2: [0, 0], r0: [0.43, 0.48] },
};
const CAT_ORDER = ['CB', 'CK', 'PB', 'WP', 'KK', 'KS', 'FT', 'LB', 'TP', 'PF'];
const LOTS = { CB: [2, 30], CK: [1, 15], PB: [1, 20], WP: [1, 10], KK: [50, 500], KS: [1, 20], FT: [1, 20], LB: [1, 30], TP: [1, 20], PF: [1, 30] };

const products = [];
const seq = {};
function addProduct(cat, name, unit, rawPrice, opts = {}) {
  const n = (seq[cat] = (seq[cat] || 0) + 1);
  const code = `${cat}-${CATDEF[cat].codeBase + n}`;
  const base = roundList(rawPrice * rf(0.95, 1.05), false);
  products.push({ code, cat, name, unit, lot: LOTS[cat], base, thin: !!opts.thin, supplier: opts.supplier || CATDEF[cat].plant, intro: null, disc: null, pfDown: false, augUp: false, listSegs: [], costSegs: [] });
  return products[products.length - 1];
}
function buildCatalog() {
  // CB 段ボールケース
  const cbSizes = [[200, 150, 100], [250, 200, 150], [300, 200, 150], [300, 250, 200], [350, 250, 200], [400, 300, 200], [400, 300, 300], [450, 350, 300], [500, 350, 300], [500, 400, 350], [550, 400, 400], [600, 400, 400], [600, 500, 400], [700, 500, 500]];
  const surf = ([W, D, H]) => 2 * (W * D + W * H + D * H);
  for (const mat of ['K5', 'K6']) for (const sz of cbSizes) { const S = surf(sz); const n = S < 250000 ? 30 : S < 450000 ? 20 : 10; addProduct('CB', `段ボールケース A式 ${sz[0]}×${sz[1]}×${sz[2]}mm ${mat} ${n}枚入`, '束', (20 + S / 4200) * (mat === 'K6' ? 1.15 : 1) * n); }
  for (const sz of [cbSizes[3], cbSizes[5], cbSizes[7], cbSizes[9], cbSizes[11], cbSizes[13]]) { const S = surf(sz); const n = S < 450000 ? 20 : 10; addProduct('CB', `段ボールケース A式 ${sz[0]}×${sz[1]}×${sz[2]}mm W(強化芯) ${n}枚入`, '束', (20 + S / 4200) * 1.45 * n, { thin: true }); }
  for (const sz of [[300, 200, 60], [400, 300, 80], [450, 350, 100], [500, 400, 100], [600, 400, 120], [700, 500, 150]]) { const S = surf(sz); addProduct('CB', `段ボールケース ヤッコ型 ${sz[0]}×${sz[1]}×${sz[2]}mm K5 20枚入`, '束', (14 + S / 4500) * 0.8 * 20); }
  for (const sz of [[150, 100, 50], [200, 150, 60], [250, 180, 80], [300, 200, 100], [350, 250, 120], [400, 300, 150]]) { const S = surf(sz); const n = S < 150000 ? 50 : 30; addProduct('CB', `段ボールケース N式箱 ${sz[0]}×${sz[1]}×${sz[2]}mm K5 ${n}枚入`, '束', (18 + S / 3500) * 1.2 * n); }
  // CK 紙器・化粧箱
  const ckTypes = [['キャラメル箱', 1.0], ['身蓋箱(C式)', 1.2], ['ワンタッチ底箱', 1.15], ['N式組立箱', 1.1], ['貼箱(ギフト用)', 2.4]];
  const ckSizes = [[80, 60, 30], [100, 80, 40], [120, 90, 50], [150, 100, 60], [200, 150, 80], [250, 180, 100]];
  const ckMats = [['コートボール', 1.0], ['高級白板紙', 1.3], ['クラフトボール', 0.9]];
  ckTypes.forEach(([tn, tf], i) => ckSizes.forEach((sz, j) => { for (const k of [(i + j) % 3, (i + j + 1) % 3]) { const [mn, mf] = ckMats[k]; const S = surf(sz); addProduct('CK', `化粧箱 ${tn} ${sz[0]}×${sz[1]}×${sz[2]}mm ${mn} 100枚入`, 'ケース', (12 + S / 2500) * 100 * tf * mf, { thin: mn === '高級白板紙' && (i + j) % 2 === 0 }); } }));
  // PB 紙袋
  for (const cord of ['丸紐', '平紐']) for (const sz of ['S', 'M', 'L', 'LL']) for (const paper of ['晒クラフト', '未晒クラフト']) addProduct('PB', `手提げ紙袋 ${cord} ${sz} ${paper} 100枚入`, '束', { S: 3200, M: 4000, L: 5200, LL: 6800 }[sz] * (paper === '晒クラフト' ? 1.1 : 1) * (cord === '平紐' ? 0.95 : 1));
  for (const no of [4, 6, 8, 10, 12]) for (const paper of ['晒', '未晒']) addProduct('PB', `角底紙袋 No.${no} ${paper} 500枚入`, '束', (2600 + no * 380) * (paper === '晒' ? 1.1 : 1));
  for (const sz of ['小', '中', '大']) for (const paper of ['晒', '未晒']) addProduct('PB', `平袋 ${sz} ${paper} 1000枚入`, '束', { 小: 1800, 中: 2400, 大: 3200 }[sz] * (paper === '晒' ? 1.1 : 1));
  for (const kg of [2, 5, 10]) addProduct('PB', `米袋 ${kg}kg用 窓付き 100枚入`, '束', { 2: 3600, 5: 4800, 10: 6500 }[kg]);
  addProduct('PB', 'ワイン袋 1本用 クラフト 100枚入', '束', 5200); addProduct('PB', 'ワイン袋 2本用 クラフト 100枚入', '束', 7400);
  addProduct('PB', 'パン袋 窓付き 小 500枚入', '束', 3900); addProduct('PB', 'パン袋 窓付き 大 500枚入', '束', 4800);
  // WP 包装紙
  const wpKinds = [['クラフト', 5200], ['純白', 6800], ['筋入クラフト', 5600], ['色上質(ピンク)', 7400], ['色上質(ブルー)', 7400], ['和紙風', 9800]];
  for (const sz of ['全判', '半才']) for (const [k, pr] of wpKinds) addProduct('WP', `包装紙 ${sz} ${k} 500枚入`, '包', pr * (sz === '半才' ? 0.55 : 1));
  for (const w of [600, 900, 1100]) for (const k of ['クラフト', '純白']) addProduct('WP', `ロール包装紙 幅${w}mm ${k} 100m巻`, '本', { 600: 1800, 900: 2600, 1100: 3200 }[w] * (k === '純白' ? 1.3 : 1));
  for (const sz of ['全判', '半才']) for (const col of ['白', '黒', '赤']) addProduct('WP', `薄葉紙 ${sz} ${col} 1000枚入`, '包', (sz === '全判' ? 4400 : 2600) * (col === '白' ? 1 : 1.15));
  for (const [sz, pr] of [['半才', 2800], ['四切', 2600], ['八切', 2500]]) addProduct('WP', `緩衝用更紙 ${sz} 10kg`, '包', pr);
  // KK 紙管
  const kkPairs = [[38.1, 3], [38.1, 5], [50.8, 3], [50.8, 5], [50.8, 8], [76.2, 5], [76.2, 8], [76.2, 10], [152.4, 8], [152.4, 10]];
  for (const [id, t] of kkPairs) for (const len of [1000, 1500]) addProduct('KK', `紙管 内径${id}mm 肉厚${t}mm 長さ${len}mm`, '本', (id * 0.9 + t * 18) * (len / 1000), { thin: t === 10 });
  addProduct('KK', '紙管 内径76.2mm 肉厚10mm 長さ1100mm', '本', (76.2 * 0.9 + 180) * 1.1, { thin: true }); addProduct('KK', '紙管 内径152.4mm 肉厚10mm 長さ1100mm', '本', (152.4 * 0.9 + 180) * 1.1, { thin: true });
  // KS 紙製緩衝材
  for (const w of [300, 450, 600]) for (const t of [1.0, 1.5]) addProduct('KS', `クッションペーパー 幅${w}mm 厚${t.toFixed(1)}mm 50m巻`, '巻', (1800 + w * 2) * (t === 1.5 ? 1.25 : 1));
  for (const kg of [1, 5]) for (const col of ['白', '茶', '赤', '緑']) addProduct('KS', `紙パッキン ${col} ${kg}kg`, '袋', (kg === 1 ? 1200 : 4800) * (col === '白' ? 1 : 1.1));
  for (const w of [300, 400, 500]) addProduct('KS', `ハニカムペーパー 幅${w}mm 50m巻`, '巻', 3200 + w * 4);
  addProduct('KS', '紙製エアークッション 小 100枚入', '束', 500 * 2); addProduct('KS', '紙製エアークッション 大 100枚入', '束', 4000);
  for (const [w, d] of [[200, 150], [300, 200], [400, 300], [500, 400], [600, 450]]) addProduct('KS', `段ボールパッド ${w}×${d}mm 100枚入`, '束', 900 + (w * d) / 800);
  // FT 紙製食品容器
  for (const sz of ['小', '中', '大']) for (const pt of ['無地', '木目柄']) addProduct('FT', `紙トレー ${sz} ${pt} 500枚入`, 'ケース', { 小: 2400, 中: 3200, 大: 4100 }[sz] * (pt === '木目柄' ? 1.2 : 1), { thin: pt === '木目柄' });
  for (const sz of ['S', 'M', 'L']) for (const col of ['クラフト', '白']) addProduct('FT', `テイクアウトボックス ${sz} ${col} 200個入`, 'ケース', { S: 3600, M: 4600, L: 5800 }[sz] * (col === '白' ? 1.1 : 1));
  for (const n of [4, 5, 6, 7]) addProduct('FT', `ケーキ箱 ${n}号 白 100枚入`, 'ケース', 4200 + (n - 4) * 900);
  for (const inch of [8, 10, 12]) addProduct('FT', `ピザ箱 ${inch}インチ クラフト 100枚入`, 'ケース', { 8: 5200, 10: 6400, 12: 7800 }[inch]);
  for (const oz of [5, 7, 9, 12]) addProduct('FT', `紙カップ ${oz}oz 白 1000個入`, 'ケース', { 5: 5800, 7: 6600, 9: 7800, 12: 9200 }[oz]);
  for (const sz of ['S', 'M', 'L']) addProduct('FT', `紙製どんぶり ${sz} 耐油 500個入`, 'ケース', { S: 6200, M: 7400, L: 8800 }[sz]);
  addProduct('FT', '仕切付きランチボックス 2仕切 200個入', 'ケース', 7800); addProduct('FT', '仕切付きランチボックス 4仕切 200個入', 'ケース', 9200);
  // LB ラベル
  const lbSizes = [[30, 20], [40, 30], [50, 30], [60, 40], [70, 50], [90, 60]];
  for (const pt of ['上質紙', '光沢紙']) for (const [w, h] of lbSizes) addProduct('LB', `商品ラベル ${pt} ${w}×${h}mm 1000枚巻`, '巻', (1200 + (w * h) / 12) * (pt === '光沢紙' ? 1.25 : 1));
  for (const [w, h] of [[40, 20], [50, 30], [60, 40], [70, 40]]) addProduct('LB', `バーコードラベル ${w}×${h}mm 1000枚巻`, '巻', 1600 + (w * h) / 15);
  for (const n of [12, 20, 44]) addProduct('LB', `宛名ラベル A4 ${n}面 100枚入`, '冊', { 12: 2600, 20: 2800, 44: 3200 }[n]);
  for (const t of ['天地無用', '割れ物注意', '水濡注意', '取扱注意']) addProduct('LB', `荷札シール ${t} 500枚巻`, '巻', 1800);
  for (const [t, pr] of [['封緘シール 丸 30mm 1000枚巻', 2200], ['封緘シール 角 40mm 1000枚巻', 2400], ['開封確認シール 1000枚巻', 3600]]) addProduct('LB', t, '巻', pr);
  for (const [t, pr] of [['食品表示ラベル 白無地 50×30mm 1000枚巻', 1500], ['食品表示ラベル 白無地 60×40mm 1000枚巻', 1700], ['食品表示ラベル 枠付き 50×30mm 1000枚巻', 1700], ['食品表示ラベル 枠付き 60×40mm 1000枚巻', 1900]]) addProduct('LB', t, '巻', pr);
  // TP テープ・結束（仕入）
  for (const col of ['透明', '茶']) for (const mu of [45, 65]) addProduct('TP', `OPPテープ 48mm×100m ${col} ${mu}μ 50巻入`, '箱', (mu === 45 ? 4800 : 6400) * (col === '茶' ? 0.97 : 1), { supplier: 'S01' });
  for (const col of ['透明', '茶']) addProduct('TP', `OPPテープ 48mm×50m ${col} 50巻入`, '箱', 3200, { supplier: 'S01' });
  for (const col of ['茶', '白']) addProduct('TP', `クラフトテープ 50mm×50m ${col} 50巻入`, '箱', 5600 * (col === '白' ? 1.1 : 1), { supplier: 'S01' });
  for (const col of ['黄土', '白', '黒']) addProduct('TP', `布テープ 50mm×25m ${col} 30巻入`, '箱', 6600, { supplier: 'S01', thin: true });
  for (const col of ['緑', '白']) addProduct('TP', `養生テープ 50mm×25m ${col} 30巻入`, '箱', 5400, { supplier: 'S01' });
  for (const w of ['12mm', '15.5mm']) for (const col of ['黒', '白', '青']) addProduct('TP', `PPバンド ${w}×3000m ${col} 2巻入`, '箱', (w === '12mm' ? 5200 : 6400) * (col === '黒' ? 1 : 1.05), { supplier: 'S04' });
  for (const w of [300, 500]) for (const mu of [12, 15, 20]) addProduct('TP', `ストレッチフィルム 幅${w}mm ${mu}μ 6本入`, '箱', (w === 300 ? { 12: 3600, 15: 4200, 20: 5000 } : { 12: 5400, 15: 6300, 20: 7400 })[mu], { supplier: 'S04', thin: mu === 20 });
  for (const l of [100, 200, 300]) addProduct('TP', `結束バンド ${l}mm 1000本入`, '箱', { 100: 1400, 200: 2200, 300: 3600 }[l], { supplier: 'S04' });
  for (const w of ['12mm', '15.5mm']) addProduct('TP', `PPバンド用ストッパー ${w} 1000個入`, '箱', w === '12mm' ? 2400 : 2800, { supplier: 'S04' });
  // PF ポリ袋・フィルム（仕入）
  for (let no = 1; no <= 16; no++) addProduct('PF', `規格ポリ袋 No.${no} 0.03mm 1000枚入`, '束', 600 + no * 110, { supplier: 'S02' });
  for (const no of [5, 8, 11, 14]) addProduct('PF', `規格ポリ袋 No.${no} 0.05mm 500枚入`, '束', 900 + no * 120, { supplier: 'S02' });
  for (const [sz, pr] of [['A4', 3200], ['A5', 2400], ['B5', 2800], ['長3', 1900], ['角2', 4200]]) addProduct('PF', `OPP袋 テープ付 ${sz} 1000枚入`, '束', pr, { supplier: 'S03' });
  for (const sz of ['S', 'M', 'L']) addProduct('PF', `手提げポリ袋 ${sz} 乳白 1000枚入`, '束', { S: 3800, M: 4600, L: 5600 }[sz], { supplier: 'S02' });
  for (const l of [45, 70, 90]) addProduct('PF', `ゴミ袋 ${l}L 半透明 500枚入`, '束', { 45: 3600, 70: 5200, 90: 6800 }[l], { supplier: 'S02' });
  addProduct('PF', 'エアキャップ 1200mm×42m', '本', 2800, { supplier: 'S03' }); addProduct('PF', 'エアキャップ 600mm×42m', '本', 1600, { supplier: 'S03' });

  // 新商品・廃番・個別改定
  const byCat = (c) => products.filter((p) => p.cat === c);
  const ft = byCat('FT'); ft.filter((p) => p.name.startsWith('紙製どんぶり')).forEach((p) => { p.intro = dayOf(2025, 6, 1); }); ft[ft.length - 1].intro = dayOf(2025, 6, 1);
  byCat('KS').filter((p) => p.name.startsWith('ハニカム')).forEach((p) => { p.intro = dayOf(2025, 9, 1); });
  const ck = byCat('CK'); ck.slice(-3).forEach((p) => { p.intro = dayOf(2026, 5, 1); });
  byCat('PB').filter((p) => p.name.startsWith('パン袋')).forEach((p) => { p.intro = dayOf(2026, 8, 1); });
  const cb = byCat('CB'); cb[26].disc = dayOf(2026, 3, 31); cb[27].disc = dayOf(2026, 3, 31);
  byCat('WP').filter((p) => p.name.includes('色上質')).slice(0, 2).forEach((p) => { p.disc = dayOf(2026, 3, 31); });
  const lb = byCat('LB'); lb[10].disc = dayOf(2026, 3, 31); lb[11].disc = dayOf(2026, 3, 31);
  byCat('TP').filter((p) => p.name.startsWith('養生')).forEach((p) => { p.disc = dayOf(2026, 3, 31); });
  const pf = byCat('PF'); pf[0].disc = dayOf(2025, 12, 31); pf[1].disc = dayOf(2025, 12, 31);
  byCat('KS').filter((p) => p.name === '紙製エアークッション 小 100枚入').forEach((p) => { p.disc = dayOf(2025, 12, 31); });
  ck[7].disc = dayOf(2025, 12, 31);
  pf.filter((p) => p.name.includes('0.05mm')).forEach((p) => { p.pfDown = true; });
  byCat('TP').filter((p) => p.thin || p.name.includes('65μ') || p.name === 'クラフトテープ 50mm×50m 白 50巻入').forEach((p) => { p.augUp = true; });
  // 原価率
  for (const p of products) { const d = CATDEF[p.cat]; p.r0 = p.thin ? rf(0.48, 0.495) : rf(d.r0[0], d.r0[1]); p.ratio = d.ratio.map((x) => x + ri(-3, 3)); const s = p.ratio.reduce((a, b) => a + b, 0); p.ratio[3] += 100 - s; }
}
buildCatalog();

// 定価履歴・原価履歴
function buildHistories() {
  for (const p of products) {
    const d = CATDEF[p.cat];
    const start = p.intro ?? HIST_START;
    let price = p.base; const segs = [{ start, price }];
    const chg = (day, pct) => { if (pct === 0 || day <= start) return; if (p.disc !== null && p.disc < day) return; const np = roundList(price * (1 + pct / 100), pct > 0); if (np !== price) { segs.push({ start: day, price: np }); price = np; } };
    p.rev1pct = rf(d.rev1[0], d.rev1[1]); p.rev2pct = rf(d.rev2[0], d.rev2[1]);
    chg(REV1, p.rev1pct);
    if (p.pfDown) chg(PF_DOWN, -4);
    chg(REV2, p.rev2pct);
    if (p.augUp) chg(TP_AUG, 6.5);
    segs.forEach((s, i) => { s.end = i + 1 < segs.length ? segs[i + 1].start - 1 : p.disc; });
    p.listSegs = segs;
    let cost = Math.round(p.base * p.r0 * 100); const cs = [{ start, cost }];
    const cchg = (day, pct) => { if (pct === 0 || day <= start) return; if (p.disc !== null && p.disc < day) return; const nc = Math.round(cost * (1 + pct / 100)); if (nc !== cost) { cs.push({ start: day, cost: nc }); cost = nc; } };
    cchg(REV1, rf(d.cost1[0], d.cost1[1]));
    if (p.pfDown) cchg(PF_DOWN, -4);
    if (p.cat === 'TP') { p.noticePct = Math.round(rf(8, 10) * 10) / 10; cchg(COST_RISE, p.noticePct); }
    else cchg(COST_RISE, p.thin ? rf(20, 24) : rf(d.cost2[0], d.cost2[1]));
    cs.forEach((s, i) => { s.end = i + 1 < cs.length ? cs[i + 1].start - 1 : p.disc; });
    p.costSegs = cs;
  }
}
buildHistories();
const productByCode = new Map(products.map((p) => [p.code, p]));
const segAt = (segs, day) => { let i = -1; for (let k = 0; k < segs.length; k++) if (segs[k].start <= day) i = k; return i; };
const sysList = (p, day) => p.listSegs[segAt(p.listSegs, day)].price;
const costAt = (p, day) => p.costSegs[segAt(p.costSegs, day)].cost;
const changedAt = (p, day) => p.listSegs.some((s, i) => i > 0 && s.start === day);
const priceBefore = (p, day) => { const i = p.listSegs.findIndex((s) => s.start === day); return i > 0 ? p.listSegs[i - 1].price : null; };
const active = (p, day) => (p.intro === null || p.intro <= day) && (p.disc === null || day <= p.disc);

// ============================================================
// 得意先（架空）
// ============================================================
const PREFIX = ['白波', '霞野', '若葉台', '朝霧', '月影', '遠州野', '瑞穂野', '千鳥', '紅葉山', '氷室', '青嵐', '浜風', '碧海', '銀杏', '木枯', '雪原', '夕凪', '虹野', '風間', '真砂', '七瀬', '鷺沼', '稲穂', '朝比奈', '高瀬', '水無月', '葉月', '皐月', '如月', '弥生', '卯月', '長月', '文月', '睦月', '八雲', '千早', '小夜', '鶴ヶ峰', '鹿島野', '大空', '北斗', '星屑', '砂丘', '潮騒', '山彦', '木霊', '早苗', '若狭野', '曙', '黎明', '暁', '宵', '朧月', '陽炎', '天音', '白鷺', '青葉', '紅梅', '松風', '竹林', '桜井野', '栗原野', '柚木', '橘', '藤野', '菖蒲', '牡丹', '桔梗', '椿', '楓', '柊', '楠', '欅', '白樺', '梢', '霧島野', '天城野', '鈴鹿野', '生駒野', '六甲野', '琵琶野', '諏訪野', '浅間野', '筑波野', '那須野', '日光野', '赤城野', '榛名野', '妙義野', '秩父野', '多摩野', '相模野', '房総野', '常陸野', '武蔵野台', '飛鳥野', '斑鳩野', '吉野台', '熊野台', '出雲野', '伯耆野', '安芸野', '伊予野', '土佐野', '肥後野', '薩摩野', '日向野', '津軽野', '南部野', '陸奥野', '羽前野', '越後野', '信濃野', '甲斐野', '駿河野', '伊豆野', '三河野', '尾張野', '美濃野', '近江野', '丹波野', '播磨野', '紀伊野', '大和野', '河内野', '摂津野', '淡路野', '讃岐野', '阿波野', '豊後野', '筑前野', '肥前野'];
const SEGMENTS = [
  { type: '代理店・包装資材商社', tiers: ['S'], n: 16, forms: ['{X}包装資材株式会社', '株式会社{X}パッケージ', '{X}紙業株式会社', '{X}包材商事株式会社', '株式会社{X}資材'], cats: { CB: 5, CK: 3, PB: 4, WP: 3, KK: 1, KS: 3, FT: 3, LB: 2, TP: 4, PF: 4 }, depts: ['仕入部', '商品部', '購買部'] },
  { type: '食品製造', tiers: ['A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C'], n: 24, forms: ['{X}食品工業株式会社', '株式会社{X}製菓', '{X}乳業株式会社', '{X}水産株式会社', '株式会社{X}ベーカリー', '{X}フーズ株式会社'], cats: { CB: 5, FT: 4, PB: 2, LB: 3, TP: 3, PF: 3, KS: 1, CK: 1 }, depts: ['購買部', '資材部', '生産管理部'] },
  { type: '化粧品・日用品', tiers: ['A', 'A', 'B', 'B', 'B'], n: 10, forms: ['株式会社{X}化粧品', '{X}コスメティクス株式会社', '{X}化学株式会社'], cats: { CK: 5, WP: 3, PB: 3, LB: 3, CB: 2, KS: 2, TP: 1 }, depts: ['購買部', '資材部', '商品企画部'] },
  { type: '医薬品・医療', tiers: ['A', 'B'], n: 6, forms: ['{X}製薬株式会社', '株式会社{X}メディカル'], cats: { CK: 4, LB: 3, CB: 3, KS: 2, TP: 1 }, depts: ['購買部', '資材部'] },
  { type: '通販・EC', tiers: ['B', 'C'], n: 12, forms: ['株式会社{X}通販', '{X}オンライン株式会社', '株式会社{X}ダイレクト'], cats: { CB: 5, KS: 4, TP: 3, PF: 2, PB: 1, WP: 1 }, depts: ['物流部', '業務部', '総務部'] },
  { type: '印刷・出版', tiers: ['B', 'C'], n: 6, forms: ['株式会社{X}印刷', '{X}印刷株式会社'], cats: { WP: 3, CK: 3, CB: 2, KK: 2, PB: 1 }, depts: ['資材部', '製造部'] },
  { type: '物流・倉庫', tiers: ['B', 'C'], n: 10, forms: ['{X}ロジスティクス株式会社', '{X}運輸株式会社', '株式会社{X}倉庫'], cats: { CB: 5, TP: 4, PF: 3, KS: 3, LB: 1 }, depts: ['業務部', '総務部', '購買課'] },
  { type: '農業・青果', tiers: ['C', 'D'], n: 8, forms: ['{X}青果出荷組合', '{X}農産株式会社', '株式会社{X}ファーム'], cats: { CB: 5, FT: 2, PF: 2, TP: 1 }, depts: ['総務部', '出荷部', '事務局'] },
  { type: '工業・部品', tiers: ['B', 'B', 'C', 'C', 'D'], n: 10, forms: ['{X}精機株式会社', '株式会社{X}電子', '{X}工業株式会社'], cats: { CB: 4, KK: 3, KS: 3, TP: 2, PF: 1 }, depts: ['購買部', '資材部', '総務部'] },
  { type: '小売・飲食', tiers: ['C', 'D'], n: 8, forms: ['株式会社{X}ストア', '{X}商店', '株式会社{X}堂', '{X}洋菓子店'], cats: { PB: 4, FT: 3, WP: 2, CK: 2, TP: 1 }, depts: ['店舗運営部', '総務部', '本部'] },
];
const BRANCHES = [
  { name: '本社営業部', w: 40, prefs: ['東京都', '神奈川県', '千葉県', '埼玉県'], reps: ['佐藤', '鈴木', '高橋', '田中', '伊藤'] },
  { name: '北関東営業所', w: 15, prefs: ['群馬県', '栃木県', '茨城県'], reps: ['渡辺', '山本'] },
  { name: '中部営業所', w: 20, prefs: ['愛知県', '静岡県', '岐阜県', '三重県'], reps: ['中村', '小林'] },
  { name: '関西営業所', w: 25, prefs: ['大阪府', '兵庫県', '京都府', '滋賀県'], reps: ['加藤', '吉田', '山田'] },
];
const LPM = { S: [20, 30], A: [10, 16], B: [5, 8], C: [2, 4], D: [1, 2] };
const LPS = { S: [3, 8], A: [2, 6], B: [2, 5], C: [1, 4], D: [1, 3] };
const ASSORT = { S: [30, 45], A: [15, 25], B: [8, 15], C: [5, 10], D: [3, 6] };
const FREIGHT = { S: 0.03, A: 0.08, B: 0.2, C: 0.35, D: 0.4 };

const customers = [];
function buildCustomers() {
  const prefixes = shuffle(PREFIX);
  let pi = 0; let code = 1001;
  for (const seg of SEGMENTS) {
    for (let i = 0; i < seg.n; i++) {
      const X = prefixes[pi++]; const form = seg.forms[i % seg.forms.length];
      const name = form.replace('{X}', X);
      const abbr = name.replace('株式会社', '(株)');
      const tier = seg.tiers[i % seg.tiers.length];
      const t = TIERS[tier];
      const rate = chance(0.6) ? t.std : Math.max(t.lo, Math.min(t.hi, t.std + ri(-3, 3) * 10));
      const br = wpick(BRANCHES, BRANCHES.map((b) => b.w));
      const startY = ri(2006, 2024); const start = dayOf(startY, ri(1, 12), ri(1, 28));
      customers.push({ code: String(code++).padStart(6, '0'), name, abbr, seg, type: seg.type, tier, rate, branch: br.name, rep: pick(br.reps), pref: pick(br.prefs), closing: wpick(['末日', '20日', '15日', '25日'], [60, 25, 8, 7]), dept: pick(seg.depts), start, end: null, lpm: ri(LPM[tier][0], LPM[tier][1]), lps: LPS[tier], assort: [], rev2: null, rev3: null });
    }
  }
  // 取引開始が期間内・改定後の得意先、途中で止まった得意先
  const direct = customers.filter((c) => c.tier !== 'S');
  const sh = shuffle(direct);
  sh[0].start = dayOf(2025, 2, 17); sh[1].start = dayOf(2025, 5, 12); sh[2].start = dayOf(2025, 8, 4); sh[3].start = dayOf(2025, 11, 10); sh[4].start = dayOf(2025, 3, 3);
  sh[5].start = dayOf(2026, 5, 18); sh[6].start = dayOf(2026, 6, 8); sh[7].start = dayOf(2026, 8, 24);
  sh[8].end = dayOf(2025, 7, 31); sh[9].end = dayOf(2025, 11, 30); sh[10].end = dayOf(2026, 1, 31); sh[11].end = dayOf(2026, 5, 31);
  for (const c of [sh[5], sh[6], sh[7]]) { c.tier = 'D'; c.rate = TIERS.D.std; c.lpm = ri(2, 4); c.lps = LPS.D; }
  // 品揃え
  for (const c of customers) {
    const n = ri(ASSORT[c.tier][0], ASSORT[c.tier][1]);
    const cats = Object.keys(c.seg.cats); const ws = cats.map((k) => c.seg.cats[k]);
    const chosen = new Set();
    let guard = 0;
    while (chosen.size < n && guard++ < 2000) { const cat = wpick(cats, ws); const pool = products.filter((p) => p.cat === cat); const p = pick(pool); chosen.add(p.code); }
    const arr = shuffle([...chosen]).map((code, i) => ({ p: productByCode.get(code), w: 1 / Math.pow(i + 1, 0.7) }));
    c.assort = arr;
  }
}
buildCustomers();
const customerByCode = new Map(customers.map((c) => [c.code, c]));

// 前回改定（REV2）の合意状況
function assignAgreements() {
  const eligible = customers.filter((c) => c.start < dayOf(2026, 1, 1) && (c.end === null || c.end >= dayOf(2026, 2, 1)));
  const sh = shuffle(eligible);
  const n = sh.length;
  const plan = [];
  const laterDays = [dayOf(2026, 5, 1), dayOf(2026, 5, 1), dayOf(2026, 5, 1), dayOf(2026, 5, 1), dayOf(2026, 6, 1), dayOf(2026, 6, 1), dayOf(2026, 6, 1), dayOf(2026, 7, 1), dayOf(2026, 7, 1)];
  for (const d of laterDays) plan.push({ kind: 'deferred', applyDay: d, word: '合意' });
  for (let i = 0; i < 8; i++) plan.push({ kind: 'agreed', applyDay: REV2, word: '合意', blankDate: true });
  for (let i = 0; i < 8; i++) plan.push({ kind: 'partial', applyDay: i < 6 ? REV2 : dayOf(2026, 5, 1), word: '一部合意' });
  for (let i = 0; i < 11; i++) plan.push({ kind: 'declined', applyDay: null, word: i < 2 ? '合意に至らず' : '見送り' });
  for (let i = 0; i < 7; i++) plan.push({ kind: 'negotiating', applyDay: null, word: '協議中', mitei: i < 2 });
  for (let i = 0; i < 3; i++) plan.push({ kind: 'none' });
  while (plan.length < n) plan.push({ kind: 'agreed', applyDay: REV2, word: '合意' });
  const pl = shuffle(plan);
  const revCats = ['CB', 'CK', 'PB', 'WP', 'KK', 'KS', 'FT'];
  sh.forEach((c, i) => {
    const st = { ...pl[i], excluded: [] };
    if (st.kind === 'partial') {
      const cats = [...new Set(c.assort.map((a) => a.p.cat))].filter((k) => revCats.includes(k));
      st.excluded = shuffle(cats).slice(0, Math.min(cats.length, ri(1, 2)));
      if (st.excluded.length === 0) { st.kind = 'agreed'; st.word = '合意'; }
    }
    st.requestDay = dayOf(2026, 1, 19) + ri(0, 18);
    st.replyDay = st.kind === 'negotiating' ? (chance(0.5) ? null : st.requestDay + ri(20, 45)) : st.requestDay + ri(10, 50);
    c.rev2 = st;
  });
  for (const c of customers) if (!c.rev2) c.rev2 = { kind: 'none', excluded: [] };
}
assignAgreements();

// ============================================================
// 得意先に適用すべき定価の時系列（合意状況を反映）
// ============================================================
function custTimeline(c, p) {
  const st = c.rev2; const out = [];
  for (let i = 0; i < p.listSegs.length; i++) {
    const s = p.listSegs[i];
    if (i > 0 && s.start === REV2) {
      const skip = st.kind === 'declined' || st.kind === 'negotiating' || (st.kind === 'partial' && st.excluded.includes(p.cat));
      if (skip) continue;
      const start = (st.kind === 'deferred' || st.kind === 'partial') && st.applyDay > REV2 ? st.applyDay : REV2;
      if (i + 1 < p.listSegs.length && p.listSegs[i + 1].start <= start) throw new Error('適用日より前に個別改定がある: ' + p.code);
      out.push({ start, price: s.price });
    } else out.push({ start: s.start, price: s.price });
  }
  return out;
}
const custListAt = (c, p, day) => { const tl = custTimeline(c, p); return tl[segAt(tl, day)].price; };
function whyOld(c, p, day) { const st = c.rev2; if ((st.kind === 'deferred' || (st.kind === 'partial' && !st.excluded.includes(p.cat))) && day < st.applyDay) return 'ok_deferred'; return 'ok_declined'; }

// ============================================================
// 特値（架空）
// ============================================================
const specials = []; // {c, p, price, start, end, reason}
const specialMap = new Map();
const skey = (c, p) => c.code + '|' + p.code;
const specialsOf = (c, p) => specialMap.get(skey(c, p)) || [];
function specialInForce(c, p, day) { let best = null; for (const s of specialsOf(c, p)) if (s.start <= day && day <= s.end && (best === null || s.start > best.start)) best = s; return best; }
function addSpecial(c, p, price, start, end, reason, tag) { const s = { c, p, price, start, end, reason, tag }; specials.push(s); const k = skey(c, p); if (!specialMap.has(k)) specialMap.set(k, []); specialMap.get(k).push(s); return s; }
function specialPriceFor(c, p, day, deltaRate) { const L = sysList(p, day); let pr = fl((L * (c.rate - deltaRate)) / 1000); pr = pr >= 1000 ? fl(pr / 10) * 10 : fl(pr / 5) * 5; const forbid = new Set([fl((L * c.rate) / 1000)]); for (const s of p.listSegs) forbid.add(fl((s.price * c.rate) / 1000)); while (forbid.has(pr)) pr -= pr >= 1000 ? 10 : 5; return pr; }

function buildSpecials() {
  const cands = customers.filter((c) => (c.tier === 'S' || c.tier === 'A' || (c.tier === 'B' && chance(0.3))) && c.start < dayOf(2024, 6, 1) && c.end === null);
  const reasons = ['年間契約', '大口継続', '新規獲得', '競合対策', '見積対応', '年間契約（数量条件付き）'];
  for (const c of cands) {
    const n = c.tier === 'S' ? ri(3, 6) : c.tier === 'A' ? ri(2, 5) : ri(1, 2);
    const prods = c.assort.slice(0, 12).map((a) => a.p).filter((p) => p.intro === null && p.disc === null);
    const chosen = shuffle(prods).slice(0, n);
    for (const p of chosen) {
      const kind = wpick(['fy_renewed', 'fy_only', 'old_only', 'mid', 'new', 'summer'], [35, 20, 10, 10, 15, 10]);
      const delta = ri(40, 90);
      if (kind === 'fy_renewed') { addSpecial(c, p, specialPriceFor(c, p, REV1, delta), REV1, REV2 - 1, pick(reasons), 'fy'); addSpecial(c, p, specialPriceFor(c, p, REV2, delta), REV2, dayOf(2027, 3, 31), '年間契約（更新）', 'renewed'); }
      else if (kind === 'fy_only') addSpecial(c, p, specialPriceFor(c, p, REV1, delta), REV1, REV2 - 1, pick(reasons), 'expired_2603');
      else if (kind === 'old_only') addSpecial(c, p, specialPriceFor(c, p, dayOf(2024, 10, 1), delta), dayOf(2024, 10, 1), dayOf(2025, 9, 30), pick(reasons), 'expired_2509');
      else if (kind === 'mid') addSpecial(c, p, specialPriceFor(c, p, LAST12_START, delta), LAST12_START, SALES_END, pick(reasons), 'mid');
      else if (kind === 'new') addSpecial(c, p, specialPriceFor(c, p, REV2, delta), REV2, dayOf(2027, 3, 31), pick(reasons), 'new');
      else addSpecial(c, p, specialPriceFor(c, p, dayOf(2025, 7, 1), delta), dayOf(2025, 7, 1), dayOf(2026, 6, 30), pick(reasons), 'expired_2606');
    }
  }
  // 期間が重なる特値（更新が3月から始まる）2組
  const fy = specials.filter((s) => s.tag === 'fy').slice(0, 2);
  for (const s of fy) { const ren = specialsOf(s.c, s.p).find((x) => x.tag === 'renewed'); if (ren) { ren.start = dayOf(2026, 3, 1); ren.tag = 'renewed_overlap'; } }
  // 粗利下限を割る特値：更新特値のうち薄利商品 8組（7月の原価上昇後に下回る）、最初から下回る 3組
  const thinRenewed = specials.filter((s) => (s.tag === 'renewed' || s.tag === 'new') && s.p.thin).slice(0, 8);
  for (const s of thinRenewed) { const fp = Math.ceil(costAt(s.p, COST_RISE) / 90); const before = Math.ceil(costAt(s.p, REV2) / 90); let pr = fp - ri(6, 20); pr = pr >= 1000 ? fl(pr / 10) * 10 : pr; if (pr >= fp - 4) pr = fp - 6; if (pr < before + 4) pr = before + 5; const forbid = new Set(s.p.listSegs.map((x) => fl((x.price * s.c.rate) / 1000))); while (forbid.has(pr)) pr -= 1; s.price = pr; s.tag = 'floor_after_rise'; }
  const anyRenewed = specials.filter((s) => s.tag === 'renewed' && !s.p.thin).slice(0, 3);
  for (const s of anyRenewed) { const fp = Math.ceil(costAt(s.p, REV2) / 90); let pr = fp - ri(8, 25); const forbid = new Set(s.p.listSegs.map((x) => fl((x.price * s.c.rate) / 1000))); while (forbid.has(pr)) pr -= 1; s.price = pr; s.tag = 'floor_from_start'; }
}
buildSpecials();

// ============================================================
// 埋め込む漏れ（得意先単位・得意先×商品単位）
// ============================================================
const custRegime = new Map();
const pairRegime = new Map();
const pkey = (c, p) => c.code + '|' + p.code;
const inWin = (w, day) => w.from <= day && day <= w.to;
const isAgreedLike = (c) => c.rev2.kind === 'agreed' || c.rev2.kind === 'none' || (c.rev2.kind === 'partial');
const usedPairs = new Set();
function pickPairs(custFilter, prodFilter, n, topN = 6) {
  const out = []; let guard = 0;
  const cs = shuffle(customers.filter(custFilter));
  while (out.length < n && guard++ < 5000) {
    const c = pick(cs); if (!c) break;
    const cand = c.assort.slice(0, topN).map((a) => a.p).filter((p) => prodFilter(c, p) && !usedPairs.has(pkey(c, p)));
    if (cand.length === 0) continue;
    const p = pick(cand); usedPairs.add(pkey(c, p)); out.push([c, p]);
  }
  return out;
}
const noSpecialAfter = (c, p, day) => !specialsOf(c, p).some((s) => s.end >= day);
const ME = (y, m) => monthEnd(y, m);
function chooseLeaks() {
  const activeAll = (c) => c.end === null && c.start < dayOf(2025, 1, 1);
  // 得意先まるごと：旧価格のまま（2社。1社は6月に修正済み）
  const wholeCands = shuffle(customers.filter((c) => activeAll(c) && (c.tier === 'A' || c.tier === 'B') && (c.rev2.kind === 'agreed' || c.rev2.kind === 'none') && !specials.some((s) => s.c === c)));
  custRegime.set(wholeCands[0].code, { wholeOld: { from: REV2, to: SALES_END } });
  custRegime.set(wholeCands[1].code, { wholeOld: { from: REV2, to: dayOf(2026, 6, 14) } });
  // 適用日を後ろ倒しで合意したのに、その日になっても更新されなかった得意先（1社）
  const defCands = customers.filter((c) => activeAll(c) && c.rev2.kind === 'deferred' && c.rev2.applyDay === dayOf(2026, 6, 1));
  custRegime.set(defCands[0].code, { wholeOld: { from: defCands[0].rev2.applyDay, to: SALES_END } });
  // 得意先マスタの掛率が誤り（2社）
  const wrA = shuffle(customers.filter((c) => activeAll(c) && c.tier === 'A' && !custRegime.has(c.code)))[0];
  custRegime.set(wrA.code, { wrongRate: { rate: 600, from: SALES_START, to: SALES_END } });
  const wrC = shuffle(customers.filter((c) => activeAll(c) && c.tier === 'C' && !custRegime.has(c.code)))[0];
  custRegime.set(wrC.code, { wrongRate: { rate: 750, from: SALES_START, to: dayOf(2026, 1, 31) } });
  const notCust = (c) => !custRegime.has(c.code);
  // 得意先×商品：前回改定（REV2）の反映漏れ 60組
  const agreedActive = (c) => notCust(c) && c.end === null && c.start < REV2 && (c.rev2.kind === 'agreed' || c.rev2.kind === 'none' || c.rev2.kind === 'deferred' || c.rev2.kind === 'partial');
  const old2 = pickPairs(agreedActive, (c, p) => changedAt(p, REV2) && !(c.rev2.kind === 'partial' && c.rev2.excluded.includes(p.cat)) && noSpecialAfter(c, p, REV2 - 60), 85, 4);
  old2.forEach(([c, p], i) => { const from = c.rev2.kind === 'deferred' || (c.rev2.kind === 'partial' && c.rev2.applyDay > REV2) ? c.rev2.applyDay : REV2; const to = i < 60 ? SALES_END : pick([ME(2026, 5), ME(2026, 6), ME(2026, 7), ME(2026, 8)]); pairRegime.set(pkey(c, p), { type: 'old2', from, to }); });
  // 前々回改定（REV1）の反映漏れ 15組（うち2組は期間末まで続き、REV2後は「2回前の定価」になる）
  const old1 = pickPairs((c) => agreedActive(c) && c.rev2.kind !== 'deferred' && c.rev2.kind !== 'partial', (c, p) => changedAt(p, REV1) && noSpecialAfter(c, p, REV1 - 60), 15, 5);
  old1.forEach(([c, p], i) => { const to = i < 10 ? pick([ME(2025, 6), ME(2025, 7), ME(2025, 8), ME(2025, 9), ME(2025, 10), ME(2025, 11), ME(2025, 12)]) : i < 13 ? REV2 - 1 : SALES_END; pairRegime.set(pkey(c, p), { type: 'old1', from: REV1, to }); });
  // 期限切れ特値のまま請求 24組
  const expiredSp = shuffle(specials.filter((s) => s.tag.startsWith('expired_') && notCust(s.c) && !usedPairs.has(pkey(s.c, s.p))));
  expiredSp.slice(0, 30).forEach((s, i) => { usedPairs.add(pkey(s.c, s.p)); const to = i < 20 ? SALES_END : Math.min(SALES_END, s.end + ri(60, 200)); pairRegime.set(pkey(s.c, s.p), { type: 'expired', from: s.end + 1, to, price: s.price }); });
  // 手入力の単価（ランク外）25組、（ランク内・原因不明）20組
  const anyActive = (c) => notCust(c) && c.end === null && c.start < dayOf(2025, 6, 1);
  const winRand = () => { const from = SALES_START + ri(0, 400); const to = Math.min(SALES_END, from + ri(60, 240)); return { from, to }; };
  pickPairs(anyActive, (c, p) => noSpecialAfter(c, p, SALES_START), 20, 8).forEach(([c, p]) => pairRegime.set(pkey(c, p), { type: 'manual_out', mode: 'rate', delta: ri(30, 80), ...winRand() }));
  pickPairs((c) => agreedActive(c) && c.rev2.kind !== 'deferred' && c.rev2.kind !== 'partial', (c, p) => changedAt(p, REV1) && changedAt(p, REV2) && noSpecialAfter(c, p, SALES_START), 5, 8).forEach(([c, p]) => pairRegime.set(pkey(c, p), { type: 'stale', from: REV2, to: SALES_END }));
  pickPairs(anyActive, (c, p) => noSpecialAfter(c, p, SALES_START), 20, 8).forEach(([c, p]) => pairRegime.set(pkey(c, p), { type: 'manual_in', ...winRand() }));
  // 判断が分かれる行：見送り得意先が2回前の定価のまま（2組）、値引の書き方が文書の例と違う（2組）
  pickPairs((c) => notCust(c) && c.end === null && (c.rev2.kind === 'declined' || c.rev2.kind === 'negotiating'), (c, p) => changedAt(p, REV1) && changedAt(p, REV2) && noSpecialAfter(c, p, SALES_START), 2, 6).forEach(([c, p]) => pairRegime.set(pkey(c, p), { type: 'twoback_declined', from: REV2, to: SALES_END }));
  pickPairs((c) => anyActive(c) && c.tier !== 'S' && c.tier !== 'D', (c, p) => noSpecialAfter(c, p, SALES_START), 2, 6).forEach(([c, p]) => pairRegime.set(pkey(c, p), { type: 'memo_amb', from: dayOf(2026, 1, 1), to: SALES_END }));
}
chooseLeaks();

// ============================================================
// 価格づけ（生成側）
// ============================================================
const DISCOUNTS = [['数量値引3%', 300], ['数量値引5%', 500], ['まとめ買い5%引', 500], ['数量値引2.5%', 250], ['まとめ買い3%引', 300]];
const DISC_W = [40, 25, 15, 10, 10];
const NORMAL_MEMOS = ['', '', '', '', '', '', '', '', '', '', '', '', '急ぎ', '分納', '直送', '客注', '納期指定', '置き場指定'];
const preRev = (p, day) => priceBefore(p, day);
function priceMain(c, p, day, qty) {
  const L = custListAt(c, p, day); const Lsys = sysList(p, day);
  const sp = specialInForce(c, p, day);
  const ref = sp ? sp.price : fl((L * c.rate) / 1000);
  const cr = custRegime.get(c.code); const pr = pairRegime.get(pkey(c, p));
  const big = c.tier === 'S' || c.tier === 'A';
  const custKind = () => (big ? (chance(0.55) ? '得意先' : '標準') : chance(0.9) ? '標準' : '得意先');
  if (pr && pr.type === 'expired' && inWin(pr, day)) return { billed: pr.price, kind: '得意先', memo: '', intent: 'expired' };
  if (sp) return { billed: sp.price, kind: '得意先', memo: '', intent: 'normal' };
  if (cr && cr.wholeOld && inWin(cr.wholeOld, day) && changedAt(p, REV2)) {
    const tl = custTimeline(c, p); const i = segAt(tl, day);
    if (i > 0 && tl[i].price === sysList(p, REV2) && tl[i - 1].price === preRev(p, REV2)) return { billed: fl((preRev(p, REV2) * c.rate) / 1000), kind: '得意先', memo: '', intent: 'old2' };
  }
  if (cr && cr.wrongRate && inWin(cr.wrongRate, day)) return { billed: fl((L * cr.wrongRate.rate) / 1000), kind: '標準', memo: '', intent: 'wrongrate' };
  const tier = TIERS[c.tier]; const lo = fl((L * tier.lo) / 1000);
  const oldCands = new Set(); for (const s of p.listSegs) oldCands.add(fl((s.price * c.rate) / 1000)); for (const s of specialsOf(c, p)) oldCands.add(s.price);
  if (pr && inWin(pr, day)) {
    if (pr.type === 'old2') { const tl = custTimeline(c, p); const i = segAt(tl, day); if (i > 0 && tl[i].price === sysList(p, REV2) && tl[i - 1].price === preRev(p, REV2)) return { billed: fl((preRev(p, REV2) * c.rate) / 1000), kind: '得意先', memo: '', intent: 'old2' }; }
    if (pr.type === 'old1' && day >= REV1 && changedAt(p, REV1)) { const b = fl((preRev(p, REV1) * c.rate) / 1000); if (b !== ref) return { billed: b, kind: '得意先', memo: '', intent: day >= REV2 && changedAt(p, REV2) ? 'old1_twoback' : 'old1' }; }
    if (pr.type === 'stale' && changedAt(p, REV1) && changedAt(p, REV2)) { const b = fl((preRev(p, REV1) * c.rate) / 1000); if (b !== ref) return { billed: b, kind: '手入力', memo: '', intent: 'stale' }; }
    if (pr.type === 'manual_out') { let b = fl((L * (tier.lo - pr.delta)) / 1000); while (oldCands.has(b)) b -= 1; return { billed: b, kind: '手入力', memo: '', intent: 'manual_out' }; }
    if (pr.type === 'manual_in') { let b = fl(ref / 10) * 10; if (b === ref) b -= 10; while (oldCands.has(b)) b -= 10; if (b >= lo) return { billed: b, kind: '手入力', memo: '', intent: 'manual_in' }; return { billed: b, kind: '手入力', memo: '', intent: 'manual_out' }; }
    if (pr.type === 'twoback_declined' && day >= REV2 && changedAt(p, REV1) && changedAt(p, REV2) && (c.rev2.kind === 'declined' || c.rev2.kind === 'negotiating')) { const b = fl((preRev(p, REV1) * c.rate) / 1000); if (b !== ref) return { billed: b, kind: '得意先', memo: '', intent: 'twoback_declined' }; }
    if (pr.type === 'memo_amb') { const b = fl((ref * 9500) / 10000); if (!oldCands.has(b) && b !== ref) return { billed: b, kind: '手入力', memo: '大口値引5%', intent: 'memo_amb' }; }
  }
  // 正常。数量値引は直需の大口数量で
  const lotMax = p.lot[1] * (c.tier === 'S' ? 2 : 1);
  const vdChance = c.tier === 'S' ? 0.03 : c.tier === 'D' ? 0.04 : 0.12;
  if (qty >= lotMax * 0.6 && chance(vdChance)) { const [memo, bp] = wpick(DISCOUNTS, DISC_W); const b = fl((ref * (10000 - bp)) / 10000); if (b !== ref && !oldCands.has(b)) return { billed: b, kind: '手入力', memo, intent: 'vd' }; }
  return { billed: ref, kind: custKind(), memo: pick(NORMAL_MEMOS), intent: 'normal' };
}

// ============================================================
// 売上明細の生成
// ============================================================
const HOLIDAYS = new Set();
for (const y of [2025, 2026]) { for (const [m, d] of [[1, 1], [1, 2], [1, 3], [1, 4], [12, 30], [12, 31], [8, 13], [8, 14], [8, 15], [5, 3], [5, 4], [5, 5], [11, 3], [11, 23], [2, 11], [2, 23], [4, 29], [7, 21], [9, 15], [9, 23], [10, 13], [11, 24]]) HOLIDAYS.add(dayOf(y, m, d)); }
function pickDay(from, to) {
  const cands = [], ws = [];
  for (let d = from; d <= to; d++) { const { w } = ymdOf(d); if (w === 0 || HOLIDAYS.has(d)) continue; let wt = w === 6 ? 0.2 : 1; if (d >= to - 5) wt *= 1.5; cands.push(d); ws.push(wt); }
  return cands.length ? wpick(cands, ws) : to;
}
const NONPROD = { '9999': { name: '運賃', unit: '式' }, '9998': { name: '抜型代', unit: '式' }, '9997': { name: '版代', unit: '式' } };
function qtyFor(c, p) { const [lo, hi] = p.lot; const mult = c.tier === 'S' ? 2 : 1; if (p.cat === 'KK') return ri(1, (hi * mult) / 50) * 50; return ri(lo, hi * mult); }
const SAMPLE_MEMOS = ['見本品', 'サンプル(無償)', '無償提供', '試供品', '見本品(新規提案)', 'サンプル出荷'];

function genMonth(c, from, to, pricer, ctx) {
  const slips = [];
  const season = ymdOf(from).m === 12 || ymdOf(from).m === 3 ? 1.2 : ymdOf(from).m === 8 || ymdOf(from).m === 1 ? 0.85 : 1;
  let nLines = Math.round(c.lpm * rf(0.7, 1.3) * season * (ctx.scale || 1));
  if (nLines < 1 && chance(0.6)) nLines = 1;
  while (nLines > 0) {
    const n = Math.min(nLines, ri(c.lps[0], c.lps[1])); nLines -= n;
    const day = pickDay(Math.max(from, c.start), Math.min(to, c.end ?? to));
    if (day < c.start || (c.end !== null && day > c.end)) continue;
    const lines = []; const usedP = new Set();
    let guard = 0;
    while (lines.length < n && guard++ < 40) {
      const a = wpick(c.assort, c.assort.map((x) => x.w)); const p = a.p;
      if (usedP.has(p.code) || !active(p, day)) continue;
      const qty = qtyFor(c, p);
      let pr;
      if (chance(0.0035)) pr = { billed: 0, kind: '手入力', memo: pick(SAMPLE_MEMOS), intent: 'sample', qty: ri(1, 3) };
      else pr = pricer(c, p, day, qty);
      const q = pr.qty ?? qty;
      if (pr.billed > 0) { const fp = Math.ceil(costAt(p, day) / 90); if (Math.abs(pr.billed - fp) <= 3) continue; }
      usedP.add(p.code);
      lines.push({ day, c, p, code: p.code, name: p.name, unit: p.unit, qty: q, billed: pr.billed, kind: pr.kind, memo: pr.memo, intent: pr.intent, trans: '売上' });
    }
    if (lines.length === 0) continue;
    if (chance(FREIGHT[c.tier])) { const amt = ri(8, 35) * 100; lines.push({ day, c, p: null, code: '9999', name: '運賃', unit: '式', qty: 1, billed: amt, cost: Math.round(amt * 0.85 * 100), kind: '手入力', memo: '', intent: 'nonproduct', trans: '売上' }); }
    else if (c.tier !== 'S' && lines.some((l) => l.p && (l.p.cat === 'CK' || l.p.cat === 'PB')) && chance(0.04)) { const die = chance(0.6); const amt = die ? ri(20, 60) * 1000 : ri(8, 25) * 1000; lines.push({ day, c, p: null, code: die ? '9998' : '9997', name: die ? '抜型代' : '版代', unit: '式', qty: 1, billed: amt, cost: Math.round(amt * 0.7 * 100), kind: '手入力', memo: die ? '新規型' : '新版', intent: 'nonproduct', trans: '売上' }); }
    slips.push({ day, c, lines });
  }
  return slips;
}

function genPeriod(from, to, pricer, ctx = {}) {
  const slips = [];
  let { y, m } = ymdOf(from);
  while (dayOf(y, m, 1) <= to) {
    const ms = Math.max(from, dayOf(y, m, 1)); const me = Math.min(to, monthEnd(y, m));
    for (const c of customers) { if (c.start > me || (c.end !== null && c.end < ms)) continue; slips.push(...genMonth(c, ms, me, pricer, ctx)); }
    m++; if (m > 12) { m = 1; y++; }
  }
  // 返品（別伝票・数量マイナス・同じ単価）
  const retMemos = ['返品(破損)', '返品(誤出荷)', '返品', '返品(過剰納品)'];
  const base = slips.slice();
  for (const s of base) for (const l of s.lines) {
    if (!l.p || l.qty <= 0 || l.billed === 0 || !chance(0.011)) continue;
    const day = l.day + ri(5, 25); if (day > to) continue;
    const q = -ri(1, Math.min(l.qty, l.p.cat === 'KK' ? 50 : 4)) * (l.p.cat === 'KK' ? 1 : 1);
    slips.push({ day, c: l.c, lines: [{ day, c: l.c, p: l.p, code: l.code, name: l.name, unit: l.unit, qty: l.p.cat === 'KK' ? -50 : q, billed: l.billed, kind: l.kind, memo: pick(retMemos), intent: 'return', trans: '返品' }] });
  }
  // 単価0円で備考に無償の言葉がない行（6行）
  if (ctx.zeroLines) {
    const cand = shuffle(slips.filter((s) => s.day >= dayOf(2026, 1, 1) && s.c.tier !== 'S' && !custRegime.has(s.c.code)));
    const memos = ['展示会用', '販促用', '試作品', '展示用', '試作(評価用)', '景品用'];
    for (let i = 0; i < 6; i++) { const s = cand[i]; const a = s.c.assort.find((x) => active(x.p, s.day) && !s.lines.some((l) => l.code === x.p.code) && noSpecialAfter(s.c, x.p, SALES_START) && !pairRegime.has(pkey(s.c, x.p))); if (!a) continue; s.lines.push({ day: s.day, c: s.c, p: a.p, code: a.p.code, name: a.p.name, unit: a.p.unit, qty: ri(1, 3), billed: 0, kind: '手入力', memo: memos[i], intent: 'zero', trans: '売上' }); }
  }
  slips.sort((a, b) => a.day - b.day || (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : 0));
  return slips;
}

const mainSlips = genPeriod(SALES_START, SALES_END, priceMain, { zeroLines: true });
let slipNo = 2501001;
const mainLines = [];
for (const s of mainSlips) { s.no = slipNo++; s.lines.forEach((l, i) => { l.slip = s.no; l.row = i + 1; mainLines.push(l); }); }

// ============================================================
// 正解の判定（公開ファイルの内容だけから、文書のルールで決める）
// ============================================================
const KEYWORDS = /見本|サンプル|無償|試供/;
function parseDocumentedDiscount(memo) { const m = memo.normalize('NFKC'); let r = /数量値引\s*(\d+(?:\.\d+)?)\s*%/.exec(m); if (r) return Math.round(parseFloat(r[1]) * 100); r = /まとめ買い\s*(\d+(?:\.\d+)?)\s*%\s*引/.exec(m); if (r) return Math.round(parseFloat(r[1]) * 100); return null; }
function parseLooseDiscount(memo) { const m = memo.normalize('NFKC'); const r = /(\d+(?:\.\d+)?)\s*%/.exec(m); return r && /値引|引/.test(m) ? Math.round(parseFloat(r[1]) * 100) : null; }
function judge(ln) {
  const out = { label: '', ambiguity: '', reference: '', refKind: '', shortfall: 0, belowFloor: 0, floorPrice: '', floorGap: 0 };
  const p = ln.p; const c = ln.c;
  if (!p) { out.label = 'ok_non_product'; out.refKind = 'other'; return out; }
  const cost = costAt(p, ln.day); const floorPrice = Math.ceil(cost / 90); out.floorPrice = floorPrice;
  const tl = custTimeline(c, p); const ci = segAt(tl, ln.day); const L = tl[ci].price; const Lprev = ci > 0 ? tl[ci - 1].price : null;
  const si = segAt(p.listSegs, ln.day); const Lsys = p.listSegs[si].price; const LsysPrev = si > 0 ? p.listSegs[si - 1].price : null;
  const sp = specialInForce(c, p, ln.day);
  const ref = sp ? sp.price : fl((L * c.rate) / 1000);
  out.reference = ref; out.refKind = sp ? 'special' : L !== Lsys ? 'old_list_x_rate' : 'list_x_rate';
  if (ln.qty < 0) { out.label = 'ok_return'; return out; }
  if (ln.billed === 0 && KEYWORDS.test(ln.memo.normalize('NFKC'))) { out.label = 'ok_sample'; return out; }
  const b = ln.billed; const below = b < floorPrice;
  out.belowFloor = below ? 1 : 0; out.floorGap = below ? (floorPrice - b) * ln.qty : 0;
  const okLabel = sp ? 'ok_special' : L !== Lsys ? whyOld(c, p, ln.day) : 'ok';
  if (b === ref) { if (below) { out.label = 'leak_below_margin_floor'; out.shortfall = out.floorGap; } else out.label = okLabel; return out; }
  if (b > ref) { out.label = below ? 'leak_below_margin_floor' : 'overcharge'; out.shortfall = below ? out.floorGap : 0; return out; }
  const dbp = parseDocumentedDiscount(ln.memo);
  if (dbp !== null && b === fl((ref * (10000 - dbp)) / 10000)) { out.label = below ? 'leak_below_margin_floor' : 'ok_volume_discount'; out.shortfall = below ? out.floorGap : 0; return out; }
  const tier = TIERS[c.tier]; const lo = fl((L * tier.lo) / 1000), hi = fl((L * tier.hi) / 1000);
  const tierLabel = b < lo || b > hi ? 'leak_rate_out_of_tier' : 'unexplained';
  const matchCust = !sp && Lprev !== null && b === fl((Lprev * c.rate) / 1000);
  const matchSys = LsysPrev !== null && b === fl((LsysPrev * c.rate) / 1000);
  const expired = specialsOf(c, p).filter((s) => s.end < ln.day && s.price === b);
  if (sp && matchSys) { out.label = 'ambiguous'; out.ambiguity = `OLD_PRICE_UNDER_SPECIAL|A=leak_old_price|B=${tierLabel}`; }
  else if (matchCust && matchSys) out.label = 'leak_old_price';
  else if (matchCust && !matchSys) { out.label = 'ambiguous'; out.ambiguity = `DECLINED_TWO_BACK|A=leak_old_price|B=${expired.length ? 'leak_expired_special' : tierLabel}`; }
  else if (expired.length) out.label = 'leak_expired_special';
  else { const abp = parseLooseDiscount(ln.memo); if (dbp === null && abp !== null && b === fl((ref * (10000 - abp)) / 10000)) { out.label = 'ambiguous'; out.ambiguity = `DISCOUNT_MEMO_WORDING|A=ok_volume_discount|B=${tierLabel}`; } else out.label = tierLabel; }
  if (out.label.startsWith('leak_')) out.shortfall = (ref - b) * ln.qty;
  return out;
}

// 生成の意図と判定の突き合わせ
const EXPECT = { normal: ['ok', 'ok_special', 'ok_declined', 'ok_deferred', 'leak_below_margin_floor'], vd: ['ok_volume_discount', 'leak_below_margin_floor'], old2: ['leak_old_price'], old1: ['leak_old_price'], old1_twoback: ['leak_rate_out_of_tier', 'unexplained'], stale: ['leak_rate_out_of_tier', 'unexplained'], expired: ['leak_expired_special'], manual_out: ['leak_rate_out_of_tier'], manual_in: ['unexplained'], wrongrate: ['leak_rate_out_of_tier'], twoback_declined: ['ambiguous'], memo_amb: ['ambiguous'], zero: ['leak_rate_out_of_tier'], sample: ['ok_sample'], return: ['ok_return'], nonproduct: ['ok_non_product'] };
const truthRows = [];
const mismatches = [];
for (const l of mainLines) {
  const j = judge(l); l.judge = j;
  if (!EXPECT[l.intent].includes(j.label)) mismatches.push({ intent: l.intent, label: j.label, line: `${l.slip}-${l.row}`, c: l.c.code, p: l.code, day: iso(l.day), billed: l.billed, ref: j.reference, amb: j.ambiguity });
}
if (mismatches.length) { console.error('意図と判定の食い違い:', mismatches.length); for (const m of mismatches.slice(0, 40)) console.error(JSON.stringify(m)); process.exit(1); }

// ============================================================
// next/：次回改定（REV3）の新定価・新単価マスタ・12月の売上
// ============================================================
function assignRev3() {
  const act = customers.filter((c) => c.end === null);
  const sh = shuffle(act);
  const plan = [];
  const n = sh.length;
  const nDef = Math.round(n * 0.08), nPart = Math.round(n * 0.05), nDec = Math.round(n * 0.1), nNeg = Math.round(n * 0.07);
  for (let i = 0; i < nDef; i++) plan.push({ kind: 'deferred', applyDay: i % 2 === 0 ? dayOf(2027, 1, 1) : dayOf(2027, 2, 1) });
  for (let i = 0; i < nPart; i++) plan.push({ kind: 'partial', applyDay: REV3 });
  for (let i = 0; i < nDec; i++) plan.push({ kind: 'declined' });
  for (let i = 0; i < nNeg; i++) plan.push({ kind: 'negotiating' });
  while (plan.length < n) plan.push({ kind: 'agreed', applyDay: REV3 });
  const pl = shuffle(plan);
  const revCats = ['CB', 'CK', 'PB', 'WP', 'KK', 'KS', 'FT', 'TP'];
  sh.forEach((c, i) => { const st = { ...pl[i], excluded: [] }; if (st.kind === 'partial') { const cats = [...new Set(c.assort.map((a) => a.p.cat))].filter((k) => revCats.includes(k)); st.excluded = shuffle(cats).slice(0, 1); } c.rev3 = st; });
}
assignRev3();
for (const p of products) {
  const d = CATDEF[p.cat];
  const cur = p.listSegs[p.listSegs.length - 1].price;
  let pct = 0;
  if (p.disc !== null) pct = 0;
  else if (p.cat === 'LB') pct = chance(0.5) ? 3 : 0;
  else if (p.cat === 'TP') pct = p.augUp ? 0 : 5;
  else if (p.cat === 'PF') pct = 0;
  else pct = chance(0.9) ? rf(d.rev3[0], d.rev3[1]) : 0;
  p.newList = pct > 0 ? roundList(cur * (1 + pct / 100), true) : null;
  if (p.newList === cur) p.newList = null;
}
// 直近12か月に買った組
const boughtLast12 = new Set();
for (const l of mainLines) if (l.p && l.qty > 0 && l.day >= LAST12_START) boughtLast12.add(pkey(l.c, l.p));
const master = new Map(); // key -> {c,p,effective,newPrice,oldPrice}
for (const c of customers) {
  if (c.end !== null || !c.rev3 || !['agreed', 'deferred', 'partial'].includes(c.rev3.kind)) continue;
  const eff = c.rev3.applyDay;
  for (const a of c.assort) {
    const p = a.p; if (!boughtLast12.has(pkey(c, p)) || p.newList === null) continue;
    if (c.rev3.kind === 'partial' && c.rev3.excluded.includes(p.cat)) continue;
    if (specialInForce(c, p, eff)) continue;
    const oldL = custListAt(c, p, SALES_END);
    master.set(pkey(c, p), { c, p, effective: eff, newPrice: fl((p.newList * c.rate) / 1000), oldPrice: fl((oldL * c.rate) / 1000) });
  }
}
// 12月の反映漏れ
const decRegime = new Map();
{
  const mc = shuffle(customers.filter((c) => c.end === null && c.rev3.kind === 'agreed' && [...master.values()].filter((m) => m.c === c).length >= 4));
  decRegime.set(mc[0].code, { all: true, to: NEXT_END });
  decRegime.set(mc[1].code, { all: true, to: dayOf(2026, 12, 10) });
  const pairs = shuffle([...master.values()].filter((m) => m.effective === REV3 && !decRegime.has(m.c.code)));
  const nOld = Math.round(pairs.length * 0.06);
  pairs.slice(0, nOld).forEach((m, i) => decRegime.set(pkey(m.c, m.p), { to: i % 2 === 0 ? NEXT_END : dayOf(2026, 12, 15) }));
}
function priceDec(c, p, day, qty) {
  const m = master.get(pkey(c, p));
  if (m) {
    if (day < m.effective) return { billed: m.oldPrice, kind: '得意先', memo: '', intent: 'before_eff' };
    const cr = decRegime.get(c.code); const pr = decRegime.get(pkey(c, p));
    if ((cr && day <= cr.to) || (pr && day <= pr.to)) return { billed: m.oldPrice, kind: '得意先', memo: '', intent: 'still_old' };
    const lotMax = p.lot[1] * (c.tier === 'S' ? 2 : 1);
    if (qty >= lotMax * 0.6 && chance(c.tier === 'S' ? 0.06 : 0.3)) { const [memo, bp] = wpick(DISCOUNTS, DISC_W); const b = fl((m.newPrice * (10000 - bp)) / 10000); if (b !== m.newPrice && b !== m.oldPrice) return { billed: b, kind: '手入力', memo, intent: 'vd_new' }; }
    return { billed: m.newPrice, kind: c.tier === 'S' || c.tier === 'A' ? (chance(0.55) ? '得意先' : '標準') : '標準', memo: pick(NORMAL_MEMOS), intent: 'new' };
  }
  // 新単価マスタにない組：特値、見送り、改定対象外、直近12か月に買っていない
  const sp = specialInForce(c, p, day);
  if (sp) return { billed: sp.price, kind: '得意先', memo: '', intent: 'not_in_master' };
  const agreed = ['agreed', 'deferred', 'partial'].includes(c.rev3.kind) && !(c.rev3.kind === 'partial' && c.rev3.excluded.includes(p.cat));
  const L = agreed && p.newList !== null && day >= c.rev3.applyDay ? p.newList : custListAt(c, p, SALES_END);
  return { billed: fl((L * c.rate) / 1000), kind: '標準', memo: '', intent: 'not_in_master' };
}
const decSlips = genPeriod(NEXT_START, NEXT_END, priceDec, { scale: 1.0 });
let decNo = 2611001;
const decLines = [];
for (const s of decSlips) { s.no = decNo++; s.lines.forEach((l, i) => { l.slip = s.no; l.row = i + 1; decLines.push(l); }); }
function judgeDec(ln) {
  const out = { label: '', expected: '', shortfall: 0, pattern: '' };
  if (!ln.p) { out.label = 'ok_non_product'; return out; }
  if (ln.qty < 0) { out.label = 'ok_return'; return out; }
  if (ln.billed === 0 && KEYWORDS.test(ln.memo.normalize('NFKC'))) { out.label = 'ok_sample'; return out; }
  const m = master.get(pkey(ln.c, ln.p));
  if (!m) { out.label = 'not_in_master'; return out; }
  if (ln.day < m.effective) { out.expected = m.oldPrice; if (ln.billed === m.oldPrice) out.label = 'ok_before_effective'; else throw new Error('適用日前の単価が想定外 ' + ln.slip); return out; }
  out.expected = m.newPrice;
  if (ln.billed === m.newPrice) { out.label = 'ok_new_price'; return out; }
  if (ln.billed === m.oldPrice) { out.label = 'still_old_price'; out.shortfall = (m.newPrice - m.oldPrice) * ln.qty; const cr = decRegime.get(ln.c.code); out.pattern = cr ? (cr.to === NEXT_END ? 'customer_wide' : 'customer_wide_fixed_1211') : (decRegime.get(pkey(ln.c, ln.p)).to === NEXT_END ? 'pair' : 'pair_fixed_1216'); return out; }
  const dbp = parseDocumentedDiscount(ln.memo);
  if (dbp !== null && ln.billed === fl((m.newPrice * (10000 - dbp)) / 10000)) { out.label = 'ok_volume_discount'; return out; }
  throw new Error('12月の単価が想定外 ' + ln.slip);
}
const EXPECT_DEC = { new: ['ok_new_price'], still_old: ['still_old_price'], before_eff: ['ok_before_effective'], vd_new: ['ok_volume_discount'], not_in_master: ['not_in_master'], sample: ['ok_sample'], return: ['ok_return'], nonproduct: ['ok_non_product'] };
for (const l of decLines) { l.judge = judgeDec(l); if (!EXPECT_DEC[l.intent].includes(l.judge.label)) { console.error('12月: 意図と判定の食い違い', l.intent, l.judge.label, l.slip); process.exit(1); } }

// ============================================================
// 書き出し
// ============================================================
fs.rmSync(DATA_DIR, { recursive: true, force: true }); fs.mkdirSync(path.join(DATA_DIR, 'next'), { recursive: true });
fs.rmSync(SEALED_DIR, { recursive: true, force: true }); fs.mkdirSync(path.join(SEALED_DIR, 'truth'), { recursive: true });
const written = [];
function writeFile(rel, buf) { const f = path.join(DATA_DIR, rel); fs.writeFileSync(f, buf); written.push({ path: rel, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }); }
const writeSjis = (rel, text) => writeFile(rel, toCp932(text));
const writeBom = (rel, text) => writeFile(rel, Buffer.from('﻿' + text, 'utf8'));
const writeUtf8 = (rel, text) => writeFile(rel, Buffer.from(text, 'utf8'));

const COMPANY = { note: 'すべて架空のデータです。実在の企業・団体・人物とは関係ありません。', name: '白波紙工株式会社', nameKana: 'しらなみしこうかぶしきがいしゃ', postalCode: '136-0000', address: '東京都江東区架空町一丁目2番3号', prefecture: '東京都', representative: '代表取締役社長 白波 太郎', department: '営業本部 営業企画部', tel: '03-0000-0000', business: '包装資材・紙製品の製造販売（段ボールケース・紙器・紙袋・包装紙・紙管・紙製緩衝材・紙製食品容器・ラベル）および包装副資材の販売', fiscalYearStart: 4 };
writeUtf8('company.json', JSON.stringify(COMPANY, null, 2) + '\n');
writeUtf8('demo_settings.json', JSON.stringify({ note: '診断の初期設定（架空）。アプリ側で変更できる前提の値です。', marginFloorPct: 10, unitPriceRounding: 'floor' }, null, 2) + '\n');

// 掛率ランク（Excel保存：UTF-8 BOM）
writeBom('掛率ランク表.csv', csvMin([['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明'], ...Object.entries(TIERS).map(([k, t]) => [k, t.name, (t.std / 10).toFixed(1), (t.lo / 10).toFixed(1), (t.hi / 10).toFixed(1), t.desc])]));
// カテゴリ（Excel保存）
writeBom('カテゴリ別原価構成.csv', csvMin([['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料'], ...CAT_ORDER.map((k) => [k, CATDEF[k].name, ...CATDEF[k].ratio, CATDEF[k].raw])]));
// 仕入先（自社工場を含む）
const SUPPLIERS = [['F01', '白波紙工 本社工場（段ボール・紙器）', 'CB;CK'], ['F02', '白波紙工 関東工場（紙袋・包装紙・紙管）', 'PB;WP;KK'], ['F03', '白波紙工 関西工場（緩衝材・食品容器・ラベル）', 'KS;FT;LB'], ['S01', '青嵐粘着工業株式会社', 'TP'], ['S02', '月影化成株式会社', 'PF'], ['S03', '碧海フィルム株式会社', 'PF'], ['S04', '浜風結束資材株式会社', 'TP']];
writeSjis('仕入先マスタ.csv', csvMin([['仕入先コード', '仕入先名', '主な取扱カテゴリ'], ...SUPPLIERS]));
// 得意先マスタ（販売管理から出力：Shift_JIS）
writeSjis('得意先マスタ.csv', csvMin([['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日'], ...customers.map((c) => [c.code, c.name, c.abbr, c.type, c.tier, (c.rate / 10).toFixed(1), c.branch, c.rep, c.pref, c.closing, c.dept, iso(c.start)])]));
// 商品マスタ
writeSjis('商品マスタ.csv', csvMin([['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)'], ...products.map((p) => [p.code, p.name, p.cat, p.unit, p.listSegs[p.listSegs.length - 1].price, sen2(p.costSegs[p.costSegs.length - 1].cost), p.supplier, ...p.ratio])]));
// 定価履歴・原価履歴
writeSjis('定価履歴.csv', csvMin([['商品コード', '定価(円)', '適用開始日', '適用終了日'], ...products.flatMap((p) => p.listSegs.map((s) => [p.code, s.price, iso(s.start), s.end === null ? '' : iso(s.end)]))]));
writeSjis('原価履歴.csv', csvMin([['商品コード', '原単価(円)', '適用開始日', '適用終了日'], ...products.flatMap((p) => p.costSegs.map((s) => [p.code, sen2(s.cost), iso(s.start), s.end === null ? '' : iso(s.end)]))]));
// 仕入先値上げ通知（Excel管理）
{
  const rows = [['通知日', '仕入先コード', '仕入先名', '商品コード', '商品名', '現行仕入単価(円)', '改定後仕入単価(円)', '改定率(%)', '適用日', '主な理由', '状態']];
  const sname = Object.fromEntries(SUPPLIERS.map((s) => [s[0], s[1]]));
  for (const p of products.filter((p) => p.cat === 'TP' && p.disc === null)) { const i = p.costSegs.findIndex((s) => s.start === COST_RISE); if (i < 1) continue; rows.push([excelDate(dayOf(2026, 4, 15)), p.supplier, sname[p.supplier], p.code, p.name, sen2(p.costSegs[i - 1].cost), sen2(p.costSegs[i].cost), p.noticePct.toFixed(1), excelDate(COST_RISE), p.supplier === 'S01' ? '原材料(粘着剤・基材)とエネルギーコストの上昇' : '樹脂価格と物流費の上昇', '適用済み']); }
  for (const p of products.filter((p) => p.cat === 'PF' && p.disc === null && p.supplier === 'S02')) { const cur = p.costSegs[p.costSegs.length - 1].cost; const pct = Math.round(rf(5, 7) * 10) / 10; rows.push([excelDate(dayOf(2026, 9, 20)), 'S02', sname.S02, p.code, p.name, sen2(cur), sen2(Math.round(cur * (1 + pct / 100))), pct.toFixed(1), excelDate(dayOf(2027, 1, 1)), 'ポリエチレン樹脂価格の上昇', '予定']); }
  for (const p of products.filter((p) => p.cat === 'TP' && p.disc === null && p.supplier === 'S04')) { const cur = p.costSegs[p.costSegs.length - 1].cost; const pct = Math.round(rf(5, 6.5) * 10) / 10; rows.push([excelDate(dayOf(2026, 9, 30)), 'S04', sname.S04, p.code, p.name, sen2(cur), sen2(Math.round(cur * (1 + pct / 100))), pct.toFixed(1), excelDate(REV3), '樹脂価格・物流費の上昇', '予定']); }
  writeBom('仕入先値上げ通知一覧.csv', csvMin(rows));
}
// 前回改定（令和8年4月）の合意状況：Excel で管理していたファイル（UTF-8 BOM、コードの先頭ゼロが落ちている）
const AGREEMENTS_FILE = '令和8年度価格改定_得意先回答状況.csv';
{
  const rows = [['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考']];
  const memoFor = (c) => { const st = c.rev2; if (st.kind === 'deferred') return pick([`${ymdOf(st.applyDay).m}月1日納品分より`, `${ymdOf(st.applyDay).m}月出荷分から適用で合意`, '在庫調整のため適用を後ろ倒し']); if (st.kind === 'partial') return `${st.excluded.map((k) => CATDEF[k].name).join('・')}は据え置き`; if (st.kind === 'declined') return pick(['年度内は現行価格で継続', '競合見積を理由に値上げ不可の回答', '取引縮小のため見送り', '次回改定で再協議', '']); if (st.kind === 'negotiating') return pick(['再協議予定', '数量条件で調整中', '先方購買部で検討中', '']); return pick(['', '', '', '書面で回答あり', '電話で合意', '担当者面談で合意']); };
  for (const c of customers.filter((c) => c.rev2.kind !== 'none')) { const st = c.rev2; const apply = st.kind === 'declined' ? '' : st.kind === 'negotiating' ? (st.mitei ? '未定' : '') : st.blankDate ? '' : excelDate(st.applyDay); rows.push([String(Number(c.code)), c.name, excelDate(st.requestDay), st.replyDay ? excelDate(st.replyDay) : '', st.word, apply, st.excluded.join(';'), memoFor(c)]); }
  writeBom(AGREEMENTS_FILE, csvMin(rows));
}
// 特値一覧（販売管理A形式：全項目引用符・和暦・全角コード）
const codeA = (code, branch) => { if (!code.includes('-')) return branch === '中部営業所' ? code : fw(code); const [a, b] = code.split('-'); if (branch === '本社営業部') return fw(a) + '－' + fw(b); if (branch === '北関東営業所') return fw(a) + fw(b); if (branch === '関西営業所') return fw(a) + 'ー' + fw(b); return code; };
const custCodeA = (code) => fw(code);
{
  const rows = [['得意先コード', '得意先名', '商品コード', '商品名', '特値単価', '開始日', '終了日', '登録理由']];
  const sorted = specials.slice().sort((a, b) => (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : a.p.code < b.p.code ? -1 : a.p.code > b.p.code ? 1 : a.start - b.start));
  for (const s of sorted) rows.push([custCodeA(s.c.code), s.c.name, codeA(s.p.code, '本社営業部'), fw(s.p.name), comma(s.price), warekiLong(s.start), warekiLong(s.end), s.reason]);
  writeSjis('特値一覧.csv', csvAllQuoted(rows));
}
// 売上明細一覧（販売管理A形式・Shift_JIS・CRLF）
const SALES_FILE = '売上明細一覧_202501-202609.csv';
const SALES_HEADER = ['売上日', '伝票番号', '行', '取引区分', '部門', '得意先コード', '得意先名', '商品コード', '商品名', '数量', '単位', '定価', '掛率(%)', '単価', '金額', '原単価', '原価金額', '粗利額', '単価区分', '備考'];
function salesRow(l) {
  const c = l.c; const L = l.p ? sysList(l.p, l.day) : 0;
  const costSen = l.p ? costAt(l.p, l.day) : l.cost;
  const amount = l.billed * l.qty; const costAmt = roundHalfAway((costSen * l.qty) / 100);
  const rate = L > 0 ? (Math.round((l.billed / L) * 1000) / 10).toFixed(1) : '0.0';
  let code = codeA(l.code, c.branch); if (c.branch === '中部営業所' && chance(0.05)) code += ' ';
  return [warekiA(l.day), String(l.slip), String(l.row), l.trans, c.branch, custCodeA(c.code), c.name, code, fw(l.name), String(l.qty), fw(l.unit), comma(L), rate, comma(l.billed), comma(amount), sen2comma(costSen), comma(costAmt), comma(amount - costAmt), l.kind, fw(l.memo)];
}
writeSjis(SALES_FILE, csvAllQuoted([SALES_HEADER, ...mainLines.map(salesRow)]));
// next/
const NEXT_LIST_FILE = 'next/新定価表_20261201.csv';
writeBom(NEXT_LIST_FILE, csvMin([['商品コード', '商品名', '現定価(円)', '新定価(円)', '適用日'], ...products.filter((p) => p.newList !== null).map((p) => [p.code, p.name, p.listSegs[p.listSegs.length - 1].price, p.newList, excelDate(REV3)])]));
const NEXT_MASTER_FILE = 'next/新単価マスタ_20261201.csv';
{
  const rows = [['得意先コード', '得意先名', '商品コード', '商品名', '適用開始日', '新単価', '現単価']];
  const ms = [...master.values()].sort((a, b) => (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : a.p.code < b.p.code ? -1 : a.p.code > b.p.code ? 1 : 0));
  for (const m of ms) rows.push([custCodeA(m.c.code), m.c.name, codeA(m.p.code, '本社営業部'), fw(m.p.name), warekiA(m.effective), comma(m.newPrice), comma(m.oldPrice)]);
  writeSjis(NEXT_MASTER_FILE, csvAllQuoted(rows));
}
const NEXT_SALES_FILE = 'next/売上明細一覧_202612.csv';
writeSjis(NEXT_SALES_FILE, csvAllQuoted([SALES_HEADER, ...decLines.map(salesRow)]));

// ---------- 正解
const LABELS = ['ok', 'ok_special', 'ok_declined', 'ok_deferred', 'ok_volume_discount', 'ok_return', 'ok_sample', 'ok_non_product', 'leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor', 'unexplained', 'ambiguous'];
{
  const rows = [['file', 'row', 'line_id', 'date', 'customer_code', 'product_code', 'qty', 'billed', 'label', 'ambiguity', 'reference', 'reference_kind', 'shortfall_yen', 'below_floor', 'floor_price', 'floor_gap_yen', 'last12m']];
  mainLines.forEach((l, i) => { const j = l.judge; rows.push([SALES_FILE, i + 1, `${l.slip}-${l.row}`, iso(l.day), l.c.code, l.code, l.qty, l.billed, j.label, j.ambiguity, j.reference, j.refKind, j.shortfall, j.belowFloor, j.floorPrice, j.floorGap, l.day >= LAST12_START ? 1 : 0]); });
  fs.writeFileSync(path.join(SEALED_DIR, 'truth', 'lines.csv'), csvMin(rows, '\n'));
}
{
  const rows = [['file', 'row', 'line_id', 'label', 'date', 'customer', 'product', 'qty', 'billed', 'expected', 'shortfall_yen', 'pattern']];
  decLines.forEach((l, i) => { const j = l.judge; rows.push([NEXT_SALES_FILE, i + 1, `${l.slip}-${l.row}`, j.label, iso(l.day), l.c.code, l.code, l.qty, l.billed, j.expected, j.shortfall, j.pattern]); });
  fs.writeFileSync(path.join(SEALED_DIR, 'truth', 'followup_lines.csv'), csvMin(rows, '\n'));
}
const counts = {}, counts12 = {}, short = {}, short12 = {}, ambPat = {};
for (const l of mainLines) { const j = l.judge; counts[j.label] = (counts[j.label] || 0) + 1; if (l.day >= LAST12_START) counts12[j.label] = (counts12[j.label] || 0) + 1; if (j.label.startsWith('leak_')) { short[j.label] = (short[j.label] || 0) + j.shortfall; if (l.day >= LAST12_START) short12[j.label] = (short12[j.label] || 0) + j.shortfall; } if (j.label === 'ambiguous') { const k = j.ambiguity.split('|')[0]; ambPat[k] = (ambPat[k] || 0) + 1; } }
const decCounts = {}; let decShort = 0; for (const l of decLines) { decCounts[l.judge.label] = (decCounts[l.judge.label] || 0) + 1; decShort += l.judge.shortfall; }
const ordered = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const leakTotal = Object.values(short).reduce((a, b) => a + b, 0), leakTotal12 = Object.values(short12).reduce((a, b) => a + b, 0);
const summary = {
  note: 'すべて架空のデータです（gen-4：包装資材・紙製品メーカー、直販と代理店）。',
  company: COMPANY.name,
  sales_period: { from: iso(SALES_START), to: iso(SALES_END), months: 21 },
  last12m: { from: iso(LAST12_START), to: iso(SALES_END) },
  previous_revision_date: iso(REV2),
  revision_dates_in_history: [iso(REV1), iso(REV2)],
  agreements_file: AGREEMENTS_FILE,
  margin_floor_pct: 10,
  scale: { customers: customers.length, products: products.length, sales_lines: mainLines.length, specials: specials.length, agreements_rows: customers.filter((c) => c.rev2.kind !== 'none').length },
  counts: ordered(counts), counts_last12m: ordered(counts12),
  shortfall_yen: Object.fromEntries(Object.keys(short).sort().map((k) => [k, { all: short[k], last12m: short12[k] || 0 }])),
  shortfall_total_yen: { all: leakTotal, last12m: leakTotal12 },
  ambiguous_patterns: ordered(ambPat),
  customer_wide: { old_price_whole_period: [...custRegime.entries()].filter(([, r]) => r.wholeOld).map(([k, r]) => ({ customer: k, from: iso(r.wholeOld.from), to: iso(r.wholeOld.to) })), wrong_master_rate: [...custRegime.entries()].filter(([, r]) => r.wrongRate).map(([k, r]) => ({ customer: k, rate_used: r.wrongRate.rate / 10, from: iso(r.wrongRate.from), to: iso(r.wrongRate.to) })) },
  followup: { revision_date: iso(REV3), sales_file: NEXT_SALES_FILE, master_pairs: master.size, counts: ordered(decCounts), shortfall_yen: decShort, customer_wide: [...decRegime.entries()].filter(([k, r]) => r.all).map(([k, r]) => ({ customer: k, to: iso(r.to) })) },
  files: written.map((w) => ({ path: w.path, bytes: w.bytes, sha256: w.sha256 })),
};
fs.writeFileSync(path.join(SEALED_DIR, 'truth', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

// notes.md（判断が分かれる行の説明）
{
  const amb = mainLines.filter((l) => l.judge.label === 'ambiguous');
  const byPat = {}; for (const l of amb) { const k = l.judge.ambiguity.split('|')[0]; (byPat[k] = byPat[k] || []).push(l); }
  let md = `# gen-4 正解メモ（架空データ）\n\n会社：${COMPANY.name}（架空）。包装資材・紙製品のメーカーで、直販と代理店（掛率ランクS）に販売しています。\n\n`;
  md += `- 前回の定価改定（合意状況ファイル「${AGREEMENTS_FILE}」が答えている改定）：**${warekiLong(REV2)}（${iso(REV2)}）**\n- 定価履歴にある全社的な改定日：${iso(REV1)}（令和7年4月1日）と ${iso(REV2)}（令和8年4月1日）。ほかに個別の改定（2025-10-01 ポリ袋4点の値下げ、2026-08-01 テープ8点の値上げ）、新商品の初回定価、廃番があります。\n- 粗利率の下限：10%。粗利下限の単価は ceil(原単価(銭) / 90) 円（単価 p で (p − 原単価)/p ≥ 10% になる最小の整数）。粗利の判定には、その日の原単価（原価履歴＝売上明細の原単価の列）を使っています。\n- 請求単価が粗利下限の単価の ±3円以内になる行は、丸めの違いで判定が揺れるため生成時に捨てています（粗利下限割れの行は下限より4円以上安い）。\n- 直近12か月（last12m=1）：${iso(LAST12_START)}〜${iso(SALES_END)}。\n- 不足額は、反映漏れ・期限切れ・ランク外は（正しい単価 − 請求単価）× 数量、粗利下限割れは（粗利下限の単価 − 請求単価）× 数量。unexplained と ambiguous の不足額は 0 にしています（reference 列に正しい単価があります）。\n\n`;
  md += `## 主なルールの読み方（正解の作り方）\n\n- 正しい単価＝期間内の特値（重なるときは開始日が一番新しいもの）、なければ 得意先に適用すべき定価 × 得意先マスタの掛率（円未満切り捨て）。\n- 得意先に適用すべき定価：令和8年4月1日の改定は、合意状況が「見送り」「合意に至らず」「協議中」の得意先と、「一部合意」の対象外カテゴリには適用しない（旧定価のまま）。「合意」で適用日が後ろの得意先はその日から。「合意」で適用日が空欄なら改定日から。合意状況に行がない得意先（改定後に取引開始した得意先・記載漏れ）は合意とみなす。令和7年4月1日の改定には合意状況ファイルがないので、全得意先に適用。\n- ok_declined：見送り・協議中・据え置きカテゴリの旧価格。ok_deferred：適用日前の旧価格。\n- 反映漏れ（leak_old_price）：その得意先に直前まで適用されていた定価 × 掛率 のままの請求。2回前の定価のままは反映漏れにせず、ランクの下限より安ければランク外、範囲内なら unexplained。\n- 期限切れ特値：期間が終わった特値と同じ単価の請求（更新後の特値が有効なときも同じ）。\n- 数量値引：備考の「数量値引n%」「まとめ買いn%引」で、正しい単価 ×（100−n）% の切り捨てと一致する行。粗利率が10%未満なら粗利下限割れ。\n- 単価0円で備考に「見本」「サンプル」「無償」「試供」のどれかがあれば無償品（対象外）。それ以外の0円（「展示会用」「試作品」など）はランク外（不足額＝正しい単価×数量）。\n- 得意先マスタの掛率が誤っている2社は、売上明細の全行（特値以外）がランク外。\n\n`;
  md += `## 判断が分かれる行（label=ambiguous、${amb.length}行）\n\n`;
  const desc = { DECLINED_TWO_BACK: '令和8年4月の改定を見送った（または協議中の）得意先が、令和7年4月の改定より前の定価 × 掛率 で請求されている行。「その得意先に直前まで適用されていた定価」という読み方（A）では反映漏れ、商品の定価履歴で数えて2回前の定価という読み方（B）ではランク外（または原因不明）。', DISCOUNT_MEMO_WORDING: '備考が「大口値引5%」で、正しい単価の5%引き（切り捨て）と一致する行。文書の例（数量値引n%、まとめ買いn%引）と書き方が違うため、数量値引として読む（A）か、備考を読まずランク外／原因不明とする（B）かが分かれる。', OLD_PRICE_UNDER_SPECIAL: '特値の期間中に旧定価×掛率で請求されている行（生成していない想定）。' };
  for (const [k, ls] of Object.entries(byPat)) { md += `### ${k}（${ls.length}行）\n\n${desc[k] || ''}\n\n`; const pairs = [...new Set(ls.map((l) => `${l.c.code} × ${l.code}`))]; md += `組：${pairs.join('、')}\n\n`; }
  md += `## 漏れでないが紛らわしいもの\n\n- 特値の期間中は定価改定があっても特値のまま（ok_special）。特値が更新され3月1日から重なる組が2組（開始日が新しい方を使う）。\n- 見送り・協議中・一部合意の据え置きカテゴリの旧価格（ok_declined）、適用日後ろ倒しの適用日前（ok_deferred）。\n- 数量値引（備考に記載）、返品（取引区分「返品」・数量マイナス）、見本品（単価0・備考）、運賃・抜型代・版代（商品マスタにないコード 9999/9998/9997）。\n- 改定後に取引を始めた得意先（合意状況に行がない）は新定価が正しい。\n- 2025-10-01 にポリ袋4点の定価を下げているが、その後の請求はすべて新しい（安い）定価で、前の高い定価のままの行は作っていない。\n\n## 得意先まるごと\n\n`;
  for (const o of summary.customer_wide.old_price_whole_period) md += `- ${o.customer} ${customerByCode.get(o.customer).name}：${o.from}〜${o.to} 旧価格のまま（反映漏れ）\n`;
  for (const o of summary.customer_wide.wrong_master_rate) md += `- ${o.customer} ${customerByCode.get(o.customer).name}：販売管理の掛率が ${o.rate_used}%（マスタは ${customerByCode.get(o.customer).rate / 10}%）${o.from}〜${o.to}（ランク外）\n`;
  md += `\n## 反映チェック（next/）\n\n- 次回改定 ${iso(REV3)}（令和8年12月1日）。新単価マスタは、合意・一部合意・適用日変更の得意先が直近12か月に買った、新定価のある商品（特値が有効な組は除く）。適用日変更は 2027-01-01 または 2027-02-01。\n- 旧単価のまま：得意先まるごと1社（12月中ずっと）、1社（12月10日まで）、ほかに対象の組の約6%（半分は月末まで、半分は12月15日まで）。\n- マスタにない組（見送り・協議中の得意先、新定価のない商品、特値、直近12か月に買っていない組）は not_in_master。\n`;
  fs.writeFileSync(path.join(SEALED_DIR, 'notes.md'), md);
}
console.log(JSON.stringify({ lines: mainLines.length, customers: customers.length, products: products.length, specials: specials.length, counts: ordered(counts), leakShare: (Object.entries(counts).filter(([k]) => k.startsWith('leak_')).reduce((a, [, v]) => a + v, 0) / mainLines.length).toFixed(4), ambiguous: ambPat, dec: ordered(decCounts), decLines: decLines.length, masterPairs: master.size, mismatches: mismatches.length }, null, 1));
