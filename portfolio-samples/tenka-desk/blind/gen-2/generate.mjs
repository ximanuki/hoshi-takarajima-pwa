#!/usr/bin/env node
// gen-2: 転嫁デスク向けの「独立した」検証用データ生成器（すべて架空）
//
// 公開文書（README.md / README.en.md / data-gen/README.md）と、サンプルファイルの見出し行だけを読んで書いたものです。
// エンジン・data-gen の実装は読んでいません。
//
// 使い方:
//   node generate.mjs [--out <入力データの出力先>] [--sealed <正解の出力先>]
//
// 乱数は固定シード、時計・Math.random は使いません。何度実行しても同じバイト列になります。

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRATCH = '/tmp/claude-0/-home-user-hoshi-takarajima-pwa/ec916e31-752a-5975-905b-5b512ec7224c/scratchpad';
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OUT = opt('--out', join(SCRATCH, 'blind-data', 'gen-2'));
const SEALED = opt('--sealed', join(SCRATCH, 'sealed-tenka', 'gen-2'));

// ================================================================ 乱数（固定シード）
function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function R(name) {
  let s = (hashSeed(`gen-2/${name}`) ^ 0x5eed2026) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (a) => a[Math.floor(next() * a.length)],
    chance: (p) => next() < p,
    shuffle: (a) => {
      const b = a.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = b[i];
        b[i] = b[j];
        b[j] = t;
      }
      return b;
    },
  };
  r.sample = (a, n) => r.shuffle(a).slice(0, n);
  r.weighted = (items, wf) => {
    let tot = 0;
    for (const it of items) tot += wf(it);
    let x = next() * tot;
    for (const it of items) {
      x -= wf(it);
      if (x < 0) return it;
    }
    return items[items.length - 1];
  };
  return r;
}

// ================================================================ 日付（Date を使わない）
const pad2 = (n) => String(n).padStart(2, '0');
function dfc(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function cfd(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [y + (m <= 2 ? 1 : 0), m, d];
}
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const toDays = (iso) => dfc(+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10));
const fromDays = (n) => isoOf(...cfd(n));
const addDays = (iso, k) => fromDays(toDays(iso) + k);
const dow = (iso) => (((toDays(iso) + 4) % 7) + 7) % 7; // 0=日曜
const monthEnd = (ym) => {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  return fromDays(dfc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1);
};
const maxD = (a, b) => (a > b ? a : b);
const minD = (a, b) => (a < b ? a : b);
const reiwaShort = (iso) => `R${pad2(+iso.slice(0, 4) - 2018)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
function warekiLong(iso) {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  if (iso >= '2019-05-01') return `令和${y - 2018}年${m}月${d}日`;
  return `平成${y - 1988}年${m}月${d}日`;
}
const ymd8 = (iso) => iso.replaceAll('-', '');
const excelDate = (iso) => `${+iso.slice(0, 4)}/${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

// ================================================================ 数値
const comma = (n) => (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const senStr = (sen) => `${Math.floor(sen / 100)}.${pad2(sen % 100)}`;
const senStrA = (sen) => `${comma(Math.floor(sen / 100))}.${pad2(sen % 100)}`;
const roundHalfAway = (num, den) => (num < 0 ? -1 : 1) * Math.floor((Math.abs(num) * 2 + den) / (2 * den));
const listUnit = (v) => (v < 1000 ? 10 : v < 10000 ? 50 : 100);
// num/den を定価の単位（1,000円未満10円・1万円未満50円・それ以上100円）に切り上げ
function ceilList(num, den) {
  const u = listUnit(num / den);
  return Math.floor((num + den * u - 1) / (den * u)) * u;
}
// num/den 銭 を 90銭の倍数に丸める（粗利10%の単価がちょうど円になるように）
const roundTo90 = (num, den) => Math.max(90, Math.floor((num + den * 45) / (den * 90)) * 90);
const floorTo10 = (v) => (v >= 1000 ? Math.floor(v / 10) * 10 : v);

// ================================================================ 文字
const fw = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
const KATA_FULL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォャュョッー・';
const KATA_HALF = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯｰ･';
const DAKU = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボ';
const DAKU_BASE = 'カキクケコサシスセソタチツテトハヒフヘホ';
const HANDAKU = 'パピプペポ';
const HANDAKU_BASE = 'ハヒフヘホ';
if ([...KATA_FULL].length !== [...KATA_HALF].length) throw new Error('kana table');
function hwKana(s) {
  let o = '';
  for (const c of s) {
    let i = KATA_FULL.indexOf(c);
    if (i >= 0) o += KATA_HALF[i];
    else if ((i = DAKU.indexOf(c)) >= 0) o += `${KATA_HALF[KATA_FULL.indexOf(DAKU_BASE[i])]}ﾞ`;
    else if ((i = HANDAKU.indexOf(c)) >= 0) o += `${KATA_HALF[KATA_FULL.indexOf(HANDAKU_BASE[i])]}ﾟ`;
    else if (c === 'ヴ') o += 'ｳﾞ';
    else o += c;
  }
  return o;
}
// 文書どおりの正規化（検証で読み直すときに使う）
const normProd = (s) => s.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—―−ー－ｰ]/g, '');
const normCust = (s) => s.normalize('NFKC').replace(/\D/g, '').padStart(6, '0');

// ================================================================ CSV・文字コード
function csvField(v, always) {
  const s = v === null || v === undefined ? '' : String(v);
  if (always || /[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}
const csvLine = (fields, always = false) => fields.map((f) => csvField(f, always)).join(',');
let SJIS = null;
function sjisEncode(str) {
  if (!SJIS) {
    SJIS = new Map();
    const dec = new TextDecoder('shift_jis');
    for (let b = 0; b < 0x80; b++) SJIS.set(String.fromCharCode(b), [b]);
    for (let b = 0xa1; b <= 0xdf; b++) SJIS.set(dec.decode(Uint8Array.of(b)), [b]);
    for (let l = 0x81; l <= 0xef; l++) {
      if (l > 0x9f && l < 0xe0) continue;
      for (let t = 0x40; t <= 0xfc; t++) {
        if (t === 0x7f) continue;
        const ch = dec.decode(Uint8Array.of(l, t));
        if (ch.length === 1 && ch !== '�' && !SJIS.has(ch)) SJIS.set(ch, [l, t]);
      }
    }
  }
  const out = [];
  for (const ch of str) {
    const b = SJIS.get(ch);
    if (!b) throw new Error(`Shift_JIS にない文字: ${ch} U+${ch.codePointAt(0).toString(16)}`);
    for (const x of b) out.push(x);
  }
  return Buffer.from(out);
}
const written = []; // [relpath, rows]
function writeOut(rel, header, rows, { layout = 'plain', encoding = 'utf8', bom = false, eol = '\n' } = {}) {
  const always = layout === 'A';
  const text = [csvLine(header, always), ...rows.map((r) => csvLine(r, always))].join(eol) + eol;
  const path = join(OUT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  const buf = encoding === 'sjis' ? sjisEncode(text) : Buffer.from((bom ? '﻿' : '') + text, 'utf8');
  writeFileSync(path, buf);
  written.push([rel, rows.length]);
}
function writeText(rel, text) {
  const path = join(OUT, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  written.push([rel, null]);
}

// ================================================================ 期間と改定（すべて架空）
const START = '2024-07-01';
const END = '2026-06-30';
const L12 = '2025-07-01'; // 直近12か月 = 2025-07-01〜2026-06-30
const R0 = '2024-10-01'; // 研磨材・切削工具だけの小改定（合意状況のファイルなし）
const R0_COST = '2024-09-01';
const R1 = '2025-06-16'; // 前回の定価改定（得意先ごとの合意状況あり）。月の途中
const R1_COST = '2025-05-01';
const CUT = '2025-11-01'; // シール4品目の定価値下げ
const CUT_COST = '2025-10-01';
const R2 = '2026-03-01'; // 溶剤の改定と、樹脂12品目の再改定（合意状況のファイルなし）
const R2_COST = '2026-02-01';
const RS2_COST = '2026-02-16';
const AD_COST = '2026-02-01'; // 接着剤の仕入値上げ。定価は据え置き
const LAYOUT_B_FROM = '2026-01-01'; // 販売管理Aから販売管理Bへ移行
const NEXT_EFF = '2026-09-01';
const MONTHS = [];
for (let y = 2024, m = 7; y < 2026 || (y === 2026 && m <= 6); ) {
  MONTHS.push(`${y}-${pad2(m)}`);
  if (m === 12) {
    y++;
    m = 1;
  } else m++;
}
const SEASON = { 1: 900, 2: 1000, 3: 1200, 4: 1000, 5: 950, 6: 1000, 7: 1000, 8: 800, 9: 1100, 10: 1000, 11: 1000, 12: 1150 };
const FLOOR_PCT = 10;

// ================================================================ カテゴリと商品（架空）
const BOLT = [['M5×12 200本入', 1.3], ['M6×20 100本入', 1], ['M8×25 100本入', 1.5], ['M8×50 100本入', 1.9], ['M10×30 50本入', 1.4], ['M10×60 50本入', 1.9], ['M12×40 50本入', 2.2], ['M12×80 25本入', 1.8], ['M16×50 25本入', 2.6], ['M20×60 20本入', 3.8]];
const NUT = [['M6 200個入', 1], ['M8 200個入', 1.3], ['M10 100個入', 1.1], ['M12 100個入', 1.6], ['M16 50個入', 1.9], ['M20 25個入', 2.3], ['M24 20個入', 3.1]];
const ROD = [['W3/8×1000mm', 1], ['M10×1000mm', 1], ['M12×1000mm', 1.4], ['M16×2000mm', 3.6], ['M20×2000mm', 5.4]];
const CATS = [
  { code: 'FS', name: 'ファスナー・ねじ', ratios: [52, 18, 14, 16], main: '鋼線材', r1: 70, c: [380, 470], sup: ['S01', 'S02'], num: 10000,
    items: [['六角ボルト SS400 ユニクロ', '箱', 900, BOLT], ['六角ボルト SUS304', '箱', 1900, BOLT], ['六角穴付ボルト SCM435 黒', '箱', 1600, BOLT], ['六角ナット 1種 SS400 ユニクロ', '箱', 620, NUT], ['六角ナット 1種 SUS304', '箱', 1350, NUT], ['ばね座金 SUS304', '箱', 540, NUT], ['寸切ボルト SS400 ドブめっき', '本', 420, ROD]] },
  { code: 'BR', name: 'ベアリング・伝動部品', ratios: [48, 22, 12, 18], main: '軸受鋼', r1: 50, c: [380, 460], sup: ['S03', 'S04'], num: 11000,
    items: [
      ['深溝玉軸受 両シール', '個', 380, [['6200-2RS', 1], ['6201-2RS', 1.05], ['6202-2RS', 1.1], ['6203-2RS', 1.25], ['6204-2RS', 1.5], ['6205-2RS', 1.8], ['6206-2RS', 2.4], ['6305-2RS', 3.1], ['6308-2RS', 6.2]]],
      ['ピロー形ユニット 鋳鉄', '個', 2600, [['UCP204', 1], ['UCP205', 1.15], ['UCP206', 1.45], ['UCP208', 2.2], ['UCP210', 3.3]]],
      ['Vベルト 一般用', '本', 900, [['A-30', 1], ['A-42', 1.25], ['B-50', 1.9], ['B-65', 2.4], ['C-80', 4.2]]],
      ['ローラーチェーン 1列 3m', '本', 3800, [['#35', 0.8], ['#40', 1], ['#50', 1.5], ['#60', 2.3], ['#80', 4.4]]],
      ['スプロケット 焼入れ', '個', 1500, [['40B15', 1], ['40B20', 1.3], ['50B18', 1.8], ['60B20', 2.9]]],
      ['チェーンカップリング', '個', 6800, [['4012', 1], ['5016', 1.6], ['6018', 2.6]]],
      ['リニアブッシュ', '個', 1200, [['φ10', 1], ['φ16', 1.4], ['φ20', 1.9], ['φ30', 3.8]]],
      ['ボールねじ 研削 1000mm', '本', 42000, [['軸径16', 1], ['軸径20', 1.3], ['軸径25', 1.7]]],
      ['タイミングベルト', '本', 1800, [['XL 200', 1], ['L 300', 1.5], ['H 450', 2.6], ['S8M 800', 4]]],
      ['ニードルベアリング', '個', 680, [['HK0808', 1], ['HK1012', 1.15], ['HK1512', 1.3], ['HK2016', 1.6], ['HK2520', 2]]],
      ['ボールベアリング 開放形', '個', 300, [['608', 1], ['623', 0.9], ['625', 0.95], ['6000', 1.1], ['6001', 1.15], ['6002', 1.2]]],
    ] },
  { code: 'SL', name: 'シール・パッキン', ratios: [45, 25, 12, 18], main: '合成ゴム', r1: 0, c: [400, 480], sup: ['S05'], num: 12000,
    items: [
      ['Oリング NBR 50個入', '袋', 420, [['P-10', 1], ['P-12', 1.05], ['P-16', 1.1], ['P-20', 1.2], ['P-24', 1.3], ['P-30', 1.5], ['G-40', 1.9], ['G-60', 2.6], ['G-80', 3.4], ['G-100', 4.6]]],
      ['Oリング FKM 10個入', '袋', 980, [['P-10', 1], ['P-16', 1.2], ['P-22', 1.4], ['P-30', 1.8], ['G-50', 2.9]]],
      ['オイルシール TC形', '個', 260, [['20×35×7', 1], ['25×40×7', 1.1], ['30×45×8', 1.25], ['40×55×8', 1.6], ['50×68×9', 2.1], ['60×80×10', 2.8]]],
      ['ジョイントシートガスケット 10K', '枚', 150, [['15A', 1], ['25A', 1.3], ['50A', 2.1], ['80A', 3.2], ['100A', 4.4], ['150A', 7.6]]],
      ['うず巻形ガスケット 10K', '枚', 2400, [['25A', 1], ['50A', 1.35], ['80A', 1.9], ['100A', 2.4]]],
      ['グランドパッキン PTFE 1kg巻', '巻', 9800, [['6.5角', 1], ['8角', 1.05], ['10角', 1.1], ['12.5角', 1.2]]],
      ['シールテープ 13mm×10m', '箱', 1200, [['10巻入', 1], ['50巻入', 4.6]]],
      ['液状ガスケット', '本', 1600, [['灰色, 100g', 1], ['黒, 100g', 1.05], ['耐熱 赤, 100g', 1.4]]],
      ['Vパッキン NBR', '個', 340, [['VB-20', 1], ['VB-30', 1.3], ['VB-45', 1.8]]],
      ['ゴムシート NBR 1m×1m', '枚', 6800, [['1mm', 1], ['2mm', 1.8], ['3mm', 2.6], ['5mm', 4.2]]],
      ['Uパッキン ウレタン', '個', 520, [['USH-20', 1], ['USH-32', 1.3], ['USH-50', 1.9], ['USH-63', 2.4]]],
    ] },
  { code: 'HP', name: 'ホース・継手・配管部材', ratios: [50, 20, 14, 16], main: '合成ゴム・黄銅', r1: 60, c: [380, 460], sup: ['S06', 'S14'], num: 13000,
    items: [
      ['耐油ホース 透明 20m巻', '巻', 3800, [['内径6mm', 1], ['内径9mm', 1.3], ['内径12mm', 1.7], ['内径15mm', 2.2], ['内径19mm', 2.9], ['内径25mm', 4.1]]],
      ['ワンタッチ継手 ストレート', '個', 380, [['φ4-R1/8', 1], ['φ6-R1/8', 1.02], ['φ6-R1/4', 1.1], ['φ8-R1/4', 1.18], ['φ10-R3/8', 1.4], ['φ12-R3/8', 1.7], ['φ12-R1/2', 1.9]]],
      ['ワンタッチ継手 エルボ', '個', 450, [['φ4-R1/8', 1], ['φ6-R1/4', 1.1], ['φ8-R1/4', 1.2], ['φ10-R3/8', 1.5], ['φ12-R1/2', 1.9]]],
      ['ステンレスフレキ管 ナット付', '本', 2100, [['15A×300mm', 1], ['20A×500mm', 1.6], ['25A×500mm', 2.2], ['32A×1000mm', 3.8], ['50A×1000mm', 6.8]]],
      ['ボールバルブ 青銅 ねじ込み', '個', 2800, [['15A', 1], ['20A', 1.3], ['25A', 1.8], ['40A', 3.4], ['50A', 4.6]]],
      ['エアホース ウレタン 100m巻', '巻', 6800, [['6×4mm', 1], ['8×5mm', 1.3], ['10×6.5mm', 1.7], ['12×8mm', 2.2]]],
      ['油圧ホースアセンブリ 1000mm', '本', 5400, [['1/4', 1], ['3/8', 1.3], ['1/2', 1.7], ['3/4', 2.6]]],
      ['ホースバンド SUS 10個入', '袋', 650, [['12-22mm', 1], ['18-32mm', 1.2], ['26-38mm', 1.4], ['32-50mm', 1.7], ['50-70mm', 2.1]]],
      ['チーズ 白 ねじ込み', '個', 260, [['15A', 1], ['20A', 1.3], ['25A', 1.9], ['50A', 5.2]]],
      ['ゲートバルブ 青銅 10K', '個', 4800, [['15A', 1], ['25A', 1.6], ['40A', 2.9], ['50A', 3.8]]],
      ['フランジ SS400 10K', '枚', 1200, [['25A', 1], ['50A', 1.6], ['80A', 2.4], ['100A', 3.2], ['150A', 5.5]]],
    ] },
  { code: 'RS', name: '樹脂ペレット・樹脂素材', ratios: [68, 8, 16, 8], main: 'ナフサ', r1: 90, c: [400, 470], sup: ['S07', 'S08'], num: 14000, noCase: true,
    items: [
      ['PP ホモポリマー ペレット 25kg袋', '袋', 8200, [['ナチュラル MFR3', 1], ['ナチュラル MFR10', 1.02], ['ナチュラル MFR30', 1.05], ['黒 MFR10', 1.12], ['白 MFR10', 1.14]]],
      ['HDPE ペレット 25kg袋', '袋', 7900, [['射出用', 1], ['ブロー用', 1.04], ['フィルム用', 1.06]]],
      ['ABS樹脂 ペレット 25kg袋', '袋', 12600, [['一般 ナチュラル', 1], ['一般 黒', 1.06], ['難燃 グレー', 1.35], ['耐熱 ナチュラル', 1.28]]],
      ['POM コポリマー ペレット 25kg袋', '袋', 17800, [['ナチュラル', 1], ['黒', 1.05], ['摺動グレード', 1.32]]],
      ['ナイロン6 ペレット 25kg袋', '袋', 19800, [['ナチュラル', 1], ['GF30%', 1.22], ['黒 GF30%', 1.26]]],
      ['PC ペレット 25kg袋', '袋', 23800, [['透明 一般', 1], ['難燃 V-0', 1.3], ['光拡散', 1.42]]],
      ['マスターバッチ PP用 20kg袋', '袋', 26800, [['黒', 1], ['白', 1.15], ['青', 1.3], ['帯電防止', 1.6]]],
      ['アクリル板 透明 1100×1300', '枚', 5800, [['2mm', 1], ['3mm', 1.4], ['5mm', 2.2], ['10mm', 4.3]]],
      ['MCナイロン丸棒 1000mm', '本', 1800, [['φ20', 1], ['φ30', 2], ['φ50', 5.2], ['φ80', 13]]],
      ['PTFEシート 1000×1000', '枚', 14800, [['1mm', 1], ['2mm', 1.9], ['3mm', 2.8]]],
      ['PP 再生ペレット ばら', 'kg', 260, [['グレー', 1], ['黒', 0.95]]],
      ['PE パウダー ばら', 'kg', 420, [['LLDPE', 1], ['HDPE', 1.08]]],
      ['PVC コンパウンド 25kg袋', '袋', 9800, [['軟質 透明', 1], ['硬質 グレー', 0.92]]],
      ['ポリカーボネート板 透明 1000×2000', '枚', 9800, [['2mm', 1], ['3mm', 1.45], ['5mm', 2.3]]],
      ['塩ビ板 グレー 1000×2000', '枚', 6400, [['2mm', 1], ['3mm', 1.4], ['5mm', 2.2]]],
    ] },
  { code: 'SV', name: '工業用溶剤・洗浄剤', ratios: [62, 10, 18, 10], main: '石油化学品', r1: 0, c: [400, 480], sup: ['S09'], num: 15000,
    items: [
      ['イソプロピルアルコール 工業用', '缶', 5600, [['16kg缶', 1], ['3L缶', 0.32], ['180kgドラム', 9.6]]],
      ['炭化水素系洗浄剤', '缶', 8800, [['18L缶', 1], ['4L缶', 0.3], ['200Lドラム', 10.2]]],
      ['アルカリ洗浄剤 水系', '缶', 6400, [['20kg缶', 1], ['200kgドラム', 9]]],
      ['トルエン 工業用', '缶', 7200, [['16kg缶', 1], ['180kgドラム', 10.5]]],
      ['キシレン 工業用', '缶', 7400, [['16kg缶', 1], ['180kgドラム', 10.6]]],
      ['酢酸エチル 工業用', '缶', 8400, [['16kg缶', 1], ['180kgドラム', 10.4]]],
      ['アセトン 工業用', '缶', 7600, [['15kg缶', 1], ['3L缶', 0.3], ['160kgドラム', 10.1]]],
      ['ラッカーシンナー', '缶', 4800, [['16L缶', 1], ['4L缶', 0.3]]],
      ['パーツクリーナー 速乾 840ml 20本入', '箱', 7800, [['ノンフロン', 1], ['低臭タイプ', 1.12]]],
      ['エタノール 工業用 95%', '缶', 9800, [['15kg缶', 1], ['3L缶', 0.3]]],
      ['水置換形防錆洗浄剤', '缶', 12800, [['18L缶', 1], ['4L缶', 0.28], ['200Lドラム', 10.4]]],
      ['メタノール ばら', 'kg', 180, [['ローリー納品', 1]]],
      ['n-ヘキサン 工業用', '缶', 8200, [['16kg缶', 1], ['3L缶', 0.3]]],
      ['MEK 工業用', '缶', 8600, [['16kg缶', 1], ['180kgドラム', 10.3]]],
      ['不燃性洗浄剤 臭素系代替', '缶', 32800, [['18L缶', 1]]],
      ['電子部品用洗浄剤 フッ素系', '缶', 48000, [['15kg缶', 1], ['3kg缶', 0.24]]],
      ['グリコールエーテル系溶剤', '缶', 9800, [['16kg缶', 1], ['190kgドラム', 10.6]]],
      ['工業用 純水', '缶', 1800, [['20L缶', 1]]],
    ] },
  { code: 'LB', name: '潤滑油・グリース', ratios: [58, 12, 15, 15], main: '基油', r1: 80, c: [390, 470], sup: ['S10'], num: 16000,
    items: [
      ['ギヤーオイル', '缶', 9800, [['VG150 20L', 1], ['VG220 20L', 1.02], ['VG320 20L', 1.05], ['VG460 20L', 1.1], ['VG220 200Lドラム', 9.6]]],
      ['油圧作動油 耐摩耗性', '缶', 7800, [['VG32 20L', 1], ['VG46 20L', 1.02], ['VG68 20L', 1.05], ['VG46 200Lドラム', 9.4]]],
      ['リチウムグリース', '缶', 6800, [['No.1 16kg', 1], ['No.2 16kg', 1], ['No.2 2.5kg', 0.24]]],
      ['リチウムグリース カートリッジ 400g 20本入', '箱', 4200, [['No.1', 1], ['No.2', 1]]],
      ['ウレアグリース 耐熱', '缶', 14800, [['No.2 16kg', 1], ['No.2 2.5kg', 0.22]]],
      ['水溶性切削油', '缶', 8800, [['エマルション 18L', 1], ['ソリュブル 18L', 1.08], ['シンセティック 18L', 1.3], ['エマルション 200Lドラム', 10.2]]],
      ['不水溶性切削油', '缶', 7800, [['18L', 1], ['200Lドラム', 10]]],
      ['スプレー潤滑剤 420ml 24本入', '箱', 9800, [['浸透性', 1], ['PTFE配合', 1.35], ['食品機械用 H1', 1.6]]],
      ['真空ポンプ油', '缶', 6200, [['4L', 1], ['18L', 3.8]]],
      ['チェーンオイル 高温用', '缶', 16800, [['18L', 1], ['4L', 0.26]]],
      ['タービン油', '缶', 8400, [['VG32 20L', 1], ['VG68 20L', 1.04]]],
      ['摺動面油', '缶', 8600, [['VG68 20L', 1], ['VG220 20L', 1.05]]],
      ['コンプレッサー油', '缶', 9200, [['VG32 20L', 1], ['VG46 20L', 1.02], ['VG68 4L', 0.26]]],
      ['食品機械用グリース H1', '缶', 18800, [['No.2 16kg', 1], ['No.2 400g', 0.05]]],
      ['モリブデングリース', '缶', 12800, [['No.2 16kg', 1], ['No.2 2.5kg', 0.21]]],
      ['防錆油 溶剤希釈形', '缶', 7200, [['18L', 1], ['200Lドラム', 10.1]]],
    ] },
  { code: 'AD', name: '接着剤・シーリング材', ratios: [55, 17, 13, 15], main: '樹脂・溶剤', r1: 0, c: [470, 530], sup: ['S11'], num: 17000,
    items: [
      ['エポキシ接着剤 2液性', 'セット', 1450, [['速硬化 100g', 1], ['標準 500g', 3.6], ['耐熱 1kg', 8.2]]],
      ['瞬間接着剤 シアノアクリレート', '本', 480, [['20g', 1], ['50g', 2.1], ['500g', 16]]],
      ['嫌気性接着剤 ねじゆるみ止め', '本', 1650, [['中強度 50ml', 1], ['高強度 50ml', 1.08], ['中強度 250ml', 4.2]]],
      ['シリコーンシーラント 330ml 20本入', '箱', 8400, [['白', 1], ['グレー', 1], ['透明', 1.02], ['耐熱 赤', 1.6]]],
      ['変成シリコーンシーラント 2液', 'セット', 7800, [['4L', 1], ['6L', 1.4]]],
      ['ホットメルト接着剤 スティック', '箱', 6200, [['φ12 5kg', 1], ['φ7 1kg', 0.24]]],
      ['ウレタン系接着剤', '缶', 4800, [['1kg', 1], ['3kg', 2.7], ['15kg', 12.2]]],
      ['構造用アクリル接着剤 2液', 'セット', 3800, [['50ml', 1], ['400ml', 5.4]]],
      ['さび止め塗料', '缶', 5600, [['赤 16kg', 1], ['グレー 16kg', 1.03], ['グレー 4kg', 0.3]]],
      ['マーキングスプレー 12本入', '箱', 4600, [['黄', 1], ['白', 1], ['赤', 1]]],
      ['UV硬化接着剤', '本', 6800, [['低粘度 50g', 1], ['高粘度 50g', 1.05], ['低粘度 250g', 4.4]]],
      ['導電性接着剤 銀系', '本', 28000, [['10g', 1], ['50g', 4.4]]],
      ['ゴム系接着剤', '缶', 2800, [['1kg', 1], ['3kg', 2.6], ['15kg', 11.8]]],
      ['エポキシ塗料 2液', 'セット', 14800, [['グレー 16kg', 1], ['グリーン 16kg', 1.02]]],
      ['ポッティング材 ウレタン 2液', 'セット', 12800, [['1kgセット', 1], ['5kgセット', 4.6]]],
    ] },
  { code: 'AB', name: '研磨材・切削工具', ratios: [46, 24, 15, 15], main: '超硬合金・砥粒', r1: 50, c: [370, 460], sup: ['S12', 'S13'], num: 18000,
    items: [
      ['切断砥石 25枚入', '箱', 2600, [['105×1.0×15', 1], ['125×1.2×22', 1.4], ['180×1.6×22', 2.3], ['305×2.8×25.4', 5.6]]],
      ['オフセット研削砥石 10枚入', '箱', 2200, [['100×6×15 A24', 1], ['180×6×22 A36', 2.4]]],
      ['ジルコニア研磨ディスク 10枚入', '箱', 1400, [['#40 100mm', 1], ['#60 100mm', 1], ['#80 100mm', 1], ['#120 100mm', 1], ['#60 180mm', 2.3]]],
      ['超硬エンドミル 4枚刃', '本', 4800, [['φ3', 0.8], ['φ6', 1], ['φ8', 1.3], ['φ10', 1.7], ['φ12', 2.3], ['φ16', 3.9]]],
      ['ハイスドリル ストレート 10本入', '箱', 1500, [['φ3.0', 1], ['φ5.0', 1.4], ['φ6.5', 1.9], ['φ8.5', 2.8]]],
      ['スローアウェイチップ CNMG120408 10個入', '箱', 9800, [['鋼用', 1], ['ステンレス用', 1.08], ['鋳鉄用', 1.02]]],
      ['耐水ペーパー 100枚入', '袋', 2400, [['#240', 1], ['#400', 1], ['#800', 1], ['#1500', 1.05]]],
      ['バイメタルバンドソー', '本', 3800, [['1640mm', 1], ['2480mm', 1.4], ['3505mm', 2.1]]],
      ['ダイヤモンドカッター 乾式', '枚', 3900, [['105mm', 1], ['180mm', 2.6], ['305mm', 6.4]]],
      ['タップ スパイラル', '本', 1300, [['M5', 1], ['M6', 1.05], ['M8', 1.2], ['M10', 1.45], ['M12', 1.8]]],
      ['フラップディスク 10枚入', '箱', 3600, [['#40', 1], ['#60', 1], ['#80', 1]]],
      ['ワイヤーブラシ カップ形', '個', 980, [['75mm', 1], ['100mm', 1.5]]],
      ['ドリルチャック 精密', '個', 8800, [['13mm', 1], ['16mm', 1.25]]],
    ] },
];
const CAT_BY = new Map(CATS.map((c) => [c.code, c]));
const R1_CATS = new Set(CATS.filter((c) => c.r1 > 0).map((c) => c.code));
const CASEABLE = new Set(['箱', '袋', '個', '本', '枚', '巻']);
const SUPPLIERS = [
  ['S01', '霧ヶ峰鋲螺工業株式会社', 'FS'], ['S02', '星降ねじ製作所株式会社', 'FS'], ['S03', '銀河軸受工業株式会社', 'BR'], ['S04', '朧月伝動機株式会社', 'BR'],
  ['S05', '雪花ゴム化工株式会社', 'SL'], ['S06', '潮騒ホース工業株式会社', 'HP'], ['S07', '琥珀樹脂化学株式会社', 'RS'], ['S08', '瑠璃色ポリマー株式会社', 'RS'],
  ['S09', '夕凪ソルベント株式会社', 'SV'], ['S10', '春霞油化株式会社', 'LB'], ['S11', '蛍火ケミカル株式会社', 'AD'], ['S12', '天鵞絨研磨工業株式会社', 'AB'],
  ['S13', '藍染坂ツール株式会社', 'AB'], ['S14', '白夜バルブ製作所株式会社', 'HP'],
];

function jitterRatios(base, rng) {
  const r = base.map((v) => Math.max(3, v + rng.int(-4, 4)));
  const diff = 100 - r.reduce((a, b) => a + b, 0);
  r[0] += diff;
  return r;
}
function pushHist(arr, from, obj) {
  const last = arr[arr.length - 1];
  if (from <= last.from) throw new Error('history order');
  last.to = addDays(from, -1);
  arr.push({ ...obj, from, to: null });
}
const entryAt = (arr, iso) => arr.find((e) => e.from <= iso && (e.to === null || iso <= e.to)) || null;

// ---------------------------------------------------------------- 商品
const PRODUCTS = [];
{
  const rng = R('products');
  for (const cat of CATS) {
    const combos = [];
    for (const [base, unit, price, specs] of cat.items) {
      for (const [spec, mult] of specs) {
        combos.push({ base, unit, price, spec, mult: Math.round(mult * 1000) });
        if (!cat.noCase && CASEABLE.has(unit) && rng.chance(0.6)) combos.push({ base, unit: 'ケース', price, spec: `${spec} 10${unit}ケース`, mult: Math.round(mult * 9600) });
      }
    }
    let num = cat.num;
    for (const k of combos) {
      num += rng.chance(0.12) ? 2 : 1;
      let unit = k.unit;
      let suffix = '';
      if (k.spec.includes('ドラム')) {
        unit = 'ドラム';
        suffix = 'D';
      }
      if (unit === 'kg') suffix = 'K';
      const code = `${cat.code}-${num}${suffix}`;
      const listPrice = ceilList(k.price * k.mult * rng.int(950, 1100), 1_000_000);
      const cost = roundTo90(listPrice * rng.int(cat.c[0], cat.c[1]), 10);
      PRODUCTS.push({ code, key: normProd(code), name: `${k.base} ${k.spec}`, cat: cat.code, unit, supplier: rng.pick(cat.sup), ratios: jitterRatios(cat.ratios, rng), launch: '2023-04-01', baseList: listPrice, baseCost: cost, pop: rng.int(1, 10) });
    }
  }
  // 発売日：期間中の新商品（改定前・改定後）
  for (const p of rng.sample(PRODUCTS, 12)) p.launch = '2024-11-01';
  const lateCands = PRODUCTS.filter((p) => p.launch === '2023-04-01' && ['FS', 'LB', 'AD', 'SV', 'HP'].includes(p.cat));
  for (const p of rng.sample(lateCands, 10)) p.launch = '2025-11-01';
  for (const p of PRODUCTS) {
    p.list = [{ price: p.baseList, from: p.launch, to: null }];
    p.cost = [{ sen: p.baseCost, from: p.launch, to: null }];
  }
  const incCost = (p, from, permil) => pushHist(p.cost, from, { sen: roundTo90(p.cost[p.cost.length - 1].sen * (1000 + permil), 1000) });
  const incList = (p, from, permil) => {
    const old = p.list[p.list.length - 1].price;
    let nw = ceilList(old * (1000 + permil), 1000);
    if (permil > 0 && nw <= old) nw = old + listUnit(old);
    pushHist(p.list, from, { price: nw });
  };
  // R0：研磨材だけの小改定（2024年10月1日）
  for (const p of PRODUCTS.filter((x) => x.cat === 'AB' && x.launch < R0_COST)) incCost(p, R0_COST, 20);
  for (const p of PRODUCTS.filter((x) => x.cat === 'AB' && x.launch < R0)) incList(p, R0, 30);
  // R1：前回改定（2025年6月16日）。約1割は据え置き
  for (const p of PRODUCTS.filter((x) => R1_CATS.has(x.cat) && x.launch < R1)) {
    const cat = CAT_BY.get(p.cat);
    if (rng.chance(0.1)) {
      incCost(p, R1_COST, 10);
      p.r1 = false;
      continue;
    }
    const r = cat.r1 + rng.int(-10, 20);
    incCost(p, R1_COST, r - 15);
    incList(p, R1, r);
    p.r1 = true;
  }
  // 定価の値下げ（シール4品目）
  const cutCands = PRODUCTS.filter((x) => x.cat === 'SL' && x.launch < '2024-01-01' && x.unit !== 'ケース').sort((a, b) => b.pop - a.pop);
  for (const p of cutCands.slice(0, 4)) {
    incCost(p, CUT_COST, -60);
    const old = p.list[p.list.length - 1].price;
    let nw = ceilList(old * 920, 1000);
    if (nw >= old) nw = old - listUnit(old);
    pushHist(p.list, CUT, { price: nw });
    p.cut = true;
  }
  // 2026年2月の仕入値上げと R2
  const rs2 = rng.sample(PRODUCTS.filter((x) => x.cat === 'RS' && x.r1 && x.launch < '2024-01-01'), 12);
  for (const p of PRODUCTS) {
    if (p.cat === 'AD') incCost(p, AD_COST, 120);
    if (p.cat === 'SV' && p.launch < R2_COST) incCost(p, R2_COST, 50);
  }
  for (const p of rs2) {
    incCost(p, RS2_COST, 35);
    p.rs2 = true;
  }
  for (const p of PRODUCTS.filter((x) => x.cat === 'SV' && x.launch < R2)) {
    incList(p, R2, 60 + rng.int(-10, 10));
    p.r2 = true;
  }
  for (const p of rs2) {
    incList(p, R2, 40);
    p.r2 = true;
  }
}
const PROD = new Map(PRODUCTS.map((p) => [p.code, p]));
const PROD_BY_CAT = new Map(CATS.map((c) => [c.code, PRODUCTS.filter((p) => p.cat === c.code)]));
const postR1Change = (p) => p.list.some((e) => e.from > R1);
// 販売管理の商品マスタの定価が改定後も旧定価のままだった商品（全得意先で旧単価）
const STALE = { codes: [], to: '2025-07-10' };
{
  const rng = R('stale');
  for (const cat of ['FS', 'HP', 'LB']) {
    const cands = PROD_BY_CAT.get(cat).filter((p) => p.r1 && p.launch === '2023-04-01' && !p.rs2).sort((a, b) => b.pop - a.pop || (a.code < b.code ? -1 : 1));
    STALE.codes.push(cands[rng.int(0, 2)].code);
  }
}
// 商品マスタにないコード
const NON_PRODUCTS = {
  9999: { name: '運賃', unit: '式' },
  9998: { name: '小口割増料', unit: '式' },
  'FS-10990': { name: '蝶ボルト SUS304 M6×15 100本入', unit: '箱' },
  'LB-16990': { name: 'マシン油 VG10 20L', unit: '缶' },
};

// ================================================================ 掛率ランク・得意先（架空）
const TIERS = {
  S: { name: '特約店・販売店', std: 620, lo: 600, hi: 640, note: '再販する取引先' },
  A: { name: '重点ユーザー', std: 700, lo: 680, hi: 720, note: '年間取引額の大きい直需' },
  B: { name: '一般ユーザー', std: 780, lo: 760, hi: 800, note: '定期的に取引のある直需' },
  C: { name: '小口ユーザー', std: 860, lo: 840, hi: 880, note: '取引額の小さい直需' },
  D: { name: 'スポット', std: 950, lo: 920, hi: 1000, note: '不定期・新規の取引先' },
};
const rep = (r, n) => Array(n).fill(r);
const TYPES = [
  { type: '特約店・販売店', ranks: rep('S', 16), words: ['産機販売', '機工商会', '工業資材', 'ツール商事', '機材センター', '産業', '商工'], cats: { FS: 3, BR: 3, SL: 2, HP: 3, RS: 2, SV: 2, LB: 3, AD: 2, AB: 3 }, dept: '仕入部' },
  { type: '自動車部品製造', ranks: [...rep('A', 8), ...rep('B', 8)], words: ['精工', 'オートパーツ', '鍛造', 'プレス工業', '精機'], cats: { FS: 3, BR: 3, LB: 3, AB: 3, SV: 2, HP: 1, SL: 1, AD: 1 }, dept: '購買部' },
  { type: '電機・電子', ranks: [...rep('A', 4), ...rep('B', 6), ...rep('C', 4)], words: ['電子', '電機', 'エレクトロニクス', 'デバイス'], cats: { AD: 4, SV: 3, RS: 2, FS: 2, SL: 1, LB: 1 }, dept: '資材部' },
  { type: '食品・化粧品製造', ranks: [...rep('B', 6), ...rep('C', 6)], words: ['食品工業', '化粧品', '製菓', '醸造'], cats: { SL: 3, HP: 3, LB: 2, SV: 2, AD: 1 }, dept: '工務部' },
  { type: '設備工事・メンテナンス', ranks: [...rep('B', 6), ...rep('C', 8), ...rep('D', 4)], words: ['設備', 'プラント工事', 'メンテナンス', '管工業'], cats: { HP: 4, SL: 3, FS: 3, AD: 2, BR: 2, LB: 1 }, dept: '工事部' },
  { type: '金属加工', ranks: [...rep('A', 3), ...rep('B', 6), ...rep('C', 5), ...rep('D', 2)], words: ['金属工業', '製作所', '鉄工所', 'メッキ工業'], cats: { AB: 4, LB: 3, FS: 2, SV: 2, HP: 1 }, dept: '購買部' },
  { type: '樹脂成形', ranks: [...rep('A', 5), ...rep('B', 6), ...rep('C', 5)], words: ['化成', '樹脂工業', 'プラスチック', 'モールド'], cats: { RS: 5, LB: 2, SV: 2, AD: 1, BR: 1 }, dept: '資材部' },
  { type: '研究機関・試験所', ranks: [...rep('C', 2), ...rep('D', 4)], words: ['技術研究所', '分析センター'], cats: { SV: 4, AD: 2, RS: 1, SL: 1 }, dept: '総務部' },
  { type: 'その他', ranks: rep('D', 6), words: ['商店', '工房'], cats: { FS: 2, AD: 2, AB: 2, SV: 1 }, dept: '総務部' },
];
const TYPE_BY = new Map(TYPES.map((t) => [t.type, t]));
const PREFIXES = ['月虹', '星屑', '雲母', '霧笛', '銀河坂', '夢見台', '蛍火', '虹ヶ丘', '朧月', '翡翠沢', '琥珀台', '瑠璃浜', '珊瑚岬', '暁星', '流星', '彗星', '風見', '鈴鳴', '花筏', '綿雲', '春霞', '雪花', '玻璃', '狐火', '竜胆', '若葉台', '潮騒', '東雲', '星見', '藍染坂', '時雨', '茜雲', '桜貝', '水鏡', '月見坂', '紫苑', '柚子平', '碧海', '真珠台', '虹彩', '万華鏡', '宵闇', '陽炎', '鈴蘭', '小春日', '鳴神', '綾錦', '初霜', '若竹', '雲雀丘', '山彦', '木霊', '白鷺洲', '蓬莱', '極光', '星雲', '銀杏坂', '梟森', '鶺鴒', '翠玉', '黄昏', '海蛍', '風花', '銀砂', '金糸雀', '七色', '月白', '藤波', '葵坂', '雷鳥', '氷室', '彩雲', '鏡池', '羅針', '砂時計', '夢幻', '空蝉', '天河', '望月', '星宿'];
const PREF_DEPT = [['東京都', '本社営業部', 4], ['神奈川県', '本社営業部', 3], ['埼玉県', '本社営業部', 2], ['千葉県', '本社営業部', 1], ['群馬県', '北関東営業所', 2], ['栃木県', '北関東営業所', 2], ['茨城県', '北関東営業所', 1], ['福岡県', '九州営業所', 3], ['熊本県', '九州営業所', 1], ['佐賀県', '九州営業所', 1], ['大分県', '九州営業所', 1]];
const REPS = { 本社営業部: ['中村', '小林', '加藤', '吉田'], 北関東営業所: ['山口', '松本'], 九州営業所: ['井上', '木村', '林'] };
const DEPT_NUM = { 本社営業部: 31000, 北関東営業所: 32000, 九州営業所: 33000 };
const FREQ = { S: 7, A: 5, B: 3, C: 1.6, D: 0.8 };
const MAXLINES = { S: 5, A: 4, B: 3, C: 3, D: 2 };
const BASKET = { S: [40, 60], A: [25, 40], B: [14, 26], C: [7, 15], D: [4, 9] };
const SIZEF = { S: 2000, A: 1500, B: 1000, C: 650, D: 500 };

const CUSTOMERS = [];
{
  const rng = R('customers');
  const used = new Set();
  const seq = { ...DEPT_NUM };
  let pi = 0;
  const prefixes = rng.shuffle(PREFIXES);
  for (const t of TYPES) {
    for (const rank of t.ranks) {
      let core;
      do {
        core = prefixes[pi % prefixes.length] + rng.pick(t.words);
        pi++;
      } while (used.has(core));
      used.add(core);
      const form = rng.next();
      let name;
      let short;
      if (form < 0.55) [name, short] = [`株式会社${core}`, `(株)${core}`];
      else if (form < 0.85) [name, short] = [`${core}株式会社`, `${core}(株)`];
      else if (form < 0.95) [name, short] = [`有限会社${core}`, `(有)${core}`];
      else [name, short] = [`合同会社${core}`, `(同)${core}`];
      const [pref, dept] = rng.weighted(PREF_DEPT, (x) => x[2]);
      seq[dept] += rng.int(1, 3);
      const code = String(seq[dept]).padStart(6, '0');
      const T = TIERS[rank];
      let rate = T.std + rng.pick([-20, -15, -10, -5, 0, 0, 5, 10, 15, 20]) + (rng.chance(0.15) ? rng.int(-4, 4) : 0);
      rate = Math.min(T.hi, Math.max(T.lo, rate));
      const start = fromDays(rng.int(toDays('2006-04-01'), toDays('2023-12-20')));
      CUSTOMERS.push({ code, key: normCust(code), name, short, type: t.type, rank, rate, dept, rep: rng.pick(REPS[dept]), pref, closing: rng.pick(['15日', '20日', '25日', '末日', '末日']), toDept: t.dept, start, activeFrom: START, activeTo: END, freq: FREQ[rank] * (rng.int(700, 1300) / 1000), roles: new Set() });
    }
  }
  CUSTOMERS.sort((a, b) => (a.code < b.code ? -1 : 1));
}
const CUST = new Map(CUSTOMERS.map((c) => [c.code, c]));

// ---------------------------------------------------------------- 役割（どの得意先に何が起きるか）
const AG = new Map(); // 前回改定の合意状況 code -> {status, date, excluded:[], note, applied, answered}
{
  const rng = R('roles');
  const free = () => CUSTOMERS.filter((c) => c.roles.size === 0);
  const take = (n, pred, role) => {
    const got = rng.sample(free().filter(pred), n);
    if (got.length < n) throw new Error(`role ${role}`);
    for (const c of got) c.roles.add(role);
    return got;
  };
  for (const c of take(6, (c) => ['C', 'D'].includes(c.rank), 'NOHIST')) {
    if (rng.chance(0.5)) c.start = fromDays(rng.int(toDays('2026-04-01'), toDays('2026-06-20')));
  }
  const newStarts = ['2025-06-20', '2025-07-07', '2025-08-18', '2025-10-01', '2025-11-17', '2026-01-13', '2026-02-02', '2026-04-06'];
  take(8, (c) => ['B', 'C', 'D'].includes(c.rank), 'NEW').forEach((c, i) => {
    c.start = newStarts[i];
    c.activeFrom = newStarts[i];
  });
  const stops = ['2025-02-28', '2025-04-30', '2025-09-30', '2025-12-15', '2026-02-27'];
  take(5, (c) => ['B', 'C'].includes(c.rank), 'STOPPED').forEach((c, i) => {
    c.activeTo = stops[i];
  });
  take(1, (c) => c.rank === 'B' && c.type !== '研究機関・試験所', 'OLD_WIDE_ONGOING');
  take(1, (c) => c.rank === 'A', 'OLD_WIDE_FIXED');
  take(1, (c) => c.rank === 'B', 'TIER_WIDE');
  take(1, (c) => c.rank === 'S', 'TIER_FROM');
  take(1, (c) => ['A', 'B'].includes(c.rank) && TYPE_BY.get(c.type).cats.SV, 'R2_SV_FIXED');
  take(1, (c) => ['A', 'B'].includes(c.rank) && TYPE_BY.get(c.type).cats.SV, 'R2_SV_ONGOING');
  take(4, (c) => ['B', 'C'].includes(c.rank) && c.type !== '特約店・販売店', 'DECLINED');
  take(1, (c) => c.rank === 'A', 'DECLINED');
  take(2, (c) => ['B', 'C'].includes(c.rank) && TYPE_BY.get(c.type).cats.SV, 'DECLINED_SV');
  take(1, (c) => c.rank === 'C', 'DECLINED_ALT');
  take(12, (c) => ['S', 'A', 'B'].includes(c.rank), 'PARTIAL');
  take(2, (c) => ['A', 'B'].includes(c.rank), 'PARTIAL_DEFER');
  take(7, (c) => ['S', 'A', 'B', 'C'].includes(c.rank), 'DEFERRED');
  take(1, (c) => c.rank === 'C', 'NO_AGREEMENT');
  const deferDates = ['2025-08-01', '2025-07-01', '2025-07-01', '2025-07-21', '2025-08-01', '2025-09-16', '2025-10-01'];
  CUSTOMERS.filter((c) => c.roles.has('DEFERRED')).forEach((c, i) => {
    c.deferDate = deferDates[i];
    if (i === 0) c.roles.add('DEFER_OVERRUN');
  });
  const pdDates = ['2025-08-01', '2025-09-01'];
  CUSTOMERS.filter((c) => c.roles.has('PARTIAL_DEFER')).forEach((c, i) => {
    c.deferDate = pdDates[i];
  });
  const exclOpts = ['RS', 'LB', 'FS;BR', 'HP;LB', 'AB', 'RS;LB;AB', 'BR', 'FS', 'LB;AB', 'HP', 'RS;HP', 'FS;LB'];
  for (const c of CUSTOMERS) {
    if (c.roles.has('PARTIAL') || c.roles.has('PARTIAL_DEFER')) {
      const cats = TYPE_BY.get(c.type).cats;
      const opts = exclOpts.filter((o) => o.split(';').some((x) => cats[x]));
      c.excluded = rng.pick(opts).split(';');
    }
  }
  // 名前が途中で変わった得意先（A形式の古い行は旧社名）
  const ren = rng.pick(CUSTOMERS.filter((c) => c.roles.size === 0 && c.name.startsWith('株式会社')));
  ren.oldName = `${ren.name.replace('株式会社', '')}製作所株式会社`;
  ren.renamed = '2025-04-01';
  // 合意状況
  const CAT_NAMES = (xs) => xs.map((x) => CAT_BY.get(x).name).join('・');
  for (const c of CUSTOMERS) {
    if (c.roles.has('NO_AGREEMENT')) continue;
    if (c.activeTo < R1) continue; // 改定前に取引をやめた
    const applied = fromDays(rng.int(toDays('2025-03-03'), toDays('2025-04-18')));
    const answered = fromDays(toDays(applied) + rng.int(14, 50));
    if (c.start >= R1) {
      if (c.roles.has('NOHIST') && rng.chance(0.5)) continue;
      AG.set(c.code, { status: '対象外(改定後に取引開始)', date: '', excluded: [], note: '', applied: '', answered: '' });
    } else if (c.roles.has('DECLINED') || c.roles.has('DECLINED_SV')) AG.set(c.code, { status: '見送り', date: '', excluded: [], note: '据え置き要請（次回改定時に再協議）', applied, answered });
    else if (c.roles.has('DECLINED_ALT')) AG.set(c.code, { status: '合意に至らず', date: '', excluded: [], note: '先方予算の都合', applied, answered });
    else if (c.roles.has('PARTIAL')) AG.set(c.code, { status: '一部合意', date: R1, excluded: c.excluded, note: `${CAT_NAMES(c.excluded)}は据え置き`, applied, answered });
    else if (c.roles.has('PARTIAL_DEFER')) AG.set(c.code, { status: '一部合意', date: c.deferDate, excluded: c.excluded, note: `${CAT_NAMES(c.excluded)}は据え置き。適用日は${+c.deferDate.slice(5, 7)}月${+c.deferDate.slice(8, 10)}日から`, applied, answered });
    else if (c.roles.has('DEFERRED')) {
      const i = CUSTOMERS.filter((x) => x.roles.has('DEFERRED')).indexOf(c);
      AG.set(c.code, { status: i === 3 || i === 5 ? '適用日変更' : '合意', date: c.deferDate, excluded: [], note: `決算期の関係で${+c.deferDate.slice(5, 7)}月${+c.deferDate.slice(8, 10)}日から`, applied, answered });
    } else if (c.roles.has('NOHIST') && rng.chance(0.5)) continue;
    else AG.set(c.code, { status: '合意', date: R1, excluded: [], note: '', applied, answered });
  }
}
const isDeclined = (c) => c.roles.has('DECLINED') || c.roles.has('DECLINED_SV') || c.roles.has('DECLINED_ALT');
const isPartial = (c) => c.roles.has('PARTIAL') || c.roles.has('PARTIAL_DEFER');

// ---------------------------------------------------------------- 得意先ごとのよく買う商品
const LATE_FOR_DECLINED = PRODUCTS.find((p) => p.launch === '2025-11-01' && R1_CATS.has(p.cat));
{
  const rng = R('baskets');
  const amberDeclined = CUSTOMERS.find((c) => c.roles.has('DECLINED') && c.rank !== 'A');
  amberDeclined.roles.add('AMB_NEWPROD');
  for (const c of CUSTOMERS) {
    const T = TYPE_BY.get(c.type);
    const allowed = (p) => {
      if (isDeclined(c)) {
        if (p.launch >= R1 && !(c.roles.has('AMB_NEWPROD') && p === LATE_FOR_DECLINED)) return false;
        if (p.cut || p.rs2) return false;
        if (p.cat === 'SV' && !c.roles.has('DECLINED_SV')) return false;
      }
      if (isPartial(c) && c.excluded.includes(p.cat)) {
        if (p.launch >= R1 || p.rs2) return false;
      }
      return true;
    };
    const chosen = new Map();
    const size = rng.int(...BASKET[c.rank]);
    const catKeys = Object.keys(T.cats);
    let guard = 0;
    while (chosen.size < size && guard++ < 3000) {
      const cat = rng.weighted(catKeys, (k) => T.cats[k]);
      const cands = PROD_BY_CAT.get(cat).filter((p) => !chosen.has(p.code) && allowed(p));
      if (!cands.length) continue;
      const p = rng.weighted(cands, (x) => x.pop);
      chosen.set(p.code, { p, w: rng.int(1, 10) });
    }
    const ensure = (pred, n) => {
      const have = [...chosen.values()].filter((x) => pred(x.p)).length;
      const cands = rng.shuffle(PRODUCTS.filter((p) => pred(p) && !chosen.has(p.code) && allowed(p)));
      for (let i = 0; i < n - have && i < cands.length; i++) chosen.set(cands[i].code, { p: cands[i], w: rng.int(6, 10) });
    };
    if (c.roles.has('R2_SV_FIXED') || c.roles.has('R2_SV_ONGOING') || c.roles.has('DECLINED_SV')) ensure((p) => p.cat === 'SV' && p.unit !== 'ドラム' && p.launch < '2024-01-01', 4);
    if (c.roles.has('TIER_FROM') || c.rank === 'S') ensure((p) => p.cat === 'AD' && p.launch < '2024-01-01', 4);
    if (c.roles.has('AMB_NEWPROD')) chosen.set(LATE_FOR_DECLINED.code, { p: LATE_FOR_DECLINED, w: 10 });
    if (c.roles.has('OLD_WIDE_ONGOING') || c.roles.has('OLD_WIDE_FIXED')) ensure((p) => p.r1 && p.launch < '2024-01-01', 10);
    c.basket = [...chosen.values()].sort((a, b) => (a.p.code < b.p.code ? -1 : 1));
  }
}

// ================================================================ 特値（期間つき）
const SPECIALS = []; // {cust, prod, price, from, to|null, reason, tag}
const specialsOf = (cc, pc) => SPECIALS.filter((s) => s.cust === cc && s.prod === pc);
function specialAtG(cc, pc, iso) {
  return SPECIALS.find((s) => s.cust === cc && s.prod === pc && s.from <= iso && (s.to === null || iso <= s.to)) || null;
}
// ================================================================ 正しい単価（文書のルール）
// W: {products: Map key->{cat, list[], cost[]}, customers: Map key->{rank, rate, start}, tiers, agreements, specials: Map 'c|p'->[], r1}
const DECLINED_STATUSES = new Set(['見送り', '合意に至らず', '未合意']);
function applicable(W, ck, pk, iso) {
  const P = W.products.get(pk);
  const reg = entryAt(P.list, iso);
  if (!reg) return { amb: 'AMB_PRODUCT_NOT_LISTED_ON_DATE', reg: null, entry: null };
  const res = { reg, entry: reg, list: reg.price, reason: 'normal', amb: null, held: null };
  if (iso < W.r1) return res;
  const C = W.customers.get(ck);
  const ag = W.agreements.get(ck);
  const changedAtR1 = P.list.some((e) => e.from === W.r1);
  if (!ag) {
    if (C.start < W.r1 && changedAtR1) res.amb = 'AMB_NO_AGREEMENT_ROW';
    return res;
  }
  if (ag.status.startsWith('対象外')) return res;
  const declined = DECLINED_STATUSES.has(ag.status);
  const excluded = ag.status === '一部合意' && ag.excluded.includes(P.cat);
  const deferred = !declined && ag.date && ag.date > W.r1 && iso < ag.date;
  if (!(declined || excluded || deferred)) return res;
  const pre = entryAt(P.list, addDays(W.r1, -1));
  if (!pre) {
    res.amb = 'AMB_HELD_PRICE_BUT_NO_LIST_BEFORE_REVISION';
    return res;
  }
  if (P.list.some((e) => e.from > W.r1 && e.from <= iso)) {
    res.amb = 'AMB_HELD_PRICE_AND_LATER_LIST_CHANGE';
    res.held = pre;
    return res;
  }
  return { reg, entry: pre, list: pre.price, reason: !changedAtR1 ? 'normal' : declined ? 'declined' : excluded ? 'excluded' : 'deferred', amb: null, held: pre };
}
const specialAtW = (W, ck, pk, iso) => (W.specials.get(`${ck}|${pk}`) || []).find((s) => s.from <= iso && (s.to === null || iso <= s.to)) || null;
const DISC_RE = /(?:数量値引|まとめ買い)\s*(\d+(?:\.\d+)?)\s*%/;
function classify(W, L) {
  const out = { label: '', pattern: '', reference: '', refKind: '', shortfall: 0, belowFloor: '', floorPrice: '' };
  const P = W.products.get(L.prod);
  if (!P) return { ...out, label: 'ok_non_product' };
  if (L.qty < 0) return { ...out, label: 'ok_return' };
  const note = (L.note || '').normalize('NFKC');
  if (L.price === 0) {
    if (/見本|サンプル/.test(note)) return { ...out, label: 'ok_sample' };
    return { ...out, label: 'ambiguous', pattern: 'AMB_ZERO_PRICE_WITHOUT_SAMPLE_NOTE' };
  }
  const C = W.customers.get(L.cust);
  if (!C) return { ...out, label: 'ambiguous', pattern: 'AMB_CUSTOMER_NOT_IN_MASTER' };
  const app = applicable(W, L.cust, L.prod, L.date);
  const sp = specialAtW(W, L.cust, L.prod, L.date);
  if (app.amb) {
    // 定価が決まらなくても、期間内の特値どおり（または特値からの数量値引）なら定価は関係ない
    const dm0 = note.match(DISC_RE);
    const spOk = sp && (L.price === sp.price || (dm0 && !dm0[1].includes('.') && L.price === Math.floor((sp.price * (100 - +dm0[1])) / 100)));
    if (!spOk) return { ...out, label: 'ambiguous', pattern: app.amb };
  }
  const correct = sp ? sp.price : Math.floor((app.list * C.rate) / 1000);
  const cost = entryAt(P.cost, L.date).sen;
  const floorPrice = Math.ceil(cost / 90);
  const below = L.price * 90 < cost;
  Object.assign(out, { reference: correct, refKind: sp ? 'special' : 'list_x_rate', belowFloor: below ? 1 : 0, floorPrice });
  if (L.price === correct) {
    if (below) return { ...out, label: 'leak_below_margin_floor', shortfall: (floorPrice - L.price) * L.qty };
    const label = sp ? 'ok_special' : app.reason === 'deferred' ? 'ok_deferred' : app.reason === 'declined' || app.reason === 'excluded' ? 'ok_declined' : 'ok';
    return { ...out, label };
  }
  const dm = note.match(DISC_RE);
  if (dm) {
    if (dm[1].includes('.')) return { ...out, label: 'ambiguous', pattern: 'AMB_DECIMAL_DISCOUNT_RATE' };
    if (L.price === Math.floor((correct * (100 - +dm[1])) / 100)) {
      if (below) return { ...out, label: 'ambiguous', pattern: 'AMB_VOLUME_DISCOUNT_BELOW_FLOOR' };
      return { ...out, label: 'ok_volume_discount' };
    }
  }
  const shortfall = (correct - L.price) * L.qty;
  for (const e of P.list) {
    if (e.to !== null && e.to < app.entry.from && L.price === Math.floor((e.price * C.rate) / 1000)) {
      if (sp) return { ...out, label: 'ambiguous', pattern: 'AMB_OLD_LIST_PRICE_WHILE_SPECIAL_ACTIVE' };
      if (e.price < app.list) return { ...out, label: 'leak_old_price', shortfall };
      return { ...out, label: 'ambiguous', pattern: 'AMB_OLD_LIST_HIGHER_AFTER_PRICE_CUT' };
    }
  }
  for (const s of W.specials.get(`${L.cust}|${L.prod}`) || []) {
    if (s.to !== null && s.to < L.date && L.price === s.price) {
      if (shortfall < 0) return { ...out, label: 'ambiguous', pattern: 'AMB_EXPIRED_SPECIAL_ABOVE_REFERENCE' };
      return { ...out, label: 'leak_expired_special', shortfall };
    }
  }
  const T = W.tiers.get(C.rank);
  const lo = Math.floor((app.list * T.lo) / 1000);
  const hi = Math.floor((app.list * T.hi) / 1000);
  if (L.price < lo || L.price > hi) return { ...out, label: 'leak_rate_out_of_tier', shortfall };
  return { ...out, label: 'ambiguous', pattern: 'AMB_UNEXPLAINED_PRICE_INSIDE_TIER' };
}
function buildWorldFromInternal() {
  const specials = new Map();
  for (const s of SPECIALS) {
    const k = `${CUST.get(s.cust).key}|${PROD.get(s.prod).key}`;
    if (!specials.has(k)) specials.set(k, []);
    specials.get(k).push({ price: s.price, from: s.from, to: s.to });
  }
  const agreements = new Map();
  for (const [code, a] of AG) agreements.set(normCust(code), { status: a.status, date: a.date || null, excluded: a.excluded });
  return {
    products: new Map(PRODUCTS.map((p) => [p.key, { cat: p.cat, list: p.list, cost: p.cost }])),
    customers: new Map(CUSTOMERS.map((c) => [c.key, { rank: c.rank, rate: c.rate, start: c.start }])),
    tiers: new Map(Object.entries(TIERS)),
    agreements,
    specials,
    r1: R1,
  };
}

// ---------------------------------------------------------------- 特値をつくる
const LEAK = {
  oldCust: new Map(), // code -> {from, to, rev}
  oldPair: new Map(), // key -> {from, to, rev}
  r2Cust: new Map(), // code -> {from, to}
  expired: new Map(), // key -> {to, chain}
  manual: new Map(), // key -> {from, to, kind, d}
  wrongRate: new Map(), // code -> {from, to, rate}
  early: new Map(), // key -> {from, to, price}
};
const pairKey = (cc, pc) => `${cc}|${pc}`;
const inRange = (r, iso) => r && r.from <= iso && iso <= r.to;
{
  const rng = R('specials');
  const W0 = { r1: R1 };
  const priceAt = (c, p, iso) => {
    const e = entryAt(p.list, maxD(iso, p.launch)) || p.list[0];
    return Math.floor((e.price * c.rate) / 1000);
  };
  const mk = (c, p, from, to, factor, reason, tag) => {
    const price = floorTo10(Math.floor((priceAt(c, p, from) * factor) / 1000));
    const s = { cust: c.code, prod: p.code, price, from, to, reason, tag };
    SPECIALS.push(s);
    return s;
  };
  const TEMPL = [
    ['2024-04-01', '2025-03-31'], ['2025-04-01', '2026-03-31'], ['2024-10-01', '2025-09-30'], ['2025-01-01', '2025-12-31'], ['2025-08-16', '2026-02-15'],
    ['2026-02-01', '2026-04-30'], ['2025-07-01', null], ['2023-10-01', '2024-09-30'], ['2025-11-01', '2026-10-31'], ['2024-07-01', '2025-06-30'], ['2026-01-01', '2026-12-31'],
  ];
  const REASONS = ['新規獲得', '大口継続', '競合対策', '年間契約', '量産立上げ', '物件特値'];
  const elig = CUSTOMERS.filter((c) => ['S', 'A', 'B'].includes(c.rank) && !c.roles.has('NOHIST') && !c.roles.has('TIER_WIDE') && !c.roles.has('TIER_FROM') && !c.roles.has('NO_AGREEMENT') && !c.roles.has('OLD_WIDE_ONGOING') && !c.roles.has('OLD_WIDE_FIXED'));
  const chosen = rng.sample(elig, 34);
  const used = new Set();
  const avail = (c, extra = () => true) => c.basket.filter((b) => !used.has(pairKey(c.code, b.p.code)) && b.p.launch < '2024-01-01' && extra(b.p)).sort((a, b) => b.w - a.w || (a.p.code < b.p.code ? -1 : 1));
  for (const c of chosen) {
    const n = rng.int(1, 4);
    const cands = avail(c).slice(0, 8);
    for (const b of rng.sample(cands, n)) {
      used.add(pairKey(c.code, b.p.code));
      let [from, to] = rng.pick(TEMPL);
      if (c.start > from) {
        from = maxD(c.start, from);
        if (to !== null && to <= from) to = null;
      }
      mk(c, b.p, from, to, rng.int(880, 950), rng.pick(REASONS), 'std');
    }
  }
  // 更新された特値（前の期間の特値のまま請求すると「期限切れ」）
  for (const c of rng.sample(chosen.filter((x) => x.rank !== 'B'), 3)) {
    const b = avail(c)[0];
    used.add(pairKey(c.code, b.p.code));
    const s1 = mk(c, b.p, '2024-04-01', '2025-03-31', rng.int(880, 920), '年間契約', 'chain');
    const s2 = { ...s1, price: floorTo10(Math.floor((s1.price * 1040) / 1000)), from: '2025-04-01', to: '2026-03-31', tag: 'chain' };
    const s3 = { ...s1, price: floorTo10(Math.floor((s2.price * 1030) / 1000)), from: '2026-04-01', to: null, tag: 'chain' };
    SPECIALS.push(s2, s3);
  }
  // 平成から続く特値（期限なし）
  {
    const c = chosen.find((x) => x.rank === 'S') || chosen[0];
    const b = avail(c)[0];
    used.add(pairKey(c.code, b.p.code));
    mk(c, b.p, '2019-04-01', null, 900, '大口継続', 'heisei');
  }
  // 新規の得意先の特値（取引開始日から月末区切り）
  for (const c of CUSTOMERS.filter((x) => x.roles.has('NEW') && ['B', 'C'].includes(x.rank)).slice(0, 2)) {
    const b = avail(c)[0];
    if (!b) continue;
    used.add(pairKey(c.code, b.p.code));
    mk(c, b.p, c.start, monthEnd(addDays(c.start, 180).slice(0, 7)), 920, '新規獲得', 'new');
  }
  // 粗利が下限を下回る特値（8組）
  const bfCands = rng.shuffle(CUSTOMERS.filter((c) => ['S', 'A'].includes(c.rank) && !c.roles.has('NOHIST') && !c.roles.has('TIER_FROM') && !c.roles.has('OLD_WIDE_ONGOING') && !c.roles.has('OLD_WIDE_FIXED') && !isDeclined(c) && !isPartial(c)));
  for (const c of bfCands.slice(0, 8)) {
    const b = avail(c, (p) => !p.cut && p.cat !== 'AD')[0];
    used.add(pairKey(c.code, b.p.code));
    const [from, to] = rng.pick([['2025-04-01', '2026-03-31'], ['2025-07-01', null], ['2026-01-01', '2026-12-31'], ['2025-01-01', '2025-12-31']]);
    const cost = entryAt(b.p.cost, maxD(from, START)).sen;
    const price = cost / 90 - rng.int(2, Math.max(3, Math.floor(cost / 90 / 25)));
    SPECIALS.push({ cust: c.code, prod: b.p.code, price, from, to, reason: '競合対策', tag: 'below_floor' });
  }
  // 粗利がちょうど10%の特値と、1円下回る特値（原価が動かないシール品で）
  for (const [i, c] of bfCands.slice(8, 10).entries()) {
    const b = avail(c, (p) => p.cat === 'SL' && !p.cut)[0] || avail(c)[0];
    const p = b.p;
    if (p.cost.length !== 1) continue;
    used.add(pairKey(c.code, p.code));
    const price = p.cost[0].sen / 90 - i;
    SPECIALS.push({ cust: c.code, prod: p.code, price, from: '2025-01-01', to: '2025-12-31', reason: '物件特値', tag: i === 0 ? 'floor_exact' : 'floor_minus1' });
    c.roles.add('FLOOR_EDGE');
    c.floorEdgeProd = p.code;
  }
  void W0;
  // 期限切れの特値のまま請求（終了日が期間内のものから選ぶ）
  const endedIn = SPECIALS.filter((s) => s.tag === 'std' && s.to !== null && s.to >= '2024-09-30' && s.to <= '2026-04-30');
  for (const s of rng.sample(endedIn, 12)) {
    const ongoing = rng.chance(0.4);
    LEAK.expired.set(pairKey(s.cust, s.prod), { to: ongoing ? END : minD(END, addDays(s.to, rng.int(30, 160))), chain: false });
  }
  for (const s of rng.sample(SPECIALS.filter((x) => x.tag === 'chain' && x.from === '2025-04-01'), 2)) {
    LEAK.expired.set(pairKey(s.cust, s.prod), { to: rng.chance(0.5) ? '2025-09-30' : '2026-03-31', chain: true });
  }
  // 開始日より前に特値で請求（1組）
  {
    const s = SPECIALS.find((x) => x.from === '2025-08-16' && !LEAK.expired.has(pairKey(x.cust, x.prod)));
    if (s) LEAK.early.set(pairKey(s.cust, s.prod), { from: '2025-08-04', to: '2025-08-15', price: s.price });
  }
}

// ---------------------------------------------------------------- 漏れの埋め込み
{
  const rng = R('leaks');
  const c1 = CUSTOMERS.find((c) => c.roles.has('OLD_WIDE_ONGOING'));
  LEAK.oldCust.set(c1.code, { from: R1, to: END, rev: R1 });
  const c2 = CUSTOMERS.find((c) => c.roles.has('OLD_WIDE_FIXED'));
  LEAK.oldCust.set(c2.code, { from: R1, to: '2025-11-20', rev: R1 });
  const c3 = CUSTOMERS.find((c) => c.roles.has('DEFER_OVERRUN'));
  LEAK.oldCust.set(c3.code, { from: c3.deferDate, to: '2025-10-15', rev: R1 });
  const r2f = CUSTOMERS.find((c) => c.roles.has('R2_SV_FIXED'));
  LEAK.r2Cust.set(r2f.code, { from: R2, to: '2026-03-15' });
  const r2o = CUSTOMERS.find((c) => c.roles.has('R2_SV_ONGOING'));
  LEAK.r2Cust.set(r2o.code, { from: R2, to: END });
  const tw = CUSTOMERS.find((c) => c.roles.has('TIER_WIDE'));
  LEAK.wrongRate.set(tw.code, { from: START, to: END, rate: TIERS.B.lo - 20 });
  const tf = CUSTOMERS.find((c) => c.roles.has('TIER_FROM'));
  tf.rate = 610;
  LEAK.wrongRate.set(tf.code, { from: '2025-11-01', to: END, rate: 575 });
  const hasSpecial = (c, p) => SPECIALS.some((s) => s.cust === c.code && s.prod === p.code);
  const busy = (c, p) => LEAK.expired.has(pairKey(c.code, p.code)) || LEAK.early.has(pairKey(c.code, p.code)) || hasSpecial(c, p);
  // 得意先単価の更新漏れ（約55組）
  const agreedLike = CUSTOMERS.filter((c) => c.roles.size === 0 || c.roles.has('DEFERRED') || c.roles.has('PARTIAL') || c.roles.has('R2_SV_FIXED') || c.roles.has('R2_SV_ONGOING'));
  const pairs = [];
  for (const c of agreedLike) {
    if (c.activeTo < '2025-09-01' || c.start >= R1) continue;
    for (const b of c.basket) {
      if (!b.p.r1 || b.p.launch >= '2024-01-01' || busy(c, b.p) || (isPartial(c) && c.excluded.includes(b.p.cat)) || STALE.codes.includes(b.p.code)) continue;
      pairs.push({ c, p: b.p, w: b.w });
    }
  }
  const sel = [];
  for (const x of rng.shuffle(pairs)) {
    if (sel.length >= 55) break;
    if (x.w < 4) continue;
    if (sel.filter((y) => y.c === x.c).length >= 3) continue;
    sel.push(x);
  }
  for (const x of sel) {
    const from = x.c.deferDate || R1;
    const fix = rng.next();
    const to = fix < 0.4 ? END : fromDays(rng.int(toDays('2025-08-20'), toDays('2026-05-29')));
    LEAK.oldPair.set(pairKey(x.c.code, x.p.code), { from, to, rev: R1 });
  }
  // R0（研磨材）の反映漏れ 4組
  const r0pairs = [];
  for (const c of CUSTOMERS) {
    if (c.roles.size !== 0) continue;
    for (const b of c.basket) if (b.p.cat === 'AB' && b.p.launch < R0 && !busy(c, b.p) && !LEAK.oldPair.has(pairKey(c.code, b.p.code))) r0pairs.push({ c, p: b.p });
  }
  for (const x of rng.sample(r0pairs, 4)) LEAK.oldPair.set(pairKey(x.c.code, x.p.code), { from: R0, to: '2024-12-13', rev: R0 });
  // 樹脂の再改定（R2）の反映漏れ 3組
  const rs2pairs = [];
  for (const c of CUSTOMERS) {
    if (c.roles.size !== 0) continue;
    for (const b of c.basket) if (b.p.rs2 && !busy(c, b.p) && !LEAK.oldPair.has(pairKey(c.code, b.p.code))) rs2pairs.push({ c, p: b.p });
  }
  for (const x of rng.sample(rs2pairs, 3)) LEAK.oldPair.set(pairKey(x.c.code, x.p.code), { from: R2, to: END, rev: R2 });
  // 受注入力の手入力単価：ランク下限より下（約22組）、上限より上（2組）、ランク内だが理由不明（3組）
  const manCands = [];
  for (const c of CUSTOMERS) {
    if (c.roles.has('NOHIST') || c.roles.has('TIER_WIDE') || c.roles.has('TIER_FROM') || isDeclined(c) || c.roles.has('NO_AGREEMENT')) continue;
    for (const b of c.basket) {
      const k = pairKey(c.code, b.p.code);
      if (busy(c, b.p) || LEAK.oldPair.has(k) || b.w < 3) continue;
      manCands.push({ c, p: b.p });
    }
  }
  const mc = rng.shuffle(manCands);
  const usedC = new Map();
  let idx = 0;
  const takeMan = (n, kind) => {
    let got = 0;
    while (got < n && idx < mc.length) {
      const x = mc[idx++];
      if ((usedC.get(x.c.code) || 0) >= 2) continue;
      if (kind !== 'low' && (x.c.rank === 'D' || x.c.activeTo < END)) continue;
      usedC.set(x.c.code, (usedC.get(x.c.code) || 0) + 1);
      const fromM = rng.pick(MONTHS.slice(2, 20));
      const from = `${fromM}-${pad2(rng.int(1, 20))}`;
      const to = rng.chance(0.45) ? END : minD(END, addDays(from, rng.int(40, 300)));
      LEAK.manual.set(pairKey(x.c.code, x.p.code), { from, to, kind, d: kind === 'low' ? rng.int(20, 80) : kind === 'high' ? rng.int(25, 60) : 0 });
      got++;
    }
  };
  takeMan(22, 'low');
  takeMan(2, 'high');
  takeMan(3, 'unexplained');
}

// ================================================================ 注文（伝票と明細）
function weekdaysIn(from, to) {
  const out = [];
  for (let d = toDays(from); d <= toDays(to); d++) {
    const iso = fromDays(d);
    const w = dow(iso);
    const md = iso.slice(5);
    const holiday = md >= '12-29' || md <= '01-03' || (md >= '08-13' && md <= '08-15');
    if (w !== 0 && w !== 6 && !holiday) out.push(iso);
  }
  return out;
}
const isBiz = (d) => weekdaysIn(d, d).length === 1;
function qtyFor(p, c, rng) {
  const f = SIZEF[c.rank];
  let base;
  switch (p.unit) {
    case '箱': base = rng.int(1, 12); break;
    case '個': base = rng.int(2, 40); break;
    case '本': base = rng.int(1, 20); break;
    case '袋': base = p.cat === 'RS' ? rng.int(4, 40) : rng.int(1, 15); break;
    case '巻': base = rng.int(1, 6); break;
    case '缶': base = rng.int(1, 8); break;
    case 'ドラム': base = rng.int(1, 4); break;
    case '枚': base = rng.int(2, 30); break;
    case 'kg': return Math.max(100, Math.floor((rng.int(6, 80) * 50 * f) / 1000 / 50) * 50);
    case 'セット': base = rng.int(1, 8); break;
    case 'ケース': base = rng.int(1, 5); break;
    default: base = rng.int(1, 10);
  }
  return Math.max(1, Math.floor((base * f) / 1000));
}
const bigQty = (p, q) => (p.unit === 'kg' ? q >= 1500 : q >= ({ 箱: 12, 個: 40, 本: 20, 袋: 30, 巻: 6, 缶: 8, ドラム: 4, 枚: 30, セット: 8, ケース: 5 }[p.unit] || 10));

const SLIPS = []; // {date, cust, lines:[{prod, qty, ...}], tag}
{
  const rng = R('orders');
  for (const c of CUSTOMERS) {
    if (c.roles.has('NOHIST')) continue;
    for (const ym of MONTHS) {
      const from = maxD(`${ym}-01`, c.activeFrom);
      const to = minD(monthEnd(ym), c.activeTo);
      if (from > to) continue;
      const days = weekdaysIn(from, to);
      if (!days.length) continue;
      const share = days.length / weekdaysIn(`${ym}-01`, monthEnd(ym)).length;
      const expected = (c.freq * SEASON[+ym.slice(5, 7)] * share) / 1000;
      let n = Math.floor(expected);
      if (rng.next() < expected - n) n++;
      for (let k = 0; k < n; k++) {
        const date = rng.pick(days);
        const nl = rng.int(1, MAXLINES[c.rank]);
        const avail = c.basket.filter((b) => b.p.launch <= date);
        const picked = new Set();
        const lines = [];
        for (let i = 0; i < nl && picked.size < avail.length; i++) {
          let b;
          do b = rng.weighted(avail, (x) => x.w);
          while (picked.has(b.p.code));
          picked.add(b.p.code);
          lines.push({ prod: b.p.code, qty: qtyFor(b.p, c, rng) });
        }
        if (lines.length) SLIPS.push({ date, cust: c.code, lines, tag: 'order' });
      }
    }
  }
  // 境目の日付の明細（明示的に足す）
  const ex = (date, c, p, tag, dir = 0) => {
    // dir: +1 = 休日なら次の営業日へ、-1 = 前の営業日へ、0 = そのまま
    while (dir !== 0 && !isBiz(date)) date = addDays(date, dir);
    if (!c || !p || date < c.activeFrom || date > c.activeTo || date < START || date > END || p.launch > date) return;
    SLIPS.push({ date, cust: c.code, lines: [{ prod: p.code, qty: qtyFor(p, c, rng) }], tag });
  };
  const pickB = (c, pred) => {
    const xs = c.basket.filter((b) => pred(b.p) && !SPECIALS.some((s) => s.cust === c.code && s.prod === b.p.code));
    return xs.length ? xs.sort((a, b) => b.w - a.w)[0].p : null;
  };
  for (const s of SPECIALS) {
    const c = CUST.get(s.cust);
    const p = PROD.get(s.prod);
    if (s.from >= START) {
      ex(s.from, c, p, 'bd_special_start', 1);
      ex(addDays(s.from, -1), c, p, 'bd_special_before', -1);
    }
    if (s.to !== null && s.to <= END) {
      ex(s.to, c, p, 'bd_special_end', -1);
      ex(addDays(s.to, 1), c, p, 'bd_special_after', 1);
    }
  }
  for (const c of rng.sample(CUSTOMERS.filter((x) => x.roles.size === 0 && x.rank !== 'D'), 6)) {
    const p = pickB(c, (q) => q.r1);
    ex(addDays(R1, -1), c, p, 'bd_r1');
    ex(R1, c, p, 'bd_r1');
  }
  for (const c of CUSTOMERS.filter((x) => isDeclined(x) || isPartial(x)).slice(0, 6)) ex(R1, c, pickB(c, (q) => q.r1 && (isDeclined(c) || c.excluded.includes(q.cat))), 'bd_r1_held');
  for (const c of CUSTOMERS.filter((x) => x.deferDate)) {
    const p = pickB(c, (q) => q.r1 && !(isPartial(c) && c.excluded.includes(q.cat)));
    ex(addDays(c.deferDate, -1), c, p, 'bd_defer');
    ex(c.deferDate, c, p, 'bd_defer');
  }
  const c2 = CUSTOMERS.find((c) => c.roles.has('OLD_WIDE_FIXED'));
  const p2 = pickB(c2, (q) => q.r1);
  ex('2025-11-20', c2, p2, 'bd_fix');
  ex('2025-11-21', c2, p2, 'bd_fix');
  const c3 = CUSTOMERS.find((c) => c.roles.has('DEFER_OVERRUN'));
  const p3 = pickB(c3, (q) => q.r1);
  ex('2025-10-15', c3, p3, 'bd_fix');
  ex('2025-10-16', c3, p3, 'bd_fix');
  const r2f = CUSTOMERS.find((c) => c.roles.has('R2_SV_FIXED'));
  const psv = pickB(r2f, (q) => q.cat === 'SV' && q.r2);
  ex('2026-02-27', r2f, psv, 'bd_r2');
  ex('2026-03-13', r2f, psv, 'bd_r2');
  ex('2026-03-16', r2f, psv, 'bd_r2');
  const tf = CUSTOMERS.find((c) => c.roles.has('TIER_FROM'));
  const ptf = pickB(tf, () => true);
  ex('2025-10-31', tf, ptf, 'bd_tier');
  ex('2025-11-04', tf, ptf, 'bd_tier');
  // 商品マスタの定価が旧定価のままだった商品の境目
  for (const code of STALE.codes) {
    const p = PROD.get(code);
    const buyers = CUSTOMERS.filter((c) => c.roles.size === 0 && c.basket.some((b) => b.p.code === code));
    for (const c of buyers.slice(0, 2)) {
      ex('2025-07-10', c, p, 'bd_stale');
      ex('2025-07-11', c, p, 'bd_stale');
    }
    for (const c of buyers.slice(0, 3)) ex(fromDays(rng.int(toDays(R1), toDays('2025-07-09'))), c, p, 'stale');
  }
  // 粗利10%ちょうどの特値の明細を数行
  for (const c of CUSTOMERS.filter((x) => x.roles.has('FLOOR_EDGE'))) {
    const p = PROD.get(c.floorEdgeProd);
    for (const d of ['2025-02-14', '2025-05-20', '2025-09-12', '2025-12-26']) ex(d, c, p, 'floor_edge');
  }
  // 接着剤の仕入値上げの前後（特約店）
  for (const c of CUSTOMERS.filter((x) => x.rank === 'S' && x.roles.size === 0).slice(0, 4)) {
    const p = pickB(c, (q) => q.cat === 'AD');
    ex('2026-01-30', c, p, 'bd_cost');
    ex('2026-02-02', c, p, 'bd_cost');
  }
  // 早すぎた特値の明細
  for (const [k] of LEAK.early) {
    const [cc, pc] = k.split('|');
    for (const d of ['2025-08-05', '2025-08-12', '2025-08-15']) ex(d, CUST.get(cc), PROD.get(pc), 'early');
  }
  // 見送りの得意先が改定後の新商品を買う（あいまい）
  const amb = CUSTOMERS.find((c) => c.roles.has('AMB_NEWPROD'));
  for (const d of ['2025-12-04', '2026-02-10', '2026-05-19']) ex(d, amb, LATE_FOR_DECLINED, 'amb_newprod');
}

// ---------------------------------------------------------------- 単価づけ（販売管理の請求単価）
const WG = buildWorldFromInternal();
const pairChoice = (k) => hashSeed(k) % 2 === 0;
function priceSale(c, p, date, L) {
  const key = pairKey(c.code, p.code);
  const app = applicable(WG, c.key, p.key, date);
  let billEntry = app.entry || app.reg;
  if (app.amb === 'AMB_HELD_PRICE_AND_LATER_LIST_CHANGE') billEntry = pairChoice(key) ? app.held : app.reg;
  else if (app.amb) billEntry = app.reg;
  const billList = billEntry.price;
  const rate = c.rate;
  const sp = specialAtG(c.code, p.code, date);
  const T = TIERS[c.rank];
  const prev = (entry, rev) => {
    if (entry.from !== rev) return null;
    const i = p.list.indexOf(entry);
    return i > 0 ? p.list[i - 1] : null;
  };
  const man = LEAK.manual.get(key);
  if (inRange(man, date) && !sp) {
    if (man.kind === 'low') return { price: floorTo10(Math.floor((billList * (T.lo - man.d)) / 1000)), mode: 'manual_low', ptype: 9 };
    if (man.kind === 'high') {
      const v = Math.floor((billList * (T.hi + man.d)) / 1000);
      return { price: v >= 1000 ? Math.ceil(v / 10) * 10 : v, mode: 'manual_high', ptype: 9 };
    }
    const lo = Math.floor((billList * T.lo) / 1000);
    const correct = Math.floor((billList * rate) / 1000);
    let v = Math.floor((billList * (rate + (rate - 10 >= T.lo ? -10 : 10))) / 1000);
    if (v === correct || v < lo) v = correct - 1 >= lo ? correct - 1 : correct + 1;
    return { price: v, mode: 'unexplained', ptype: 9 };
  }
  const wr = LEAK.wrongRate.get(c.code);
  if (inRange(wr, date) && !sp) return { price: Math.floor((billList * wr.rate) / 1000), mode: 'wrong_rate', ptype: 0 };
  const ex = LEAK.expired.get(key);
  if (ex && date <= ex.to) {
    const ended = specialsOf(c.code, p.code).filter((s) => s.to !== null && s.to < date).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
    if (ended && (ex.chain ? sp && sp.tag === 'chain' && sp.from === '2025-04-01' : !sp)) return { price: ended.price, mode: 'expired', ptype: 1 };
  }
  if (sp) return { price: sp.price, mode: 'special', ptype: 1 };
  const early = LEAK.early.get(key);
  if (inRange(early, date)) return { price: early.price, mode: 'early_special', ptype: 1 };
  // 旧単価のまま
  let old = null;
  const oc = LEAK.oldCust.get(c.code);
  if (inRange(oc, date)) old = prev(billEntry, oc.rev);
  const op = LEAK.oldPair.get(key);
  if (!old && inRange(op, date)) old = prev(billEntry, op.rev);
  const r2 = LEAK.r2Cust.get(c.code);
  if (!old && inRange(r2, date) && p.cat === 'SV') old = prev(billEntry, R2);
  if (!old && STALE.codes.includes(p.code) && date >= R1 && date <= STALE.to) old = prev(billEntry, R1);
  if (old) return { price: Math.floor((old.price * rate) / 1000), mode: 'old', ptype: 1 };
  const price = Math.floor((billList * rate) / 1000);
  void L;
  return { price, mode: 'correct', ptype: ['S', 'A'].includes(c.rank) ? (hashSeed(key) % 10 < 7 ? 1 : 0) : hashSeed(key) % 10 < 2 ? 1 : 0, amb: app.amb };
}
const registeredList = (p, date) => {
  if (STALE.codes.includes(p.code) && date >= R1 && date <= STALE.to) return entryAt(p.list, addDays(R1, -1)).price;
  return entryAt(p.list, date).price;
};

// 明細の値をすべて決める
const SALE_LINES = [];
let belowDiscLeft = 4; // 値引き後に粗利下限を割る数量値引（あいまい）は数行だけ
{
  const rng = R('pricing');
  for (const s of SLIPS) {
    const c = CUST.get(s.cust);
    for (const L of s.lines) {
      const p = PROD.get(L.prod);
      const r = priceSale(c, p, s.date, L);
      Object.assign(L, { kind: 'sale', price: r.price, mode: r.mode, ptype: r.ptype, note: '', listCol: registeredList(p, s.date), costSen: entryAt(p.cost, s.date).sen });
      const dcand = (r.mode === 'correct' || r.mode === 'special') && !r.amb && bigQty(p, L.qty) && rng.chance(0.09);
      const d = dcand ? rng.pick([2, 3, 3, 5]) : 0;
      const dPrice = Math.floor((L.price * (100 - d)) / 100);
      const dBelow = dcand && dPrice * 90 < L.costSen;
      if (dcand && (!dBelow || belowDiscLeft-- > 0)) {
        L.price = dPrice;
        L.mode += '+disc';
        L.ptype = 9;
        L.note = rng.chance(0.5) ? `数量値引${d}%` : `まとめ買い${d}%引`;
        if (rng.chance(0.15)) L.note = `直送・${L.note}`;
      } else if (rng.chance(0.012)) L.note = rng.pick(['評価用サンプル採用品', '見本確認済み', '直送', '納期指定', '至急']);
      L.date = s.date;
      L.cust = s.cust;
      SALE_LINES.push(L);
    }
  }
  // 小数の値引率（あいまい）を3行
  const cands = SALE_LINES.filter((L) => L.mode === 'correct' && L.price >= 400 && !L.amb).slice(0, 4000);
  for (const L of rng.sample(cands, 3)) {
    L.price = Math.floor((L.price * 975) / 1000);
    L.mode = 'correct+decimal_disc';
    L.ptype = 9;
    L.note = '数量値引2.5%';
  }
}
// 運賃・手数料・廃番・諸口・見本品・無償（備考なし）
{
  const rng = R('extras');
  for (const s of SLIPS) {
    const c = CUST.get(s.cust);
    const pFreight = { S: 0.02, A: 0.03, B: 0.1, C: 0.35, D: 0.45 }[c.rank];
    if (rng.chance(pFreight)) s.lines.push({ kind: 'sale', prod: '9999', qty: 1, price: rng.int(12, 90) * 50, mode: 'nonproduct', ptype: 9, note: '', date: s.date, cust: s.cust });
    if (rng.chance(0.015)) s.lines.push({ kind: 'sale', prod: '9998', qty: 1, price: rng.pick([500, 1000]), mode: 'nonproduct', ptype: 9, note: '小口のため', date: s.date, cust: s.cust });
  }
  for (const L of SLIPS.flatMap((s) => s.lines)) if (L.mode === 'nonproduct') {
    L.listCol = L.price;
    L.costSen = Math.floor((L.price * 85) / 100) * 100;
  }
  const early = SLIPS.filter((s) => s.date < '2024-10-01' && s.tag === 'order');
  for (const s of rng.sample(early, 8)) {
    const code = rng.pick(['FS-10990', 'LB-16990']);
    const price = code === 'FS-10990' ? 1840 : 7200;
    const qty = rng.int(1, 4);
    s.lines.push({ kind: 'sale', prod: code, qty, price, mode: 'nonproduct', ptype: 0, note: '', listCol: code === 'FS-10990' ? 2600 : 10400, costSen: Math.floor(price * 0.6) * 100, date: s.date, cust: s.cust });
  }
  // 諸口（得意先マスタにない現金売上の得意先）
  for (let i = 0; i < 12; i++) {
    const date = rng.pick(weekdaysIn(`${MONTHS[i * 2]}-01`, monthEnd(MONTHS[i * 2])));
    const p = rng.pick(PRODUCTS.filter((x) => x.launch <= date && x.unit !== 'ドラム' && x.unit !== 'kg'));
    const list = entryAt(p.list, date).price;
    SLIPS.push({ date, cust: '999999', tag: 'cash', lines: [{ kind: 'sale', prod: p.code, qty: rng.int(1, 3), price: list, mode: 'cash', ptype: 9, note: '現金', listCol: list, costSen: entryAt(p.cost, date).sen, date, cust: '999999' }] });
  }
  // 見本品（単価0・備考に見本/サンプル）
  const sampleSlips = rng.sample(SLIPS.filter((s) => s.tag === 'order' && ['S', 'A', 'B'].includes(CUST.get(s.cust).rank)), 60);
  for (const s of sampleSlips) {
    const c = CUST.get(s.cust);
    const p = rng.pick(PRODUCTS.filter((x) => x.launch <= s.date && x.unit !== 'ドラム' && x.unit !== 'kg' && !s.lines.some((l) => l.prod === x.code)));
    s.lines.push({ kind: 'sale', prod: p.code, qty: rng.int(1, 2), price: 0, mode: 'sample', ptype: 9, note: rng.pick(['見本品', 'サンプル(無償)', 'サンプル品 評価用', '見本']), listCol: entryAt(p.list, s.date).price, costSen: entryAt(p.cost, s.date).sen, date: s.date, cust: c.code });
  }
  // 単価0だが備考に見本/サンプルの記載がない（あいまい）
  for (const s of rng.sample(SLIPS.filter((x) => x.tag === 'order' && x.date >= L12), 3)) {
    const p = PROD.get(s.lines[0].prod);
    const other = rng.pick(PRODUCTS.filter((x) => x.launch <= s.date && x.cat === p.cat && x.code !== p.code && x.unit !== 'ドラム'));
    s.lines.push({ kind: 'sale', prod: other.code, qty: 1, price: 0, mode: 'zero_no_note', ptype: 9, note: rng.pick(['販促品（無償提供）', '']), listCol: entryAt(other.list, s.date).price, costSen: entryAt(other.cost, s.date).sen, date: s.date, cust: s.cust });
  }
}
// 返品（同じ単価・数量マイナス）。漏れていた行の返品も入れる
{
  const rng = R('returns');
  const sales = SLIPS.flatMap((s) => s.lines.filter((l) => l.kind === 'sale' && !['nonproduct', 'sample', 'zero_no_note', 'cash'].includes(l.mode) && l.qty >= 2 && l.date <= addDays(END, -12)));
  const leakish = sales.filter((l) => ['old', 'expired', 'manual_low', 'wrong_rate'].includes(l.mode));
  const picks = [...rng.sample(sales.filter((l) => !leakish.includes(l)), Math.floor(sales.length * 0.007)), ...rng.sample(leakish, 14)];
  for (const o of picks) {
    let date = addDays(o.date, rng.int(3, 20));
    while (!isBiz(date)) date = addDays(date, 1);
    if (date > END) continue;
    const c = CUST.get(o.cust);
    if (date > c.activeTo) continue;
    const q = -rng.int(1, Math.min(o.qty - 1, 6));
    SLIPS.push({ date, cust: o.cust, tag: 'return', lines: [{ kind: 'return', prod: o.prod, qty: q, price: o.price, mode: `return_of_${o.mode}`, ptype: o.ptype, note: rng.pick(['返品（破損）', '返品（誤発注）', '返品（数量違い）', '返品']), listCol: o.listCol, costSen: o.costSen, date, cust: o.cust }] });
  }
}

// ---------------------------------------------------------------- 伝票番号と並べ替え
SLIPS.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.cust !== b.cust ? (a.cust < b.cust ? -1 : 1) : 0));
{
  let na = 5100001;
  let nb = 62000001;
  for (const s of SLIPS) {
    s.layout = s.date < LAYOUT_B_FROM ? 'A' : 'B';
    s.no = s.layout === 'A' ? na++ : nb++;
    s.lines.forEach((l, i) => {
      l.lineNo = i + 1;
      l.slipNo = s.no;
      l.layout = s.layout;
    });
  }
}

// ================================================================ 書き出し（入力データ）
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const COMPANY = { name: '架空ケミカル工材株式会社', short: '架空ケミカル工材' };
const nameFor = (c, date) => (c.oldName && date < c.renamed ? c.oldName : c.name);
const custOf = (code) => CUST.get(code) || { code: '999999', name: '諸口（現金売上）', short: '諸口', dept: '本社営業部', key: '999999' };
const prodInfo = (code) => PROD.get(code) || { code, name: NON_PRODUCTS[code].name, unit: NON_PRODUCTS[code].unit };
const PTYPE_A = { 0: '標準', 1: '得意先', 9: '手入力' };
function codeA(code, dept) {
  if (/^\d+$/.test(code)) return fw(code);
  if (dept === '北関東営業所') return fw(code.replace('-', ''));
  if (dept === '九州営業所') return fw(code).replace('－', 'ー');
  return fw(code);
}
function codeB(code, rng) {
  if (/^\d+$/.test(code)) return code;
  const v = rng.next();
  if (v < 0.45) return code;
  if (v < 0.6) return code.replace('-', '');
  if (v < 0.7) return code.toLowerCase();
  if (v < 0.78) return `${code} `;
  if (v < 0.85) return code.replace('-', '－');
  if (v < 0.9) return code.replace('-', 'ｰ');
  if (v < 0.95) return code.replace('-', '‐');
  const [a, b] = code.split('-');
  return `${fw(a)}-${b}`;
}
const rateA = (price, list) => (list > 0 ? ((price * 100) / list).toFixed(1) : '0.0');
const rateB = (price, list) => (list > 0 ? (price / list).toFixed(3) : '0.000');
const fwNote = (s, rng) => (rng.chance(0.5) ? s.replace(/[0-9%]/g, (ch) => fw(ch)) : s);

const SALES_A = 'sales_A_202407-202512.csv';
const SALES_B = 'sales_B_202601-202606.csv';
const HEAD_A = ['売上日', '伝票番号', '行', '取引区分', '部門', '得意先コード', '得意先名', '商品コード', '商品名', '数量', '単位', '定価', '掛率(%)', '単価', '金額', '原単価', '原価金額', '粗利額', '単価区分', '備考'];
const HEAD_B = ['伝票日付', '伝票No', '明細No', '得意先CD', '得意先略称', '品番', '品名', '売上区分', '数量', '単位', '標準価格', '掛率', '売単価', '売上金額', '原価単価', '原価金額', '単価種別', '摘要'];
function rowA(L, rng) {
  const c = custOf(L.cust);
  const p = prodInfo(L.prod);
  const amount = L.price * L.qty;
  const costAmt = roundHalfAway(L.costSen * L.qty, 100);
  const date = L.date.startsWith('2025-03') ? excelDate(L.date) : reiwaShort(L.date);
  const custCode = rng.chance(0.03) ? c.code : fw(c.code);
  const qty = Math.abs(L.qty) >= 1000 ? comma(L.qty) : String(L.qty);
  const note = L.note ? (/値引|まとめ買い/.test(L.note) ? fwNote(L.note, rng) : L.note.replace('(無償)', '（無償）')) : '';
  return [date, L.slipNo, L.lineNo, L.kind === 'return' ? '返品' : '売上', c.dept, custCode, CUST.get(L.cust) ? nameFor(c, L.date) : c.name, codeA(L.prod, c.dept), fw(p.name), qty, fw(p.unit), comma(L.listCol), rateA(L.price, L.listCol), comma(L.price), comma(amount), senStrA(L.costSen), comma(costAmt), comma(amount - costAmt), PTYPE_A[L.ptype], note];
}
function rowB(L, rng) {
  const c = custOf(L.cust);
  const p = prodInfo(L.prod);
  const amount = L.price * L.qty;
  const costAmt = roundHalfAway(L.costSen * L.qty, 100);
  const kyushu = c.dept === '九州営業所' && L.date.startsWith('2026-04');
  const custCode = rng.chance(0.05) ? c.code : String(+c.code);
  return [kyushu ? excelDate(L.date) : ymd8(L.date), L.slipNo, L.lineNo, custCode, c.short, codeB(L.prod, rng), hwKana(p.name), L.kind === 'return' ? 2 : 1, L.qty, hwKana(p.unit), L.listCol, rateB(L.price, L.listCol), L.price, amount, senStr(L.costSen), costAmt, L.ptype, L.note ? hwKana(L.note) : ''];
}
const ALL_LINES = SLIPS.flatMap((s) => s.lines);
{
  const rng = R('format');
  const aLines = ALL_LINES.filter((l) => l.layout === 'A');
  const bLines = ALL_LINES.filter((l) => l.layout === 'B');
  aLines.forEach((l, i) => {
    l.file = SALES_A;
    l.row = i + 1;
  });
  bLines.forEach((l, i) => {
    l.file = SALES_B;
    l.row = i + 1;
  });
  writeOut(SALES_A, HEAD_A, aLines.map((l) => rowA(l, rng)), { layout: 'A', bom: true, eol: '\r\n' });
  writeOut(SALES_B, HEAD_B, bLines.map((l) => rowB(l, rng)), { layout: 'B', encoding: 'sjis' });
}
// マスタ類
writeOut('rate_tiers.csv', ['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明'], Object.entries(TIERS).map(([k, t]) => [k, t.name, (t.std / 10).toFixed(1), (t.lo / 10).toFixed(1), (t.hi / 10).toFixed(1), t.note]));
writeOut('categories.csv', ['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料'], CATS.map((c) => [c.code, c.name, ...c.ratios, c.main]));
writeOut('suppliers.csv', ['仕入先コード', '仕入先名', '主な取扱カテゴリ'], SUPPLIERS);
writeOut('customers.csv', ['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日'], CUSTOMERS.map((c) => [c.code, c.name, c.short, c.type, c.rank, (c.rate / 10).toFixed(1), c.dept, c.rep, c.pref, c.closing, c.toDept, c.start]));
writeOut('products.csv', ['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)'], PRODUCTS.map((p) => [p.code, p.name, p.cat, p.unit, p.list[p.list.length - 1].price, senStr(p.cost[p.cost.length - 1].sen), p.supplier, ...p.ratios]));
writeOut('list_price_history.csv', ['商品コード', '定価(円)', '適用開始日', '適用終了日'], PRODUCTS.flatMap((p) => p.list.map((e) => [p.code, e.price, e.from, e.to || ''])));
writeOut('cost_history.csv', ['商品コード', '原単価(円)', '適用開始日', '適用終了日'], PRODUCTS.flatMap((p) => p.cost.map((e) => [p.code, senStr(e.sen), e.from, e.to || ''])));
writeOut('revision_2025-06_agreements.csv', ['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考'], CUSTOMERS.filter((c) => AG.has(c.code)).map((c) => {
  const a = AG.get(c.code);
  return [c.code, c.name, a.applied, a.answered, a.status, a.date, a.excluded.join(';'), a.note];
}));
// 特値一覧（A形式とB形式に同じ内容）
{
  const sp = SPECIALS.slice().sort((a, b) => (a.cust !== b.cust ? (a.cust < b.cust ? -1 : 1) : a.prod !== b.prod ? (a.prod < b.prod ? -1 : 1) : a.from < b.from ? -1 : 1));
  writeOut('special_prices_A.csv', ['得意先コード', '得意先名', '商品コード', '商品名', '特値単価', '開始日', '終了日', '登録理由'], sp.map((s) => {
    const c = CUST.get(s.cust);
    const p = PROD.get(s.prod);
    return [fw(c.code), c.name, codeA(p.code, c.dept), fw(p.name), comma(s.price), warekiLong(s.from), s.to ? warekiLong(s.to) : '', s.reason];
  }), { layout: 'A', bom: true, eol: '\r\n' });
  const rng = R('spB');
  writeOut('special_prices_B.csv', ['得意先CD', '品番', '特価', '有効開始日', '有効終了日', '摘要'], sp.map((s) => [String(+s.cust), codeB(s.prod, rng), s.price, ymd8(s.from), s.to ? ymd8(s.to) : '99991231', s.reason]));
}
// 仕入先の値上げ通知
{
  const rng = R('notices');
  const rows = [];
  const supName = new Map(SUPPLIERS.map((s) => [s[0], s[1]]));
  const add = (p, notice, eff, pct, reason, status, curSen) => {
    const nextSen = roundTo90(curSen * (1000 + pct), 1000);
    rows.push([notice, p.supplier, supName.get(p.supplier), p.code, p.name, senStr(curSen), senStr(nextSen), ((nextSen - curSen) * 100 / curSen).toFixed(1), eff, reason, status]);
  };
  for (const p of PRODUCTS.filter((x) => x.cat === 'AD')) add(p, '2025-12-10', AD_COST, 120, '原料樹脂・溶剤価格の上昇', '適用済み', entryAt(p.cost, addDays(AD_COST, -1)).sen);
  for (const p of PRODUCTS.filter((x) => x.cat === 'SV' && x.launch < R2_COST)) add(p, '2025-12-18', R2_COST, 50, '原油・ナフサ価格と物流費の上昇', '適用済み', entryAt(p.cost, addDays(R2_COST, -1)).sen);
  const plans = [['S01', '2026-08-01', 60, '線材価格の上昇'], ['S03', '2026-09-01', 50, '鋼材・エネルギーコストの上昇'], ['S10', '2026-08-01', 70, '基油価格の上昇'], ['S05', '2026-10-01', 40, '合成ゴム原料の上昇'], ['S12', '2026-09-01', 40, '砥粒・人件費の上昇'], ['S11', '2026-10-01', 30, '容器・物流費の上昇']];
  for (const [sup, eff, pct, reason] of plans) {
    for (const p of PRODUCTS.filter((x) => x.supplier === sup)) add(p, fromDays(toDays(eff) - rng.int(45, 75)), eff, pct + rng.int(-10, 10), reason, '予定', p.cost[p.cost.length - 1].sen);
  }
  rows.sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[3] < b[3] ? -1 : 1));
  writeOut('supplier_notices.csv', ['通知日', '仕入先コード', '仕入先名', '商品コード', '商品名', '現行仕入単価(円)', '改定後仕入単価(円)', '改定率(%)', '適用日', '主な理由', '状態'], rows);
}
writeText('company.json', `${JSON.stringify({ note: 'すべて架空のデータです。実在の企業・団体・人物とは関係ありません。', name: COMPANY.name, shortName: COMPANY.short, postalCode: '000-0000', prefecture: '東京都', address: '東京都架空区星見町二丁目8番1号（架空）', tel: '00-0000-0000', representative: '代表取締役 架空 一郎', departments: ['本社営業部', '北関東営業所（群馬県・架空）', '九州営業所（福岡県・架空）'] }, null, 2)}\n`);
writeText('demo_settings.json', `${JSON.stringify({ note: '検証用の初期設定です(架空)。アプリ側で変更できる前提の値です。', marginFloorPct: FLOOR_PCT, previousRevisionDate: R1, listPriceRounding: [{ below: 1000, unit: 10 }, { below: 10000, unit: 50 }, { below: null, unit: 100 }], nextRevisionDate: NEXT_EFF }, null, 2)}\n`);

// ================================================================ 次回改定と反映チェック（next/）
const NEXT_CATS = { FS: 60, BR: 50, HP: 50, LB: 70, SL: 40, AD: 120, AB: 40 };
const NEXT_LIST = new Map(); // code -> {cur, nw}
const OUTCOMES = new Map(); // code -> {status, date, excluded[], note}
const MASTER = new Map(); // `${cust}|${prod}` -> {eff, newPrice, oldPrice}
const FOLLOW = []; // lines
{
  const rng = R('next');
  for (const p of PRODUCTS) {
    if (!NEXT_CATS[p.cat]) continue;
    const cur = p.list[p.list.length - 1].price;
    NEXT_LIST.set(p.code, { cur, nw: ceilList(cur * (1000 + NEXT_CATS[p.cat] + rng.int(-10, 10)), 1000) });
  }
  // 直近12か月の購入（明細から）
  const bought = new Map();
  for (const L of ALL_LINES) {
    if (L.kind !== 'sale' || !PROD.has(L.prod) || L.date < L12 || L.price === 0 || !CUST.has(L.cust)) continue;
    if (!bought.has(L.cust)) bought.set(L.cust, new Map());
    bought.get(L.cust).set(L.prod, L);
  }
  const active = CUSTOMERS.filter((c) => bought.has(c.code) && c.activeTo === END);
  const holdRoles = ['OLD_WIDE_ONGOING', 'TIER_WIDE', 'TIER_FROM', 'NO_AGREEMENT', 'R2_SV_ONGOING', 'DECLINED_SV', 'AMB_NEWPROD'];
  const plain = rng.shuffle(active.filter((c) => c.roles.size === 0 && ['A', 'B'].includes(c.rank)));
  const fAll = plain[0];
  const fUntil = plain[1];
  const fDefer = [plain[2], plain[3]];
  const fMid = plain[4];
  for (const c of active) {
    let o;
    if (holdRoles.some((r) => c.roles.has(r))) o = { status: '協議中', date: '', excluded: [], note: '回答待ち' };
    else if (isDeclined(c)) o = rng.chance(0.6) ? { status: '見送り', date: '', excluded: [], note: '前回に続き据え置き要請' } : { status: '協議中', date: '', excluded: [], note: '' };
    else if (isPartial(c)) {
      const ex = c.excluded.filter((x) => NEXT_CATS[x]);
      if (!ex.length) ex.push('AD');
      o = { status: '一部合意', date: NEXT_EFF, excluded: ex, note: `${ex.map((x) => CAT_BY.get(x).name).join('・')}は据え置き` };
    } else if (fDefer.includes(c)) o = { status: '適用日変更', date: '2026-10-01', excluded: [], note: '10月1日適用で合意' };
    else if (c === fMid) o = { status: '適用日変更', date: '2026-09-16', excluded: [], note: '締日後の9月16日から' };
    else {
      const v = rng.next();
      if (v < 0.78 || c === fAll || c === fUntil) o = { status: '合意', date: NEXT_EFF, excluded: [], note: '' };
      else if (v < 0.86) o = { status: '一部合意', date: NEXT_EFF, excluded: [rng.pick(['AD', 'LB', 'SL'])], note: '一部カテゴリは据え置き' };
      else if (v < 0.92) o = { status: '見送り', date: '', excluded: [], note: '' };
      else o = { status: '協議中', date: '', excluded: [], note: '' };
    }
    OUTCOMES.set(c.code, o);
  }
  const endLeakPairs = new Set();
  for (const L of ALL_LINES) if (L.kind === 'sale' && L.date >= '2026-01-01' && !['correct', 'special', 'correct+disc', 'special+disc'].includes(L.mode)) endLeakPairs.add(pairKey(L.cust, L.prod));
  for (const c of active) {
    const o = OUTCOMES.get(c.code);
    if (!['合意', '一部合意', '適用日変更'].includes(o.status)) continue;
    for (const [pc] of bought.get(c.code)) {
      const p = PROD.get(pc);
      if (!NEXT_LIST.has(pc) || o.excluded.includes(p.cat)) continue;
      if (specialAtG(c.code, pc, o.date)) continue;
      const app = applicable(WG, c.key, p.key, '2026-08-31');
      if (app.amb) continue;
      MASTER.set(pairKey(c.code, pc), { eff: o.date, newPrice: Math.floor((NEXT_LIST.get(pc).nw * c.rate) / 1000), oldPrice: Math.floor((app.list * c.rate) / 1000), leaky: endLeakPairs.has(pairKey(c.code, pc)) });
    }
  }
  // 9月分の売上明細
  const fRng = R('follow');
  const randomOld = new Set();
  for (const [k, m] of MASTER) {
    const cc = k.split('|')[0];
    if (cc !== fAll.code && cc !== fUntil.code && m.eff === NEXT_EFF && !m.leaky && fRng.chance(0.06)) randomOld.add(k);
  }
  const slips = [];
  const days = weekdaysIn('2026-09-01', '2026-09-30');
  for (const c of active) {
    const expected = (c.freq * 1100) / 1000;
    let n = Math.floor(expected);
    if (fRng.next() < expected - n) n++;
    if (c === fAll || c === fUntil || fDefer.includes(c) || c === fMid) n = Math.max(n, 4);
    const basket = c.basket.filter((b) => !MASTER.get(pairKey(c.code, b.p.code))?.leaky && !(LEAK.manual.has(pairKey(c.code, b.p.code))) && !LEAK.expired.has(pairKey(c.code, b.p.code)) && !LEAK.oldPair.has(pairKey(c.code, b.p.code)));
    if (!basket.length) continue;
    for (let k = 0; k < n; k++) {
      let date = fRng.pick(days);
      if (c === fUntil && k === 0) date = '2026-09-10';
      if (c === fUntil && k === 1) date = '2026-09-11';
      if (c === fMid && k === 0) date = '2026-09-15';
      if (c === fMid && k === 1) date = '2026-09-16';
      const nl = fRng.int(1, MAXLINES[c.rank]);
      const picked = new Set();
      const lines = [];
      const masterFirst = basket.filter((b) => MASTER.has(pairKey(c.code, b.p.code)));
      for (let i = 0; i < nl && picked.size < basket.length; i++) {
        const pool = i === 0 && masterFirst.length ? masterFirst : basket;
        let b;
        do b = fRng.weighted(pool, (x) => x.w);
        while (picked.has(b.p.code) && pool.length > picked.size);
        if (picked.has(b.p.code)) break;
        picked.add(b.p.code);
        lines.push({ prod: b.p.code, qty: qtyFor(b.p, c, fRng) });
      }
      slips.push({ date, cust: c.code, lines, tag: 'order' });
    }
  }
  for (const s of slips) {
    const c = CUST.get(s.cust);
    for (const L of s.lines) {
      const p = PROD.get(L.prod);
      const k = pairKey(c.code, p.code);
      const m = MASTER.get(k);
      const o = OUTCOMES.get(c.code);
      let price;
      let mode;
      const registered = NEXT_LIST.has(p.code) && s.date >= NEXT_EFF ? NEXT_LIST.get(p.code).nw : entryAt(p.list, s.date) ? entryAt(p.list, s.date).price : p.list[p.list.length - 1].price;
      if (m) {
        if (s.date >= m.eff) {
          const stale = c === fAll || (c === fUntil && s.date <= '2026-09-10') || randomOld.has(k);
          if (stale) [price, mode] = [m.oldPrice, 'still_old'];
          else [price, mode] = [m.newPrice, 'new'];
        } else [price, mode] = [m.oldPrice, 'before_eff'];
      } else {
        const sp = specialAtG(c.code, p.code, s.date);
        if (sp) [price, mode] = [sp.price, 'special'];
        else {
          const agreed = o && ['合意', '一部合意', '適用日変更'].includes(o.status) && !o.excluded.includes(p.cat) && s.date >= (o.date || '9999') && NEXT_LIST.has(p.code);
          const app = applicable(WG, c.key, p.key, '2026-08-31');
          const base = agreed ? NEXT_LIST.get(p.code).nw : (app.entry || app.reg).price;
          [price, mode] = [Math.floor((base * c.rate) / 1000), 'not_in_master'];
        }
      }
      let note = '';
      if (mode === 'new' && bigQty(p, L.qty) && fRng.chance(0.4)) {
        const d = fRng.pick([2, 3, 5]);
        const dp = Math.floor((price * (100 - d)) / 100);
        if (dp !== m.oldPrice) {
          price = dp;
          mode = 'new+disc';
          note = `数量値引${d}%`;
        }
      }
      Object.assign(L, { kind: 'sale', price, mode, note, ptype: mode === 'new+disc' ? 9 : 1, listCol: registered, costSen: entryAt(p.cost, '2026-06-30').sen, date: s.date, cust: s.cust });
    }
  }
  // 適用日前に新単価で請求（あいまい）2行
  {
    const c = fDefer[0];
    const ms = [...MASTER.entries()].filter(([k]) => k.startsWith(`${c.code}|`));
    for (const [k, m] of ms.slice(0, 2)) {
      const pc = k.split('|')[1];
      const p = PROD.get(pc);
      slips.push({ date: '2026-09-24', cust: c.code, tag: 'early_new', lines: [{ kind: 'sale', prod: pc, qty: qtyFor(p, c, fRng), price: m.newPrice, mode: 'early_new', note: '', ptype: 9, listCol: NEXT_LIST.get(pc).nw, costSen: entryAt(p.cost, '2026-06-30').sen, date: '2026-09-24', cust: c.code }] });
    }
  }
  // 運賃・見本品・返品
  for (const s of slips) {
    const c = CUST.get(s.cust);
    if (fRng.chance({ S: 0.02, A: 0.03, B: 0.1, C: 0.35, D: 0.45 }[c.rank])) s.lines.push({ kind: 'sale', prod: '9999', qty: 1, price: fRng.int(12, 90) * 50, mode: 'nonproduct', ptype: 9, note: '', date: s.date, cust: s.cust, listCol: 0, costSen: 0 });
  }
  for (const L of slips.flatMap((s) => s.lines)) if (L.prod === '9999') {
    L.listCol = L.price;
    L.costSen = Math.floor((L.price * 85) / 100) * 100;
  }
  for (const s of fRng.sample(slips, 4)) {
    const p = PROD.get(s.lines[0].prod);
    s.lines.push({ kind: 'sale', prod: p.code === PRODUCTS[0].code ? PRODUCTS[1].code : PRODUCTS[0].code, qty: 1, price: 0, mode: 'sample', ptype: 9, note: 'サンプル(無償)', date: s.date, cust: s.cust, listCol: PRODUCTS[0].list[PRODUCTS[0].list.length - 1].price, costSen: PRODUCTS[0].cost[PRODUCTS[0].cost.length - 1].sen });
  }
  const retSrc = fRng.sample(slips.flatMap((s) => s.lines.filter((l) => l.qty >= 2 && PROD.has(l.prod) && l.date <= '2026-09-22' && l.price > 0)), 10);
  const stillOldSrc = slips.flatMap((s) => s.lines.filter((l) => l.mode === 'still_old' && l.qty >= 2 && l.date <= '2026-09-22'));
  if (stillOldSrc.length) retSrc.push(stillOldSrc[0]);
  for (const o of retSrc) {
    let date = addDays(o.date, fRng.int(2, 7));
    while (!isBiz(date)) date = addDays(date, 1);
    slips.push({ date, cust: o.cust, tag: 'return', lines: [{ ...o, kind: 'return', qty: -1, mode: `return_of_${o.mode}`, note: '返品（破損）', date }] });
  }
  slips.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.cust !== b.cust ? (a.cust < b.cust ? -1 : 1) : 0));
  let nb = 62100001;
  for (const s of slips) {
    s.no = nb++;
    s.lines.forEach((l, i) => {
      l.slipNo = s.no;
      l.lineNo = i + 1;
      l.layout = 'B';
      l.file = 'next/sales_B_202609.csv';
      FOLLOW.push(l);
    });
  }
  FOLLOW.forEach((l, i) => {
    l.row = i + 1;
  });
  const frng = R('format-next');
  writeOut('next/sales_B_202609.csv', HEAD_B, FOLLOW.map((l) => rowB(l, frng)), { layout: 'B' });
  writeOut('next/list_prices_20260901.csv', ['商品コード', '商品名', '現定価(円)', '新定価(円)', '適用日'], [...NEXT_LIST.entries()].map(([code, v]) => [code, PROD.get(code).name, v.cur, v.nw, NEXT_EFF]));
  writeOut('next/revision_2026-09_outcomes.csv', ['得意先コード', '得意先名', '協議結果', '適用日', '対象外カテゴリ', '備考'], [...OUTCOMES.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([code, o]) => [code, CUST.get(code).name, o.status, o.date, o.excluded.join(';'), o.note]));
  const mrows = [...MASTER.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  writeOut('next/price_master_A_20260901.csv', ['得意先コード', '得意先名', '商品コード', '商品名', '適用開始日', '新単価', '現単価'], mrows.map(([k, m]) => {
    const [cc, pc] = k.split('|');
    const c = CUST.get(cc);
    return [fw(cc), c.name, codeA(pc, c.dept), fw(PROD.get(pc).name), reiwaShort(m.eff), comma(m.newPrice), comma(m.oldPrice)];
  }), { layout: 'A', bom: true, eol: '\r\n' });
  writeOut('next/price_master_B_20260901.csv', ['得意先CD', '品番', '適用開始日', '売単価', '旧売単価'], mrows.map(([k, m]) => {
    const [cc, pc] = k.split('|');
    return [String(+cc), pc, ymd8(m.eff), m.newPrice, m.oldPrice];
  }));
}
writeText('README.md', `# 検証用データ gen-2（架空）

このフォルダのファイルは、転嫁デスクの判定を確かめるために作った**架空の**データです。
会社名（${COMPANY.name}）・得意先名・仕入先名・商品・価格・取引はすべて作り物で、実在の企業・団体・人物・取引とは関係ありません。

- 業種：工業用部材・化学品の商社（架空）
- 売上明細：2024年7月〜2025年12月は販売管理A形式（${SALES_A}）、2026年1月〜6月は販売管理B形式（${SALES_B}、Shift_JIS）
- 前回の定価改定：2025年6月16日（得意先ごとの合意状況は revision_2025-06_agreements.csv）
- 粗利率の下限：${FLOOR_PCT}%
- next/：2026年9月1日の改定を想定した協議結果・新単価マスタと、2026年9月分の売上明細
`);

// ================================================================ 正解をつくる
const truthRows = [];
const mismatches = [];
const EXPECT = {
  correct: ['ok', 'ok_deferred', 'ok_declined', 'leak_below_margin_floor'],
  special: ['ok_special', 'leak_below_margin_floor'],
  old: ['leak_old_price'],
  expired: ['leak_expired_special'],
  manual_low: ['leak_rate_out_of_tier'],
  manual_high: ['leak_rate_out_of_tier'],
  wrong_rate: ['leak_rate_out_of_tier', 'leak_old_price'], // 誤った掛率の単価が、たまたま旧定価×掛率と同じになることがある（順番どおり反映漏れ）
  early_special: ['leak_rate_out_of_tier', 'ambiguous'],
  unexplained: ['ambiguous'],
  'correct+disc': ['ok_volume_discount', 'ambiguous'],
  'special+disc': ['ok_volume_discount', 'ambiguous'],
  'correct+decimal_disc': ['ambiguous'],
  nonproduct: ['ok_non_product'],
  sample: ['ok_sample'],
  zero_no_note: ['ambiguous'],
  cash: ['ambiguous'],
};
const lineKey = (L) => ({ date: L.date, cust: CUST.has(L.cust) ? CUST.get(L.cust).key : normCust(L.cust), prod: PROD.has(L.prod) ? PROD.get(L.prod).key : normProd(L.prod), qty: L.qty, price: L.price, note: L.note });
for (const L of ALL_LINES) {
  const r = classify(WG, lineKey(L));
  const exp = L.kind === 'return' ? ['ok_return'] : EXPECT[L.mode];
  if (!exp || !exp.includes(r.label)) {
    if (!(L.mode === 'correct' && r.label === 'ambiguous')) mismatches.push({ id: `${L.slipNo}-${L.lineNo}`, mode: L.mode, label: r.label, pattern: r.pattern, date: L.date, cust: L.cust, prod: L.prod, price: L.price, ref: r.reference });
  }
  L.truth = r;
  const last12 = L.date >= L12 && L.date <= END ? 1 : 0;
  truthRows.push([L.file, L.row, `${L.slipNo}-${L.lineNo}`, r.label, L.date, CUST.has(L.cust) ? L.cust : normCust(L.cust), PROD.has(L.prod) ? L.prod : L.prod, L.qty, L.price, r.reference, r.refKind, r.label.startsWith('leak_') ? r.shortfall : 0, r.belowFloor, r.floorPrice, last12, r.pattern || causeOf(L, r)]);
}
function causeOf(L, r) {
  if (!r.label.startsWith('leak_')) return '';
  const k = pairKey(L.cust, L.prod);
  if (r.label === 'leak_old_price') {
    if (LEAK.oldCust.has(L.cust)) return 'customer_wide_old_price';
    if (STALE.codes.includes(L.prod) && L.date <= STALE.to) return 'product_master_list_not_updated';
    if (LEAK.r2Cust.has(L.cust)) return 'later_revision_old_price';
    const op = LEAK.oldPair.get(k);
    if (op && op.rev === R0) return 'earlier_revision_old_price';
    if (op && op.rev === R2) return 'later_revision_old_price';
    return 'customer_price_not_updated';
  }
  if (r.label === 'leak_rate_out_of_tier') {
    if (LEAK.wrongRate.has(L.cust)) return 'customer_master_rate_wrong';
    if (LEAK.early.has(k)) return 'special_billed_before_start';
    const m = LEAK.manual.get(k);
    return m ? `manual_price_${m.kind}` : 'other';
  }
  if (r.label === 'leak_expired_special') return LEAK.expired.get(k)?.chain ? 'previous_period_special' : 'special_after_end';
  if (r.label === 'leak_below_margin_floor') {
    const sp = SPECIALS.find((s) => s.cust === L.cust && s.prod === L.prod && s.from <= L.date && (s.to === null || L.date <= s.to));
    if (sp) return sp.tag === 'below_floor' || sp.tag === 'floor_minus1' ? 'special_below_floor' : 'special_below_floor_after_cost_increase';
    return 'cost_increase_list_unchanged';
  }
  return '';
}
// 反映チェックの正解
const followRows = [];
function classifyFollow(M, L) {
  const P = WG.products.get(L.prod);
  if (!P) return { label: 'ok_non_product' };
  if (L.qty < 0) return { label: 'ok_return' };
  const note = (L.note || '').normalize('NFKC');
  if (L.price === 0) return /見本|サンプル/.test(note) ? { label: 'ok_sample' } : { label: 'ambiguous', pattern: 'AMB_ZERO_PRICE_WITHOUT_SAMPLE_NOTE' };
  const m = M.get(`${L.cust}|${L.prod}`);
  if (!m) return { label: 'not_in_master' };
  if (L.date >= m.eff) {
    if (L.price === m.newPrice) return { label: 'ok_new_price', expected: m.newPrice };
    if (L.price === m.oldPrice) return { label: 'still_old_price', expected: m.newPrice, shortfall: (m.newPrice - L.price) * L.qty };
    const dm = note.match(DISC_RE);
    if (dm && !dm[1].includes('.') && L.price === Math.floor((m.newPrice * (100 - +dm[1])) / 100)) return { label: 'ok_volume_discount', expected: m.newPrice };
    return { label: 'ambiguous', pattern: 'AMB_FOLLOWUP_OTHER_PRICE', expected: m.newPrice };
  }
  if (L.price === m.oldPrice) return { label: 'ok_before_effective', expected: m.oldPrice };
  if (L.price === m.newPrice) return { label: 'ambiguous', pattern: 'AMB_FOLLOWUP_NEW_PRICE_BEFORE_EFFECTIVE_DATE', expected: m.oldPrice };
  return { label: 'ambiguous', pattern: 'AMB_FOLLOWUP_OTHER_PRICE', expected: m.oldPrice };
}
const MW = new Map([...MASTER.entries()].map(([k, m]) => {
  const [cc, pc] = k.split('|');
  return [`${CUST.get(cc).key}|${PROD.get(pc).key}`, m];
}));
const FEXPECT = { new: ['ok_new_price'], still_old: ['still_old_price'], before_eff: ['ok_before_effective'], 'new+disc': ['ok_volume_discount'], not_in_master: ['not_in_master'], special: ['not_in_master'], nonproduct: ['ok_non_product'], sample: ['ok_sample'], early_new: ['ambiguous'] };
for (const L of FOLLOW) {
  const r = classifyFollow(MW, lineKey(L));
  const exp = L.kind === 'return' ? ['ok_return'] : FEXPECT[L.mode];
  if (!exp || !exp.includes(r.label)) mismatches.push({ id: `${L.slipNo}-${L.lineNo}`, mode: L.mode, label: r.label, follow: true });
  L.ftruth = r;
  followRows.push([L.file, L.row, `${L.slipNo}-${L.lineNo}`, r.label, L.date, L.cust, L.prod, L.qty, L.price, r.expected ?? '', r.shortfall ?? 0, r.pattern || '']);
}

// ================================================================ 読み直して確かめる（公開ファイルだけ・文書の正規化で）
function readCsvFile(path) {
  const buf = readFileSync(path);
  let text;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString('utf8');
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('shift_jis').decode(buf);
    }
  }
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
      rows.push(row);
      row = [];
      f = '';
    } else f += ch;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  const [h, ...data] = rows;
  return data.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
function normDate(s) {
  s = s.normalize('NFKC').trim();
  if (!s || s === '99991231') return null;
  let m = s.match(/^R(\d{1,2})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return isoOf(2018 + +m[1], +m[2], +m[3]);
  m = s.match(/^(令和|平成)(\d+|元)年(\d+)月(\d+)日$/);
  if (m) return isoOf((m[1] === '令和' ? 2018 : 1988) + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  throw new Error(`date ${s}`);
}
const num = (s) => +s.normalize('NFKC').replace(/,/g, '').trim();
const sen = (s) => Math.round(num(s) * 100);
function verifyFromFiles() {
  const rd = (f) => readCsvFile(join(OUT, f));
  const products = new Map();
  for (const r of rd('products.csv')) products.set(normProd(r['商品コード']), { cat: r['カテゴリコード'], list: [], cost: [] });
  for (const r of rd('list_price_history.csv')) products.get(normProd(r['商品コード'])).list.push({ price: num(r['定価(円)']), from: normDate(r['適用開始日']), to: normDate(r['適用終了日']) });
  for (const r of rd('cost_history.csv')) products.get(normProd(r['商品コード'])).cost.push({ sen: sen(r['原単価(円)']), from: normDate(r['適用開始日']), to: normDate(r['適用終了日']) });
  for (const p of products.values()) {
    p.list.sort((a, b) => (a.from < b.from ? -1 : 1));
    p.cost.sort((a, b) => (a.from < b.from ? -1 : 1));
  }
  const customers = new Map(rd('customers.csv').map((r) => [normCust(r['得意先コード']), { rank: r['掛率ランク'], rate: Math.round(num(r['掛率(%)']) * 10), start: normDate(r['取引開始日']) }]));
  const tiers = new Map(rd('rate_tiers.csv').map((r) => [r['掛率ランク'], { lo: Math.round(num(r['下限(%)']) * 10), hi: Math.round(num(r['上限(%)']) * 10) }]));
  const agreements = new Map();
  const dateCount = new Map();
  for (const r of rd('revision_2025-06_agreements.csv')) {
    const date = r['適用日'] ? normDate(r['適用日']) : null;
    agreements.set(normCust(r['得意先コード']), { status: r['合意状況'].trim(), date, excluded: r['対象外カテゴリ'].split(/[;；、,]/).map((x) => x.trim()).filter(Boolean) });
    if (date && r['合意状況'] === '合意') dateCount.set(date, (dateCount.get(date) || 0) + 1);
  }
  const r1 = [...dateCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const specials = new Map();
  const seen = new Set();
  const addSp = (c, p, price, from, to) => {
    const k = `${normCust(c)}|${normProd(p)}`;
    const id = `${k}|${price}|${from}|${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    if (!specials.has(k)) specials.set(k, []);
    specials.get(k).push({ price, from, to });
  };
  for (const r of rd('special_prices_A.csv')) addSp(r['得意先コード'], r['商品コード'], num(r['特値単価']), normDate(r['開始日']), normDate(r['終了日']));
  for (const r of rd('special_prices_B.csv')) addSp(r['得意先CD'], r['品番'], num(r['特価']), normDate(r['有効開始日']), normDate(r['有効終了日']));
  const W = { products, customers, tiers, agreements, specials, r1 };
  const truth = new Map(truthRows.map((t) => [t[2], t[3]]));
  let n = 0;
  const bad = [];
  for (const r of rd(SALES_A)) {
    const id = `${r['伝票番号']}-${r['行']}`;
    const qty = num(r['数量']);
    const L = { date: normDate(r['売上日']), cust: normCust(r['得意先コード']), prod: normProd(r['商品コード']), qty: r['取引区分'] === '返品' ? -Math.abs(qty) : qty, price: num(r['単価']), note: r['備考'] };
    const got = classify(W, L).label;
    if (got !== truth.get(id)) bad.push([id, got, truth.get(id)]);
    n++;
  }
  for (const r of rd(SALES_B)) {
    const id = `${r['伝票No']}-${r['明細No']}`;
    const qty = num(r['数量']);
    const L = { date: normDate(r['伝票日付']), cust: normCust(r['得意先CD']), prod: normProd(r['品番']), qty: r['売上区分'] === '2' ? -Math.abs(qty) : qty, price: num(r['売単価']), note: r['摘要'] };
    const got = classify(W, L).label;
    if (got !== truth.get(id)) bad.push([id, got, truth.get(id)]);
    n++;
  }
  // 反映チェック
  const M = new Map();
  for (const r of rd('next/price_master_B_20260901.csv')) M.set(`${normCust(r['得意先CD'])}|${normProd(r['品番'])}`, { eff: normDate(r['適用開始日']), newPrice: num(r['売単価']), oldPrice: num(r['旧売単価']) });
  const MA = new Map();
  for (const r of rd('next/price_master_A_20260901.csv')) MA.set(`${normCust(r['得意先コード'])}|${normProd(r['商品コード'])}`, { eff: normDate(r['適用開始日']), newPrice: num(r['新単価']), oldPrice: num(r['現単価']) });
  for (const [k, m] of M) {
    const a = MA.get(k);
    if (!a || a.eff !== m.eff || a.newPrice !== m.newPrice || a.oldPrice !== m.oldPrice) bad.push(['master', k]);
  }
  const ftruth = new Map(followRows.map((t) => [t[2], t[3]]));
  const saveP = WG.products;
  for (const r of rd('next/sales_B_202609.csv')) {
    const id = `${r['伝票No']}-${r['明細No']}`;
    const qty = num(r['数量']);
    const L = { date: normDate(r['伝票日付']), cust: normCust(r['得意先CD']), prod: normProd(r['品番']), qty: r['売上区分'] === '2' ? -Math.abs(qty) : qty, price: num(r['売単価']), note: r['摘要'] };
    WG.products = products;
    const got = classifyFollow(M, L).label;
    WG.products = saveP;
    if (got !== ftruth.get(id)) bad.push([id, got, ftruth.get(id)]);
    n++;
  }
  return { n, bad, r1 };
}

// ================================================================ 正解の書き出し（リポジトリの外だけ）
const TRUTH_DIR = join(SEALED, 'truth');
rmSync(TRUTH_DIR, { recursive: true, force: true });
mkdirSync(TRUTH_DIR, { recursive: true });
const truthText = (h, rows) => `${[csvLine(h), ...rows.map((r) => csvLine(r))].join('\n')}\n`;
writeFileSync(join(TRUTH_DIR, 'lines.csv'), truthText(['file', 'row', 'line_id', 'label', 'date', 'customer', 'product', 'qty', 'billed', 'reference', 'reference_kind', 'shortfall_yen', 'below_floor', 'floor_price', 'last12m', 'pattern'], truthRows));
writeFileSync(join(TRUTH_DIR, 'followup_lines.csv'), truthText(['file', 'row', 'line_id', 'label', 'date', 'customer', 'product', 'qty', 'billed', 'expected', 'shortfall_yen', 'pattern'], followRows));
const LEAK_TYPES = ['leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor'];
const count = (rows, pred) => {
  const m = {};
  for (const r of rows) if (pred(r)) m[r[3]] = (m[r[3]] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort());
};
const leakSummary = {};
for (const t of LEAK_TYPES) {
  const rs = truthRows.filter((r) => r[3] === t);
  const l12 = rs.filter((r) => r[14] === 1);
  const pairs = new Set(rs.map((r) => `${r[5]}|${normProd(r[6])}`));
  leakSummary[t] = {
    lines: rs.length,
    lines_last12m: l12.length,
    customer_product_pairs: pairs.size,
    shortfall_yen_last12m: l12.reduce((a, r) => a + r[11], 0),
    shortfall_yen_last12m_positive_lines_only: l12.reduce((a, r) => a + Math.max(0, r[11]), 0),
    lines_with_negative_shortfall: rs.filter((r) => r[11] < 0).length,
    shortfall_yen_all_period: rs.reduce((a, r) => a + r[11], 0),
    lines_also_below_floor: rs.filter((r) => r[12] === 1).length,
  };
}
const ambCounts = {};
for (const r of truthRows) if (r[3] === 'ambiguous') ambCounts[r[15]] = (ambCounts[r[15]] || 0) + 1;
const fAmb = {};
for (const r of followRows) if (r[3] === 'ambiguous') fAmb[r[11]] = (fAmb[r[11]] || 0) + 1;
const inputFiles = [];
const walk = (dir, rel = '') => {
  for (const f of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (f.isDirectory()) walk(join(dir, f.name), `${rel}${f.name}/`);
    else inputFiles.push(`${rel}${f.name}`);
  }
};
walk(OUT);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const summary = {
  note: 'gen-2（架空データ）の正解の集計。文書のルールだけから作ったもの。',
  period: { from: START, to: END, last12m: { from: L12, to: END } },
  revisions: { previous_revision_with_agreements: R1, other_list_changes: [R0, CUT, R2], next_revision_followup: NEXT_EFF },
  margin_floor_pct: FLOOR_PCT,
  sales_lines: { total: truthRows.length, by_file: count(truthRows.map((r) => [0, 0, 0, r[0]]), () => true), last12m: truthRows.filter((r) => r[14] === 1).length },
  labels: count(truthRows, () => true),
  labels_last12m: count(truthRows, (r) => r[14] === 1),
  leaks: leakSummary,
  total_shortfall_yen_last12m: Object.values(leakSummary).reduce((a, s) => a + s.shortfall_yen_last12m, 0),
  ambiguous_patterns: Object.fromEntries(Object.entries(ambCounts).sort()),
  customer_wide: {
    leak_old_price: [...LEAK.oldCust.entries()].map(([c, r]) => ({ customer: c, from: r.from, to: r.to })),
    leak_rate_out_of_tier: [...LEAK.wrongRate.entries()].map(([c, r]) => ({ customer: c, from: r.from, to: r.to, billed_rate_pct: r.rate / 10 })),
    later_revision_old_price_sv: [...LEAK.r2Cust.entries()].map(([c, r]) => ({ customer: c, from: r.from, to: r.to })),
    product_master_list_not_updated: STALE.codes.map((p) => ({ product: p, from: R1, to: STALE.to })),
  },
  followup: {
    file: 'next/sales_B_202609.csv',
    lines: followRows.length,
    labels: count(followRows, () => true),
    still_old_price_shortfall_yen: followRows.filter((r) => r[3] === 'still_old_price').reduce((a, r) => a + r[10], 0),
    still_old_price_pairs: new Set(followRows.filter((r) => r[3] === 'still_old_price').map((r) => `${r[5]}|${r[6]}`)).size,
    still_old_price_customers: new Set(followRows.filter((r) => r[3] === 'still_old_price').map((r) => r[5])).size,
    price_master_rows: MASTER.size,
    ambiguous_patterns: fAmb,
  },
  input_files: Object.fromEntries(inputFiles.map((f) => [f, { rows: written.find((w) => w[0] === f)?.[1] ?? null, sha256: sha(readFileSync(join(OUT, f))) }])),
};
writeFileSync(join(TRUTH_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

// ---------------------------------------------------------------- 注記（封印側）
{
  const a = summary.ambiguous_patterns;
  const fa = summary.followup.ambiguous_patterns;
  const n = (k) => a[k] || 0;
  const notes = `# gen-2 正解の注記（封印・架空データ）

生成器: \`portfolio-samples/tenka-desk/blind/gen-2/generate.mjs\`（固定シード・決定的）。
入力: \`blind-data/gen-2/\`。正解: この フォルダの \`truth/\`（\`lines.csv\`・\`followup_lines.csv\`・\`summary.json\`）。

参照した文書は README.md・README.en.md・data-gen/README.md と、public/sample/ と public/sample/next/ の各ファイルの先頭3行だけです。エンジンと data-gen の実装は読んでいません。正解は文書のルールを私が解釈したもので、その解釈を下にすべて書きます。

## truth/lines.csv の列

- \`file\`: 入力ファイル名（\`${SALES_A}\` または \`${SALES_B}\`）
- \`row\`: そのファイルのデータ行の番号（見出し行を除いて1から。ファイルの物理行番号は row+1）
- \`line_id\`: 伝票番号-行（A: 伝票番号-行、B: 伝票No-明細No）。2つのファイルで重複しません
- \`label\`: \`ok\` / \`ok_special\` / \`ok_deferred\` / \`ok_declined\` / \`ok_volume_discount\` / \`ok_return\` / \`ok_sample\` / \`ok_non_product\` / \`leak_old_price\` / \`leak_expired_special\` / \`leak_rate_out_of_tier\` / \`leak_below_margin_floor\` / \`ambiguous\`
- \`customer\` / \`product\`: 正規化前の正式コード（得意先は6桁、商品は商品マスタの表記。マスタにないコードはそのまま）
- \`reference\`: 正しい単価（期間内の特値、なければ 定価×掛率 切り捨て）。対象外の行は空
- \`shortfall_yen\`: 漏れの行だけ。反映漏れ・期限切れ・ランク外は（正しい単価−請求単価）×数量、粗利下限割れは（粗利10%の単価−請求単価）×数量
- \`below_floor\`: 請求単価で粗利率が10%未満なら1（漏れの種類にかかわらず）
- \`floor_price\`: 粗利10%になる単価 = 原単価÷0.9。**原単価はすべて0.9円（90銭）の倍数にしてあるので、端数は出ません**
- \`last12m\`: 2025-07-01〜2026-06-30 の行なら1
- \`pattern\`: あいまいな行はパターン名、漏れの行は埋め込んだ原因（集計用。判定には使わない）

## 判定の順番（文書どおり）

1. 商品マスタにないコード → ok_non_product、数量マイナス → ok_return、単価0で備考に「見本」「サンプル」（NFKC後）→ ok_sample
2. 正しい単価 = 期間内の特値（開始日・終了日を含む）、なければ 定価×得意先マスタの掛率（円未満切り捨て）。定価は前回改定（2025-06-16）の合意状況で決まる、その得意先に適用すべき定価
3. 請求 = 正しい単価 → 正常（特値なら ok_special、適用日の後ろ倒しの期間なら ok_deferred、見送り・据え置きカテゴリで旧定価なら ok_declined）。ただし粗利率が10%**未満**なら leak_below_margin_floor（ちょうど10%は正常）
4. 備考に「数量値引N%」「まとめ買いN%引」（全角も NFKC で同じ）があり、正しい単価×(100−N)% の切り捨てと同じ → ok_volume_discount
5. 旧定価×掛率と同じ → leak_old_price（旧定価 = 今の定価より前の期間の定価のどれか、ただし今より安いもの）
6. 終了日を過ぎた特値と同じ → leak_expired_special
7. 定価×ランクの下限・上限（それぞれ切り捨て）の外 → leak_rate_out_of_tier
8. それ以外 → 文書では「原因不明の価格差」。ラベルがないので ambiguous にしました

## 文書から決めたこと（あいまいとはしなかったが、解釈が入っているもの）

- **改定が3回ある**: 2024-10-01（研磨材だけ・合意状況ファイルなし）、2025-06-16（前回改定・合意状況あり・月の途中）、2026-03-01（溶剤すべて＋樹脂12品目の再改定・合意状況ファイルなし）。合意状況ファイルのない改定は全得意先に定価表どおり適用とみなし、旧単価のままなら leak_old_price にしました（ただし見送り・据え置きの得意先は下のあいまいへ）
- 樹脂12品目は 2023年→2025-06-16→2026-03-01 と2回上がっています。合意した得意先が2026-03-01以降に2025年の単価で請求 → leak_old_price
- 定価の値下げ（2025-11-01、シール4品目）があります。値下げ後に下がった定価で請求している行は ok。旧（高い）定価のまま請求する行は今回は入れていません
- 販売管理の商品マスタの定価が改定後も旧定価のままだった商品（3品目、2025-06-16〜07-10）は、売上明細の「定価」列にも旧定価が出ています。判定は定価履歴（list_price_history.csv）を使うので、合意した得意先の行は leak_old_price です（明細の「定価」列は使わない）
- 「合意に至らず」は「見送り」と同じ扱い（ok_declined）。README の崩れたサンプルの説明から、同じ意味の表記として扱われると読みました
- 合意状況「対象外(改定後に取引開始)」の得意先は定価表どおり
- 「適用日変更」「合意」で適用日が 2025-06-16 より後 → その日の前は旧定価が正しい（ok_deferred）。月の途中の日付（07-21、09-16）を含みます
- 特値の終了日は含む（終了日当日の特値は ok_special、翌営業日の特値は leak_expired_special）。開始日も含む
- 特値が更新されて新しい特値の期間に入っているのに、前の期間の特値で請求 → leak_expired_special（不足額は新しい特値との差）
- 特値の開始日より前に特値で請求 → 特値はまだ「期間内」でも「期限切れ」でもないので、ルールどおりランクの範囲で判定（ランク外）
- A形式の特値一覧で期限なしの特値は終了日を空欄にしました（B形式は文書どおり 99991231）。平成31年4月1日開始の特値が1件あります
- 返品は数量マイナスなので ok_return。漏れていた行の返品もあります（元の漏れの行の不足額は返品で差し引いていません。文書の式どおり行ごとの金額）
- ランク上限より上の請求（${summary.leaks.leak_rate_out_of_tier.lines_with_negative_shortfall}行）は leak_rate_out_of_tier で、不足額はマイナスです。summary.json には差し引きの合計と、プラスの行だけの合計の両方を入れました
- 販売管理の得意先マスタの掛率を誤った単価が、たまたま「旧定価×正しい掛率」と同じになった行は、判定の順番どおり leak_old_price
- 商品マスタにない商品らしいコード（廃番の2コード）も ok_non_product
- 粗利率の判定は、その日の原単価（cost_history.csv、売上明細の原単価と同じ値）を使います。下限は demo_settings.json の marginFloorPct=10。demo_settings.json のほかのキー名は推測です（サンプルの先頭3行で確かめられたのは note と marginFloorPct だけ）
- 直近12か月は、データの最後の月（2026年6月）までの12か月

## あいまい（ambiguous）にしたパターン

| パターン | 行 | 内容と、文書で決まらない理由 |
|---|---:|---|
| AMB_NO_AGREEMENT_ROW | ${n('AMB_NO_AGREEMENT_ROW')} | 改定前から取引があるのに合意状況ファイルに行がない得意先（1社）が、2025-06-16 以降に改定対象の商品を買った行。合意とみなすか、未回答（旧価格のまま）とみなすかが文書にない。請求は新定価×掛率 |
| AMB_HELD_PRICE_AND_LATER_LIST_CHANGE | ${n('AMB_HELD_PRICE_AND_LATER_LIST_CHANGE')} | 前回改定を「見送り」た得意先が、その後の別の改定（2026-03-01 の溶剤）の対象品を改定後に買った行。見送りが後の改定にも及ぶのか（旧定価のまま）、後の改定は定価表どおりなのかが文書にない。請求は組ごとに旧・新のどちらか |
| AMB_HELD_PRICE_BUT_NO_LIST_BEFORE_REVISION | ${n('AMB_HELD_PRICE_BUT_NO_LIST_BEFORE_REVISION')} | 「見送り」の得意先が、前回改定より後に発売された商品を買った行。見送りの得意先に使う「旧定価」がその商品には存在しない。請求は今の定価×掛率 |
| AMB_UNEXPLAINED_PRICE_INSIDE_TIER | ${n('AMB_UNEXPLAINED_PRICE_INSIDE_TIER')} | 手入力の単価が、正しい単価とも旧単価・期限切れ特値とも違うがランクの範囲内（3組）。文書のルール8「原因不明の価格差」に当たるが、ラベルがなく漏れに数えるかも書かれていない |
| AMB_VOLUME_DISCOUNT_BELOW_FLOOR | ${n('AMB_VOLUME_DISCOUNT_BELOW_FLOOR')} | 数量値引の計算は合っているが、値引き後の粗利率が10%未満。データ生成の手順（ルール3の後にルール4）では数量値引で正常、README の「1行に複数の問題があるときは…粗利下限割れの順で1つに数える」では粗利下限割れとも読める |
| AMB_DECIMAL_DISCOUNT_RATE | ${n('AMB_DECIMAL_DISCOUNT_RATE')} | 備考が「数量値引2.5%」。例は整数だけで、小数の値引率を読むか（97.5%で計算は合う）が文書にない |
| AMB_CUSTOMER_NOT_IN_MASTER | ${n('AMB_CUSTOMER_NOT_IN_MASTER')} | 得意先コード 999999「諸口（現金売上）」。得意先マスタにないので掛率・ランクがない。対象外にするかどうかが文書にない（商品マスタにないコードは対象外と書かれているが、得意先については書かれていない）。請求は定価そのまま |
| AMB_ZERO_PRICE_WITHOUT_SAMPLE_NOTE | ${n('AMB_ZERO_PRICE_WITHOUT_SAMPLE_NOTE')} | 単価0だが備考に「見本」「サンプル」がない（「販促品（無償提供）」または空欄）。ルールを機械的に当てるとランク外の漏れになるが、無償品の書き方の違いにすぎない可能性がある |

反映チェック（truth/followup_lines.csv）:

| パターン | 行 | 内容 |
|---|---:|---|
| AMB_FOLLOWUP_NEW_PRICE_BEFORE_EFFECTIVE_DATE | ${fa.AMB_FOLLOWUP_NEW_PRICE_BEFORE_EFFECTIVE_DATE || 0} | 適用開始日（2026-10-01）より前に新単価で請求。文書は「適用開始日以降に旧単価」しか定義していない |

## 金額（summary.json）

- \`leaks.<種類>.shortfall_yen_last12m\` が文書の「直近12か月の影響額」。合計は \`total_shortfall_yen_last12m\`
- ランク外には上限超え（マイナス）の行があるので \`shortfall_yen_last12m_positive_lines_only\` も入れました
- 反映チェックの不足額は（新単価−請求単価）×数量

## 文書だけでは決まらなかったルール（まとめ）

1. 合意状況ファイルに載っていない、改定前からの得意先の扱い
2. 「見送り」「一部合意（据え置きカテゴリ）」が、そのあとの別の改定や、改定後に発売された商品にも及ぶか
3. 合意状況ファイルのない改定（前々回・次の小改定）を全得意先に適用するか（今回は適用すると解釈）
4. 原因不明の価格差（ルール8）を漏れに数えるか、どのラベルにするか
5. 数量値引の行が同時に粗利下限を割るときの優先順位（data-gen の手順と README の書き方が違って読める）
6. 小数の値引率、値引の書き方の別表記（「大口値引」など）を数量値引とみなすか
7. 得意先マスタにない得意先（諸口）の扱い
8. 単価0で備考に見本・サンプルの記載がない行
9. ランク上限を超える請求（不足額マイナス）を影響額に含めるか
10. 漏れていた行の返品を影響額から差し引くか
11. 粗利10%の単価の端数処理（今回は原単価を90銭の倍数にして避けた）
12. A形式の特値一覧で期限なしをどう書くか（空欄にした）
13. 定価の値下げ後も旧（高い）定価で請求している行の扱い（今回は入れていない）
14. demo_settings.json のキー名（marginFloorPct 以外）
`;
  writeFileSync(join(SEALED, 'notes.md'), notes);
}

const v = verifyFromFiles();
console.log(`products ${PRODUCTS.length}, customers ${CUSTOMERS.length}, specials ${SPECIALS.length}, agreements ${AG.size}`);
console.log(`sales lines ${truthRows.length} (A ${truthRows.filter((r) => r[0] === SALES_A).length} / B ${truthRows.filter((r) => r[0] === SALES_B).length}), followup ${followRows.length}, master ${MASTER.size}`);
console.log('labels', JSON.stringify(summary.labels));
console.log('leaks', JSON.stringify(leakSummary));
console.log('ambiguous', JSON.stringify(summary.ambiguous_patterns));
console.log('followup', JSON.stringify(summary.followup.labels), summary.followup.still_old_price_shortfall_yen);
console.log(`intent mismatches: ${mismatches.length}`);
for (const m of mismatches.slice(0, 25)) console.log('  ', JSON.stringify(m));
console.log(`re-read check: ${v.n} lines, ${v.bad.length} differences, r1=${v.r1}`);
for (const b of v.bad.slice(0, 10)) console.log('  ', JSON.stringify(b));
if (v.bad.length) process.exitCode = 1;
