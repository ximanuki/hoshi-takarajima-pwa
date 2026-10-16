#!/usr/bin/env node
// 転嫁デスク 独立ブラインド検証データ gen-1（すべて架空）
//
// data-gen/README.md と README.md に書かれたルールだけを読んで、エンジンとは独立に書いた生成器。
// 固定シード・時計なし・Math.random なし。何度実行しても同じバイト列になる。
//
//   node generate.mjs --data <入力ファイルの出力先> --sealed <正解の出力先> [--utf8]
//
// 正解（truth/）はリポジトリの外に置くこと。--utf8 を付けると売上明細を UTF-8 で書く（既定は Shift_JIS・CRLF）。

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- 引数
function parseArgs(argv) {
  const o = { data: null, sealed: null, utf8: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') o.data = argv[++i];
    else if (a === '--sealed') o.sealed = argv[++i];
    else if (a === '--utf8') o.utf8 = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.data || !o.sealed) {
    console.error('usage: node generate.mjs --data <dir> --sealed <dir> [--utf8]');
    process.exit(2);
  }
  return o;
}

// ---------------------------------------------------------------- 乱数（固定シード）
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
class Rng {
  constructor(name) {
    this.f = mulberry32(hashSeed(`tenka-blind-gen1/${name}`));
  }
  next() {
    return this.f();
  }
  int(a, b) {
    return a + Math.floor(this.f() * (b - a + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.f() * arr.length)];
  }
  chance(p) {
    return this.f() < p;
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ---------------------------------------------------------------- 日付（日番号 = 1970-01-01 からの日数）
const DAY = 86400000;
const dn = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY);
const ymd = (n) => {
  const t = new Date(n * DAY);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};
const p2 = (x) => String(x).padStart(2, '0');
const iso = (n) => {
  const [y, m, d] = ymd(n);
  return `${y}-${p2(m)}-${p2(d)}`;
};
const compact = (n) => iso(n).replaceAll('-', '');
const slashDate = (n) => {
  const [y, m, d] = ymd(n);
  return `${y}/${m}/${d}`;
};
const parseIso = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return dn(y, m, d);
};
const weekday = (n) => (((n + 4) % 7) + 7) % 7; // 0=日
const INF = 10 ** 9;

const START = dn(2025, 1, 1);
const END = dn(2026, 6, 30);
const L12_FROM = dn(2025, 7, 1);
const BASE_FROM = dn(2024, 4, 1);
const R1 = dn(2025, 4, 16); // 一斉改定（月の途中・合意記録なし）
const R2 = dn(2025, 10, 1); // 前回改定（合意状況ファイルあり）
const R3 = dn(2026, 4, 1); // 一斉改定（菓子のみ・合意記録なし）
const CUT = dn(2026, 3, 1); // 定価の値下げ（飲料3品）
const NEWPROD = dn(2025, 9, 1); // 新商品の発売
const CN_COST_UP = dn(2026, 1, 1);
const YU_COST_UP = dn(2026, 2, 16); // 仕入値上げ（月の途中・定価据え置き）
const WHOLE_R2_FIX = dn(2026, 1, 21);
const WRONG_RATE_FIX = dn(2026, 3, 1);
const RED_BLACK_NOTE = '単価訂正';

function isHoliday(n) {
  const [, m, d] = ymd(n);
  return (m === 1 && d <= 3) || (m === 8 && d >= 13 && d <= 15) || (m === 12 && d === 31);
}
const isBusinessDay = (n) => weekday(n) !== 0 && !isHoliday(n);

// ---------------------------------------------------------------- 文字
const nfkc = (s) => s.normalize('NFKC');
const HALF = (() => {
  const m = new Map();
  for (let c = 0xff61; c <= 0xff9f; c++) {
    const h = String.fromCharCode(c);
    const f = h.normalize('NFKC');
    if (f.length === 1 && f !== h) m.set(f, h);
  }
  for (let c = 0xff66; c <= 0xff9d; c++) {
    const h = String.fromCharCode(c);
    for (const mark of ['ﾞ', 'ﾟ']) {
      const f = (h + mark).normalize('NFKC');
      if (f.length === 1) m.set(f, h + mark);
    }
  }
  return m;
})();
function toHalfKana(s) {
  let o = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    o += c >= 0x30a0 && c <= 0x30ff && HALF.has(ch) ? HALF.get(ch) : ch;
  }
  return o;
}
// 文書どおりの正規化（突き合わせ・再読込の確認用）
const normCode = (s) =>
  nfkc(s)
    .toUpperCase()
    .replace(/[\s\-‐‑‒–—―−ー－ｰ]/g, '');
const normCust = (s) => nfkc(s).replace(/[^0-9]/g, '').padStart(6, '0');

// ---------------------------------------------------------------- Shift_JIS エンコーダ（WHATWG のデコード表から逆引き）
function buildSjis() {
  const dec = new TextDecoder('shift_jis');
  const m = new Map();
  for (let b = 0; b < 0x80; b++) m.set(String.fromCharCode(b), [b]);
  for (let b = 0xa1; b <= 0xdf; b++) m.set(dec.decode(Uint8Array.of(b)), [b]);
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const l of leads) {
    for (let t = 0x40; t <= 0xfc; t++) {
      if (t === 0x7f) continue;
      const s = dec.decode(Uint8Array.of(l, t));
      if (s.length === 1 && s !== '�' && !m.has(s)) m.set(s, [l, t]);
    }
  }
  return m;
}
function encodeSjis(str, table) {
  const out = [];
  for (const ch of str) {
    const b = table.get(ch);
    if (!b) throw new Error(`Shift_JIS にない文字: ${ch} (U+${ch.codePointAt(0).toString(16)})`);
    out.push(...b);
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- CSV・数値
const csvField = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const csvText = (rows, eol = '\n') => rows.map((r) => r.map(csvField).join(',')).join(eol) + eol;
function parseCsv(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f !== '' || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows;
}
const sep3 = (n) => {
  const neg = n < 0;
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + s;
};
const senStr = (sen) => {
  const neg = sen < 0;
  const a = Math.abs(sen);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${p2(a % 100)}`;
};
const senStrExcel = (sen) => {
  // Excel で開いて保存したときの見え方：末尾の0が落ち、千の位に区切りが入る
  const neg = sen < 0;
  const a = Math.abs(sen);
  let s = sep3(Math.floor(a / 100));
  const frac = a % 100;
  if (frac) s += `.${p2(frac)}`.replace(/0$/, '');
  return (neg ? '-' : '') + s;
};
const floorMul = (price, rate10) => Math.floor((price * rate10) / 1000); // rate10: 0.1%単位
const roundHalfUpDiv = (num, den) => {
  const s = num < 0 ? -1 : 1;
  return s * Math.floor((Math.abs(num) + den / 2) / den);
};
const listUnit = (x) => (x < 1000 ? 10 : x < 10000 ? 50 : 100);
const roundListNearest = (x) => {
  const u = listUnit(x);
  return Math.max(u, Math.round(x / u) * u);
};
// 改定時は切り上げ：old × (1000 + inc10) / 1000 を単位に切り上げ
const raiseList = (old, inc10) => {
  const num = old * (1000 + inc10);
  const u = listUnit(num / 1000);
  return Math.ceil(num / (1000 * u)) * u;
};
const round90 = (sen) => Math.max(90, 90 * Math.round(sen / 90)); // 原単価は 0.9円の倍数（粗利10%の単価が整数円になる）

// ---------------------------------------------------------------- 架空の会社・マスタ
const COMPANY = {
  note: 'すべて架空のデータです。実在の企業・団体・人物とは関係ありません。',
  name: '架空みなと食品株式会社',
  postalCode: '000-0000',
  address: '神奈川県架空市みなと町1-2-3(架空)',
  tel: '000-0000-0000',
  representative: '代表取締役 架空 太郎',
  prefecture: '神奈川県',
};

const TIERS = [
  ['S', '二次卸・問屋', 600, 580, 620, '再販する取引先'],
  ['A', '量販・チェーン本部', 680, 660, 700, '年間取引額の大きい量販'],
  ['B', '外食チェーン・中食', 740, 720, 760, '多店舗の外食・惣菜'],
  ['C', '給食・病院・ホテル', 790, 770, 810, '施設・宿泊の厨房'],
  ['D', '個人飲食店', 855, 830, 880, '個人経営の飲食店'],
  ['E', 'スポット・小口', 920, 900, 950, '不定期・小口の取引'],
];
const TIER = new Map(TIERS.map(([code, name, std, low, high]) => [code, { code, name, std, low, high }]));

const CATS = [
  ['CS', '調味料', 55, 15, 12, 18, '大豆・小麦・砂糖', 2101, 60],
  ['YU', '油脂・粉', 70, 8, 12, 10, '菜種・大豆・小麦', 3101, 35],
  ['FZ', '冷凍食品', 50, 20, 18, 12, '鶏肉・水産物・野菜', 4101, 70],
  ['DR', '清涼飲料・茶', 40, 10, 15, 35, '茶葉・果汁・容器', 5101, 55],
  ['KM', '乾麺・米・乾物', 60, 15, 12, 13, '小麦・米・海産物', 6101, 35],
  ['CN', '缶詰・瓶詰', 45, 15, 15, 25, '農水産物・缶材', 7101, 40],
  ['DY', '乳製品・チルド', 60, 15, 15, 10, '生乳・鶏卵・豚肉', 8101, 40],
  ['KS', '菓子・製菓材料', 50, 20, 12, 18, 'カカオ・砂糖・ナッツ', 9101, 40],
  ['PK', '包材・消耗品', 55, 10, 20, 15, '樹脂・紙・竹', 1101, 25],
].map(([code, name, mat, lab, ene, oth, raw, base, count]) => ({ code, name, mat, lab, ene, oth, raw, base, count }));
const CAT = new Map(CATS.map((c) => [c.code, c]));

const SUPPLIERS = [
  ['S101', '月見ヶ原醸造株式会社', 'CS'],
  ['S102', '銀杏坂製油株式会社', 'YU'],
  ['S103', '風車谷製粉株式会社', 'YU;KM'],
  ['S104', '雪見台フローズン株式会社', 'FZ'],
  ['S105', 'うたかた飲料株式会社', 'DR'],
  ['S106', '星見浦缶詰株式会社', 'CN'],
  ['S107', '牧草ヶ丘乳業株式会社', 'DY'],
  ['S108', '綿菓子山製菓株式会社', 'KS'],
  ['S109', '紙風船資材株式会社', 'PK'],
  ['S110', '夜霧ソース工業株式会社', 'CS'],
  ['S111', '流星水産加工株式会社', 'FZ'],
  ['S112', '鈴鳴り茶園株式会社', 'DR'],
];

// 品目（名前|単位|おおよその定価）
const ITEMS = {
  CS: `濃口しょうゆ 1L ペット|本|430
濃口しょうゆ 1.8L ペット|本|680
濃口しょうゆ 18L 缶|缶|6200
淡口しょうゆ 1.8L ペット|本|720
減塩しょうゆ 1L ペット|本|520
白だし 1L|本|840
白だし 1.8L|本|1350
めんつゆ 3倍濃縮 1.8L|本|890
米酢 1.8L|本|780
穀物酢 1.8L|本|520
穀物酢 20L|缶|4900
本みりん 1.8L|本|1080
みりん風調味料 1.8L|本|480
料理酒 1.8L|本|620
上白糖 1kg|袋|270
上白糖 20kg|袋|4700
グラニュー糖 1kg|袋|290
食塩 1kg|袋|120
食塩 25kg|袋|2300
中濃ソース 2.1kg|本|990
ウスターソース 2.1kg|本|960
とんかつソース 2.1kg|本|1050
トマトケチャップ 3.3kg|本|1480
マヨネーズ 1kg|本|790
焼肉のたれ 2.2kg|本|1650
ぽん酢 1.8L|本|1190
ごまドレッシング 1L|本|1060
和風ドレッシング 1L|本|890
オイスターソース 1kg|本|1290
豆板醤 1kg|缶|1160
鶏がらスープの素 1kg|袋|1880
顆粒和風だし 1kg|袋|2250
合わせみそ 1kg|袋|490
合わせみそ 10kg|樽|4150
白みそ 1kg|袋|570
赤みそ 1kg|袋|530
カレールウ 業務用 1kg|箱|1120
顆粒コンソメ 1kg|袋|2450`,
  YU: `キャノーラ油 1kg|本|490
キャノーラ油 16.5kg 缶|缶|6900
サラダ油 1.5kg|本|570
サラダ油 16.5kg 缶|缶|7300
ごま油 1.65kg 缶|缶|1980
オリーブオイル 1L|本|1490
揚げ油 長持ちタイプ 16.5kg|缶|7700
米油 16.5kg 缶|缶|8400
バター風味オイル 1kg|本|1060
ラード 2kg|個|1060
ショートニング 2kg|個|1160
マーガリン 業務用 5kg|箱|4250
天ぷら粉 1kg|袋|390
天ぷら粉 10kg|袋|3350
薄力粉 1kg|袋|230
薄力粉 25kg|袋|4350
強力粉 25kg|袋|4750
生パン粉 2kg|袋|690
乾燥パン粉 1kg|袋|430
片栗粉 1kg|袋|390
片栗粉 25kg|袋|8000
から揚げ粉 1kg|袋|770
お好み焼き粉 1kg|袋|540
たこ焼き粉 1kg|袋|560`,
  FZ: `鶏もも唐揚げ 1kg|袋|1290
鶏むね唐揚げ 1kg|袋|1090
手作り風コロッケ 60g×20個|袋|990
カニクリームコロッケ 50g×20個|袋|1190
メンチカツ 80g×10個|袋|1090
ロースとんかつ 120g×10枚|袋|2350
アジフライ 10枚|袋|920
白身魚フライ 10枚|袋|1060
えび天ぷら 20尾|袋|2450
むきえび 1kg|袋|2650
いかリング 1kg|袋|1260
フライドポテト 1kg|袋|430
フライドポテト 皮付き 2kg|袋|800
冷凍うどん 5玉|袋|390
冷凍そば 5玉|袋|450
冷凍ラーメン 5玉|袋|480
冷凍ほうれん草 500g|袋|270
ミックスベジタブル 1kg|袋|430
冷凍枝豆 500g|袋|330
冷凍ブロッコリー 500g|袋|350
冷凍いんげん 500g|袋|310
ぎょうざ 50個|袋|1160
しゅうまい 30個|袋|990
春巻き 20本|袋|1150
ハンバーグ 100g×10個|袋|1360
チキン南蛮 10枚|袋|1680
たこ焼き 50個|袋|990
冷凍チャーハン 1kg|袋|690
冷凍ピラフ 1kg|袋|720
大学いも 1kg|袋|880
冷凍ピザ 8インチ 5枚|袋|1550
冷凍ケーキ チョコ 1台|個|1850
冷凍ケーキ チーズ 1台|個|1950
焼きおにぎり 10個|袋|590
冷凍さば切身 10切|袋|1480
冷凍鮭切身 10切|袋|1980
肉だんご 1kg|袋|890
冷凍だし巻き卵 500g|本|680
冷凍とろろ 500g|袋|590
冷凍カットオクラ 500g|袋|420`,
  DR: `緑茶 500ml ×24本|ケース|2400
緑茶 2L ×6本|ケース|1260
ほうじ茶 500ml ×24本|ケース|2400
麦茶 2L ×6本|ケース|1050
ウーロン茶 2L ×6本|ケース|1180
ジャスミン茶 500ml ×24本|ケース|2500
天然水 500ml ×24本|ケース|1650
天然水 2L ×6本|ケース|880
炭酸水 500ml ×24本|ケース|2050
ジンジャーエール 500ml ×24本|ケース|2700
オレンジジュース 1L ×6本|ケース|1750
りんごジュース 1L ×6本|ケース|1700
野菜ジュース 1L ×6本|ケース|1800
スポーツドリンク 500ml ×24本|ケース|2550
缶コーヒー 微糖 185g ×30本|ケース|2850
缶コーヒー ブラック 185g ×30本|ケース|2850
アイスコーヒー 無糖 1L ×12本|ケース|2950
紅茶 無糖 500ml ×24本|ケース|2350
乳酸菌飲料 希釈用 1L|本|990
梅シロップ 希釈用 1L|本|1250
カフェオレベース 1L|本|880
トマトジュース 190g ×30缶|ケース|2650
ラムネ風炭酸 200ml ×30本|ケース|2900
コーラ風炭酸 500ml ×24本|ケース|2650
レモン炭酸 500ml ×24本|ケース|2650
抹茶ラテ用パウダー 500g|袋|1450
ココア 業務用 1kg|袋|1650
インスタントコーヒー 500g|袋|2450
ドリップコーヒー粉 1kg|袋|2150
ティーバッグ 緑茶 100袋|箱|790
ティーバッグ 紅茶 100袋|箱|890
甘酒 1L ×6本|ケース|2350
豆乳 1L ×6本|ケース|1550
経口補水風飲料 500ml ×24本|ケース|3050
麦茶ティーバッグ 50袋|袋|480`,
  KM: `乾燥うどん 1kg|袋|420
乾燥そば 1kg|袋|560
そうめん 1kg|袋|520
中華麺 乾燥 1kg|袋|480
スパゲッティ 1.7mm 5kg|袋|1680
スパゲッティ 1.7mm 1kg|袋|380
ペンネ 1kg|袋|450
マカロニ 1kg|袋|400
精米 国産ブレンド 10kg|袋|4900
精米 国産ブレンド 30kg|袋|14200
無洗米 10kg|袋|5300
もち米 10kg|袋|5600
春雨 1kg|袋|690
乾燥わかめ 500g|袋|1350
日高昆布 1kg|袋|3200
かつお削り節 500g|袋|1950
煮干し 1kg|袋|1650
干ししいたけ 500g|袋|2850
切り干し大根 1kg|袋|1250
ひじき 500g|袋|1450
焼きのり 全形 100枚|袋|2650
白ごま 1kg|袋|1350
黒ごま 1kg|袋|1450
きざみのり 500g|袋|1850
フェットチーネ 1kg|袋|590
ビーフン 1kg|袋|640
冷麦 1kg|袋|500`,
  CN: `ホールトマト缶 2550g|缶|890
カットトマト缶 2550g|缶|920
スイートコーン缶 2kg|缶|780
ツナ油漬缶 1.7kg|缶|3850
さば水煮缶 190g|缶|260
みかん缶 1号缶|缶|1150
白桃缶 1号缶|缶|1550
パイン缶 1号缶|缶|1250
マッシュルーム缶 850g|缶|690
デミグラスソース缶 3kg|缶|1290
ホワイトソース缶 3kg|缶|1180
たけのこ水煮 1kg|袋|990
なめたけ 瓶 400g|本|470
鮭フレーク 瓶 500g|本|1350
らっきょう漬 1kg|袋|1150
福神漬 1kg|袋|690
梅干し 1kg|袋|2250
味付けメンマ 1kg|袋|990
ザーサイ 1kg|袋|1090
ガルバンゾー缶 2kg|缶|880
キドニービーンズ缶 2kg|缶|920
ミートソース缶 3kg|缶|1350
焼き鳥缶 業務用 1kg|缶|1980
フルーツミックス缶 1号缶|缶|1350
オリーブ 瓶 900g|本|1550
ピクルス 瓶 1kg|本|1150
いちごジャム 1kg|缶|1080
マーマレード 1kg|缶|1050
はちみつ 1kg|本|2150`,
  DY: `牛乳 1L ×12本|ケース|2650
生クリーム 35% 1L|本|1260
生クリーム 47% 1L|本|1680
ホイップ用植物性クリーム 1L|本|790
無塩バター 450g|個|1290
有塩バター 450g|個|1250
スライスチーズ 1kg|袋|1580
シュレッドチーズ 1kg|袋|1880
モッツァレラ 1kg|袋|2150
クリームチーズ 1kg|個|1980
プレーンヨーグルト 1kg|個|430
絹豆腐 業務用 1丁|丁|190
厚揚げ 10枚|袋|590
油揚げ 20枚|袋|540
鶏卵 M 10kg|箱|3850
液卵 全卵 1kg|袋|890
ロースハム スライス 500g|袋|1350
ベーコン スライス 1kg|袋|1690
ウインナー 1kg|袋|1360
焼豚 スライス 500g|袋|1480
かまぼこ 業務用 1本|本|390
ちくわ 30本|袋|690
はんぺん 10枚|袋|590
こんにゃく 1kg|袋|230
納豆 50g ×50個|ケース|1950
温泉卵 50個|ケース|1850
カスタードクリーム 1kg|袋|1150
粉チーズ 1kg|袋|2650`,
  KS: `業務用ミルクチョコレート 1kg|袋|1880
ビターチョコレート 1kg|袋|2050
ココアパウダー 1kg|袋|1480
アーモンドスライス 1kg|袋|2350
くるみ 1kg|袋|2650
こしあん 1kg|袋|690
つぶあん 1kg|袋|680
きなこ 1kg|袋|890
白玉粉 1kg|袋|1150
粉寒天 500g|袋|2250
粉ゼラチン 1kg|袋|3150
ベーキングパウダー 1kg|袋|990
ホットケーキミックス 1kg|袋|490
個包装クッキー 100枚|箱|2150
個包装せんべい 100枚|箱|1950
一口ゼリー 100個|袋|1450
ミニどら焼き 20個|袋|1050
棒付きキャンディ 100本|袋|1180
ラムネ菓子 100個|袋|950
ポップコーン豆 1kg|袋|690
チョコチップ 1kg|袋|1650
カラースプレー 500g|袋|890
製菓用グラニュー糖 1kg|袋|320
粉糖 1kg|袋|450
抹茶パウダー 500g|袋|3650
メープル風シロップ 1L|本|1250
バニラエッセンス 500ml|本|1550`,
  PK: `竹割り箸 100膳|袋|290
アスペン割り箸 100膳|袋|230
紙おしぼり 100本|袋|390
ポリ手袋 100枚|箱|190
ニトリル手袋 100枚|箱|890
ラップ 30cm×100m|本|990
アルミホイル 30cm×50m|本|890
弁当容器 中 50枚|袋|1260
スープカップ 50個|袋|1080
紙ナプキン 1000枚|袋|590
キッチンペーパー 2ロール|袋|290
ゴミ袋 45L 50枚|袋|390
台所用洗剤 4L|本|1290
アルコール製剤 5L|本|3250
竹串 15cm 1kg|袋|990
ストロー 500本|袋|480
デリカ容器 角小|個|30
デリカ容器 角中|個|40
デリカ容器 角大|個|60
テイクアウトカップ 12oz|個|30
テイクアウトカップ用ふた|個|30`,
};

// ---------------------------------------------------------------- 商品
function buildProducts() {
  const rng = new Rng('products');
  const products = [];
  for (const cat of CATS) {
    const items = ITEMS[cat.code]
      .trim()
      .split('\n')
      .map((l) => {
        const [name, unit, price] = l.split('|');
        return { name, unit, price: Number(price) };
      });
    const skus = items.map((it) => ({ ...it }));
    // 入数ちがいを足して点数をそろえる
    const packable = items.filter((it) => ['本', '袋', '缶', '個', '箱'].includes(it.unit) && it.price >= 100 && it.price < 3000);
    const packs = [6, 12, 10, 20];
    let k = 0;
    while (skus.length < cat.count) {
      const it = packable[k % packable.length];
      const n = packs[Math.floor(k / packable.length) % packs.length];
      skus.push({ name: `${it.name} ×${n}入`, unit: 'ケース', price: roundListNearest(it.price * n * 0.96) });
      k++;
    }
    skus.slice(0, cat.count).forEach((s, i) => {
      const code = `${cat.code}-${cat.base + i}`;
      const base = roundListNearest(s.price * (0.94 + rng.next() * 0.12));
      let supplier;
      if (cat.code === 'CS') supplier = /しょうゆ|みそ|酢|みりん|酒|だし|つゆ/.test(s.name) ? 'S101' : 'S110';
      else if (cat.code === 'YU') supplier = /油|ラード|ショートニング|マーガリン/.test(s.name) ? 'S102' : 'S103';
      else if (cat.code === 'FZ') supplier = /えび|いか|アジ|白身魚|さば|鮭/.test(s.name) ? 'S111' : 'S104';
      else if (cat.code === 'DR') supplier = /茶|ティー/.test(s.name) ? 'S112' : 'S105';
      else supplier = { KM: 'S103', CN: 'S106', DY: 'S107', KS: 'S108', PK: 'S109' }[cat.code];
      const jit = () => rng.int(-4, 4);
      let mat = cat.mat + jit();
      const lab = cat.lab + jit();
      const ene = cat.ene + jit();
      const oth = 100 - mat - lab - ene;
      if (oth < 3) mat -= 3 - oth;
      products.push({
        code,
        norm: normCode(code),
        name: s.name,
        cat: cat.code,
        unit: s.unit,
        base,
        supplier,
        mix: [mat, lab, ene, Math.max(3, oth)],
      });
    });
  }
  // 新商品（2025年9月発売）：冷凍の後半5品
  const fz = products.filter((p) => p.cat === 'FZ').slice(35, 40);
  for (const p of fz) p.isNew = true;
  // 値下げする飲料3品
  const cutCands = products.filter((p) => p.cat === 'DR' && p.unit === 'ケース' && !/×\d+入$/.test(p.name));
  const cut = new Rng('cut').shuffle(cutCands).slice(0, 3);
  for (const p of cut) p.isCut = true;

  // 定価・原単価の履歴
  const r2inc = { CS: 60, YU: 90, FZ: 70, KM: 50, CN: 60, DY: 80 };
  for (const p of products) {
    const from0 = p.isNew ? NEWPROD : BASE_FROM;
    p.lists = [{ price: p.base, from: from0 }];
    const isOil = p.supplier === 'S102';
    let rho;
    if (isOil) rho = 0.49 + rng.next() * 0.015;
    else if (p.isCut) rho = 0.4 + rng.next() * 0.04;
    else rho = 0.4 + rng.next() * 0.08;
    p.costs = [{ sen: round90(p.base * rho * 100), from: from0 }];
    const lastList = () => p.lists[p.lists.length - 1].price;
    const lastCost = () => p.costs[p.costs.length - 1].sen;
    if ((p.cat === 'DR' || p.cat === 'DY') && !p.isNew) {
      const inc = p.cat === 'DR' ? 50 : 40;
      p.lists.push({ price: raiseList(lastList(), inc), from: R1 });
      p.costs.push({ sen: round90((lastCost() * (1000 + inc - 10)) / 1000), from: R1 });
    }
    if (r2inc[p.cat] && !p.isNew) {
      const held = !isOil && rng.chance(0.08);
      if (held) {
        p.costs.push({ sen: round90(lastCost() * 1.02), from: R2 });
      } else {
        const inc = r2inc[p.cat] + rng.int(0, 2) * 10;
        p.lists.push({ price: raiseList(lastList(), inc), from: R2 });
        p.costs.push({ sen: round90((lastCost() * (1000 + inc - 10)) / 1000), from: R2 });
      }
    }
    if (p.cat === 'CN') p.costs.push({ sen: round90(lastCost() * 1.02), from: CN_COST_UP });
    if (isOil) p.costs.push({ sen: round90(lastCost() * 1.15), from: YU_COST_UP });
    if (p.isCut) {
      const np = roundListNearest(lastList() * 0.92);
      p.lists.push({ price: np < lastList() ? np : lastList() - listUnit(lastList()), from: CUT });
    }
    if (p.cat === 'KS') {
      p.lists.push({ price: raiseList(lastList(), 50), from: R3 });
      p.costs.push({ sen: round90(lastCost() * 1.04), from: R3 });
    }
    for (let i = 0; i < p.lists.length; i++) p.lists[i].to = i + 1 < p.lists.length ? p.lists[i + 1].from - 1 : INF;
    for (let i = 0; i < p.costs.length; i++) p.costs[i].to = i + 1 < p.costs.length ? p.costs[i + 1].from - 1 : INF;
    p.r1Idx = p.lists.findIndex((e) => e.from === R1);
    p.r2Idx = p.lists.findIndex((e) => e.from === R2);
    p.r3Idx = p.lists.findIndex((e) => e.from === R3);
    p.cutIdx = p.lists.findIndex((e) => e.from === CUT);
  }
  // 粗利率ちょうど10%の特値を置く商品：原単価を 567.00 円に固定（定価 1,260 円前後）
  const exact = products.find((p) => p.name === '弁当容器 中 50枚');
  exact.costs = [{ sen: 56700, from: BASE_FROM, to: INF }];
  exact.lists = [{ price: 1260, from: BASE_FROM, to: INF }];
  exact.isExact = true;
  return products;
}
const idxAt = (hist, d) => {
  for (let i = 0; i < hist.length; i++) if (hist[i].from <= d && d <= hist[i].to) return i;
  return -1;
};
const listAt = (p, d) => p.lists[idxAt(p.lists, d)].price;
const costAt = (p, d) => p.costs[idxAt(p.costs, d)].sen;

// ---------------------------------------------------------------- 得意先
const NAME_A = ['月面', '星屑', '虹色', '夢見', '雲上', '銀河', '綿雲', 'まぼろし', 'ゆめうつつ', 'ふしぎ', 'おとぎ', '空想', 'ほら吹き'];
const NAME_B = ['うさぎ', 'ぺんぎん', 'くじら', 'たぬき', 'ふくろう', 'こぐま', 'いるか', 'かもめ', 'どんぐり', 'かぼちゃ', '金平糖', '風車', '灯台', '鈴蘭', '三日月'];
const TYPE_INFO = {
  S: { kind: '二次卸', names: [(n) => [`株式会社${n}食品`, `(株)${n}食品`], (n) => [`${n}食品販売株式会社`, `${n}食品販売(株)`]], dept: '仕入部' },
  A: { kind: '量販・スーパー', names: [(n) => [`株式会社スーパー${n}`, `(株)スーパー${n}`], (n) => [`${n}マート株式会社`, `${n}マート(株)`]], dept: '商品部' },
  B: { kind: '外食チェーン', names: [(n) => [`株式会社${n}ダイニング`, `(株)${n}ダイニング`], (n) => [`${n}フードサービス株式会社`, `${n}フードサービス(株)`]], dept: '購買部' },
  C: {
    kind: '給食・病院・ホテル',
    names: [(n) => [`${n}給食株式会社`, `${n}給食(株)`], (n) => [`ホテル${n}株式会社`, `ホテル${n}(株)`], (n) => [`社会福祉法人${n}会`, `(福)${n}会`]],
    dept: '厨房',
  },
  D: {
    kind: '個人飲食店',
    names: [(n) => [`居酒屋 ${n}`, `居酒屋 ${n}`], (n) => [`${n}食堂`, `${n}食堂`], (n) => [`洋食屋 ${n}`, `洋食屋 ${n}`], (n) => [`中華そば ${n}`, `中華そば ${n}`], (n) => [`カフェ ${n}`, `カフェ ${n}`], (n) => [`${n}亭`, `${n}亭`]],
    dept: '',
  },
  E: { kind: 'スポット', names: [(n) => [`${n}キッチンカー`, `${n}キッチンカー`], (n) => [`${n}イベント企画`, `${n}イベント企画`]], dept: 'ご担当者' },
};
// 役割：前回改定（2025-10-01）の合意状況と、埋め込む問題
const ROLE_SPEC = {
  S: [
    { status: '一部合意', excl: ['YU'] },
    { status: '一部合意', excl: ['CN'] },
    { status: '合意', vdAmb: true },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
  ],
  A: [
    { status: '合意', wholeR1: true },
    { status: '見送り' },
    { status: '一部合意', excl: ['YU'] },
    { status: '合意', eff: '2025-11-01' },
    { status: '合意', eff: '2026-01-01' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意', end: '2026-03-15' },
  ],
  B: [
    { status: '合意', wholeR2: true },
    { status: '合意', eff: '2025-11-16', deferLeak: true },
    { status: '合意', eff: '2025-11-16' },
    { status: '一部合意', excl: ['FZ', 'CN'] },
    { status: '一部合意', excl: ['FZ'], eff: '2025-12-01' },
    { status: '合意', eff: '2025-11-01' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '対象外(改定後に取引開始)', start: '2025-10-20' },
  ],
  C: [
    { status: '合意', wrongRate: 750 },
    { status: '見送り' },
    { status: '一部合意', excl: ['DY'] },
    { status: '合意', eff: '2025-11-01' },
    { status: '合意', eff: '2026-01-01' },
    { status: '対象外(改定後に取引開始)', start: '2025-12-08' },
    { status: '合意', twoBehind: true },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意' },
    { status: '合意', end: '2025-12-31' },
  ],
  D: [
    { status: '見送り' },
    { status: '見送り' },
    { status: null, light: true, noRow: true },
    { status: '協議中', light: true },
    { status: '一部合意', excl: ['CS', 'KM'] },
    { status: '合意', eff: '2025-11-01' },
    { status: '対象外(改定後に取引開始)', start: '2026-01-15' },
    { status: null, start: '2026-02-02' },
    { status: null, start: '2026-04-13' },
    { status: null, end: '2025-06-30' },
    ...Array.from({ length: 20 }, () => ({ status: '合意' })),
  ],
  E: [{ status: '合意', start: '2025-05-12' }, ...Array.from({ length: 9 }, () => ({ status: '合意' }))],
};
const RATES = {
  S: [585, 590, 595, 600, 605, 610, 615],
  A: [665, 670, 675, 680, 685, 690, 695],
  B: [725, 730, 735, 740, 745, 750, 755],
  C: [775, 780, 785, 790, 795, 800, 805],
  D: [835, 840, 845, 848, 850, 855, 860, 862, 865, 870, 875],
  E: [905, 910, 915, 920, 925, 930, 940],
};
const BRANCHES = ['本社営業部', '川崎営業所', '湘南営業所'];
const REPS = ['星野', '月岡', '雲井', '空本', '虹川', '夢野', '霧島'];
const PREFS = ['神奈川県', '神奈川県', '神奈川県', '東京都', '静岡県'];
const CLOSING = ['末日', '20日', '25日', '15日'];

function buildCustomers() {
  const rng = new Rng('customers');
  const combos = [];
  for (const a of NAME_A) for (const b of NAME_B) combos.push(a + b);
  const names = rng.shuffle(combos);
  const list = [];
  let ni = 0;
  for (const tier of ['S', 'A', 'B', 'C', 'D', 'E']) {
    ROLE_SPEC[tier].forEach((role, i) => {
      const n = names[ni++];
      const info = TYPE_INFO[tier];
      const [name, short] = info.names[i % info.names.length](n);
      const rate10 = role.wrongRate ? 790 : rng.pick(RATES[tier]);
      const start = role.start ? parseIso(role.start) : dn(rng.int(2008, 2024), rng.int(1, 12), rng.int(1, 28));
      list.push({
        tier,
        kind: info.kind,
        name,
        short,
        rate10,
        branch: rng.pick(BRANCHES),
        rep: rng.pick(REPS),
        pref: rng.pick(PREFS),
        closing: rng.pick(CLOSING),
        dept: info.dept,
        start,
        end: role.end ? parseIso(role.end) : INF,
        role,
      });
    });
  }
  // コードは種類をまぜて振る（6桁。B形式ではゼロなし5桁）
  const shuffled = rng.shuffle(list);
  shuffled.forEach((c, i) => {
    c.code = String(30101 + i * 3 + rng.int(0, 2)).padStart(6, '0');
  });
  shuffled.sort((a, b) => (a.code < b.code ? -1 : 1));
  return shuffled;
}

// ---------------------------------------------------------------- 生成本体
function main() {
  const args = parseArgs(process.argv.slice(2));
  const products = buildProducts();
  const P = new Map(products.map((p) => [p.norm, p]));
  const customers = buildCustomers();
  const C = new Map(customers.map((c) => [c.code, c]));

  // ---- 前回改定の合意状況
  const agreements = new Map();
  {
    const rng = new Rng('agreements');
    for (const c of customers) {
      const r = c.role;
      if (!r.status) continue;
      const ask = dn(2025, 7, rng.int(1, 31));
      const answer = r.status === '協議中' ? null : ask + rng.int(14, 50);
      let eff = null;
      if (r.status === '合意' || r.status === '一部合意') eff = r.eff ? parseIso(r.eff) : R2;
      agreements.set(c.code, { status: r.status, eff, excluded: new Set(r.excl || []), ask, answer });
    }
  }

  // ---- 「その得意先に適用すべき定価」（文書のルール）。あいまいなときは理由を返す
  function applicable(c, p, d, opts = {}) {
    const sysIdx = idxAt(p.lists, d);
    if (sysIdx < 0) throw new Error(`no list for ${p.code} at ${iso(d)}`);
    if (p.r2Idx < 0 || d < R2) return { idx: sysIdx, kind: 'ok' };
    const oldIdx = p.r2Idx - 1;
    const frozen = () => (sysIdx !== p.r2Idx ? { amb: 'later_change_after_declined' } : { idx: oldIdx, kind: 'ok_declined' });
    const moved = (eff) => (d < eff ? { idx: oldIdx, kind: 'ok_deferred' } : { idx: sysIdx, kind: 'ok' });
    let ag = agreements.get(c.code);
    if (!ag) {
      if (c.start >= R2) return { idx: sysIdx, kind: 'ok' };
      if (!opts.noRow) return { amb: 'no_agreement_row' };
      ag = { status: opts.noRow, eff: R2, excluded: new Set() };
    }
    if (ag.status === '協議中' && opts.negotiating) ag = { status: opts.negotiating, eff: R2, excluded: new Set() };
    switch (ag.status) {
      case '合意':
        return moved(ag.eff);
      case '一部合意':
        return ag.excluded.has(p.cat) ? frozen() : moved(ag.eff);
      case '見送り':
        return frozen();
      case '対象外(改定後に取引開始)':
        return { idx: sysIdx, kind: 'ok' };
      case '協議中':
        return { amb: 'negotiating_status' };
      default:
        throw new Error(ag.status);
    }
  }
  // 販売管理側で実際に使われている定価（あいまいな得意先：協議中は旧定価のまま、合意記録なしは新定価）
  function billingIdx(c, p, d) {
    const a = applicable(c, p, d);
    if (!a.amb) return a.idx;
    if (a.amb === 'negotiating_status') return p.r2Idx - 1;
    return idxAt(p.lists, d);
  }

  // ---- 取扱商品（バスケット）
  const rngB = new Rng('baskets');
  const CATS_FOR = {
    S: ['CS', 'YU', 'FZ', 'DR', 'KM', 'CN', 'DY', 'KS', 'PK'],
    A: ['CS', 'YU', 'FZ', 'DR', 'KM', 'CN', 'DY', 'KS'],
    B: ['CS', 'YU', 'FZ', 'KM', 'DR', 'DY', 'PK', 'CN'],
    C: ['CS', 'YU', 'FZ', 'KM', 'CN', 'DY', 'DR', 'PK', 'KS'],
    D: ['CS', 'YU', 'FZ', 'DR', 'KM', 'DY', 'PK', 'CN'],
    E: ['DR', 'KS', 'FZ', 'PK'],
  };
  const SIZE = { S: [70, 100], A: [40, 60], B: [25, 40], C: [25, 40], D: [10, 22], E: [5, 10] };
  for (const c of customers) {
    const notMoved = ['見送り', '協議中'].includes(c.role.status) || c.role.noRow;
    let pool = products.filter((p) => CATS_FOR[c.tier].includes(p.cat));
    if (notMoved) pool = pool.filter((p) => p.cat !== 'KS' && !p.isCut);
    if (c.tier === 'D' || c.tier === 'E') pool = pool.filter((p) => !(p.unit === '個' && p.cat === 'PK') || rngB.chance(0.5));
    const n = Math.min(pool.length, rngB.int(...SIZE[c.tier]));
    const chosen = rngB.shuffle(pool).slice(0, n);
    c.basket = chosen.map((p, i) => ({ p, w: 1 / (i + 3) ** 0.8 }));
    c.top = c.basket[0].w;
  }
  const inBasket = (c, p) => c.basket.some((b) => b.p === p);
  const boost = (c, p) => {
    let b = c.basket.find((x) => x.p === p);
    if (!b) {
      b = { p, w: c.top };
      c.basket.push(b);
    }
    b.w = c.top;
  };
  const pairKey = (c, p) => `${c.code}|${p.code}`;
  const used = new Set();

  // ---- 特値
  const rngS = new Rng('specials');
  const specials = []; // {c, p, price, start, end, reason, flags}
  const specialsByPair = new Map();
  const addSpecial = (s) => {
    specials.push(s);
    const k = pairKey(s.c, s.p);
    if (!specialsByPair.has(k)) specialsByPair.set(k, []);
    specialsByPair.get(k).push(s);
  };
  const maxCostIn = (p, a, b) => {
    let m = 0;
    for (const e of p.costs) if (e.from <= b && e.to >= a) m = Math.max(m, e.sen);
    return m;
  };
  const allListRatePrices = (c, p) => new Set(p.lists.map((e) => floorMul(e.price, c.rate10)));
  const PERIODS = [
    ['2024-10-01', '2025-09-30'],
    ['2025-01-01', '2025-06-30', 'renew'],
    ['2025-04-01', null],
    ['2025-03-15', '2025-09-14'],
    ['2025-11-16', '2026-05-15'],
    ['2025-12-01', '2025-12-31'],
    ['2026-03-01', '2026-03-31'],
    ['2024-04-01', '2025-03-31'],
    ['2025-07-01', '2025-12-31'],
    ['2026-01-01', '2026-12-31'],
    ['2025-10-01', '2026-03-31'],
    ['2025-06-01', '2026-05-31'],
  ];
  const REASONS = ['新規獲得', '大口継続', '競合対抗', '年間契約', '新店オープン', 'メニュー採用', '期間販促'];
  function makeSpecialPrice(c, p, a, b, discLo, discHi) {
    const L = p.lists[billingIdx(c, p, Math.max(a, START, p.lists[0].from))].price;
    const std = floorMul(L, c.rate10);
    const k = Math.ceil(maxCostIn(p, a, b) / 90);
    const minP = Math.ceil(k * 1.04);
    let price = floorMul(L, c.rate10 - rngS.int(discLo, discHi));
    if (price < minP) price = minP;
    if (price >= std) return null;
    const avoid = allListRatePrices(c, p);
    while (avoid.has(price) && price < std - 1) price++;
    if (avoid.has(price) || price >= std) return null;
    return price;
  }
  const specCount = { S: [9, 12], A: [3, 5], B: [2, 4], C: [1, 2], D: [0, 1], E: [0, 0] };
  for (const c of customers) {
    if (c.role.wrongRate) continue;
    let n = rngS.int(...specCount[c.tier]);
    if (c.tier === 'D' && !rngS.chance(0.3)) n = 0;
    const cands = c.basket.slice(0, Math.min(c.basket.length, 25)).map((b) => b.p);
    const picks = rngS.shuffle(cands).slice(0, n);
    for (const p of picks) {
      if (p.isExact || p.isNew || p.isCut) continue;
      const [sa, sb, mode] = rngS.pick(PERIODS);
      let a = parseIso(sa);
      const b = sb ? parseIso(sb) : INF;
      if (p.lists[0].from > a) a = p.lists[0].from;
      if (b < START || a > END || b < c.start || a > c.end) continue;
      const price = makeSpecialPrice(c, p, a, Math.min(b, END), 30, 90);
      if (!price) continue;
      const s1 = { c, p, price, start: a, end: b, reason: rngS.pick(REASONS) };
      addSpecial(s1);
      used.add(pairKey(c, p));
      if (mode === 'renew') {
        const a2 = b + 1;
        const b2 = dn(2026, 6, 30);
        const L2 = p.lists[billingIdx(c, p, a2)].price;
        const std2 = floorMul(L2, c.rate10);
        let price2 = price + Math.max(1, Math.ceil(price * 0.03));
        const k2 = Math.ceil(maxCostIn(p, a2, b2) / 90);
        if (price2 < Math.ceil(k2 * 1.04)) price2 = Math.ceil(k2 * 1.04);
        const avoid = allListRatePrices(c, p);
        while (avoid.has(price2)) price2++;
        if (price2 < std2 && price2 !== price) {
          const s2 = { c, p, price: price2, start: a2, end: b2, reason: '更新', renewalOf: s1 };
          addSpecial(s2);
          s1.renewedBy = s2;
        }
      }
    }
  }
  // 粗利の低い特値（粗利下限割れになる）
  {
    const cands = customers.filter((c) => ['S', 'A', 'B'].includes(c.tier) && !c.role.wrongRate);
    let made = 0;
    for (const c of rngS.shuffle(cands)) {
      if (made >= 8) break;
      const ps = c.basket.slice(0, 20).map((b) => b.p).filter((p) => !used.has(pairKey(c, p)) && !p.isNew && !p.isExact && p.supplier !== 'S102');
      if (!ps.length) continue;
      const p = rngS.pick(ps);
      const [sa, sb] = rngS.pick([
        ['2025-04-01', '2026-03-31'],
        ['2025-07-01', null],
        ['2025-10-01', '2026-09-30'],
        ['2025-02-01', '2025-12-31'],
      ]);
      const a = parseIso(sa);
      const b = sb ? parseIso(sb) : INF;
      const k = Math.ceil(p.costs[idxAt(p.costs, a)].sen / 90);
      const price = k - Math.max(1, Math.round(k * (0.02 + rngS.next() * 0.04)));
      if (allListRatePrices(c, p).has(price)) continue;
      addSpecial({ c, p, price, start: a, end: b, reason: '競合対抗', lowMargin: true });
      used.add(pairKey(c, p));
      boost(c, p);
      made++;
    }
  }
  // 粗利率ちょうど10%の特値（下限「未満」ではないので正常）
  {
    const exact = products.find((p) => p.isExact);
    const c = customers.find((x) => x.tier === 'B' && !x.role.wholeR2 && !x.role.deferLeak && x.role.status === '合意' && !x.role.eff);
    addSpecial({ c, p: exact, price: 630, start: dn(2025, 6, 1), end: dn(2026, 5, 31), reason: '新店オープン', exact: true });
    used.add(pairKey(c, exact));
    boost(c, exact);
  }
  // 期間が重なる特値（どちらが正しいか文書では決まらない）
  let overlapPair = null;
  {
    const c = customers.find((x) => x.tier === 'S' && x.role.status === '合意' && !x.role.vdAmb);
    const p = c.basket.map((b) => b.p).find((q) => !used.has(pairKey(c, q)) && q.cat === 'PK' && !q.isExact && q.unit !== '個');
    const a1 = dn(2025, 8, 1);
    const b1 = dn(2026, 2, 28);
    const a2 = dn(2026, 2, 16);
    const b2 = dn(2026, 8, 15);
    const pr1 = makeSpecialPrice(c, p, a1, b1, 60, 60);
    let pr2 = pr1 + 3;
    addSpecial({ c, p, price: pr1, start: a1, end: b1, reason: '年間契約' });
    addSpecial({ c, p, price: pr2, start: a2, end: b2, reason: '更新' });
    used.add(pairKey(c, p));
    boost(c, p);
    overlapPair = pairKey(c, p);
  }
  // 売上のない特値（ノイズ）
  {
    for (let i = 0; i < 12; i++) {
      const c = rngS.pick(customers.filter((x) => ['S', 'A', 'B'].includes(x.tier) && !x.role.wrongRate));
      const p = rngS.pick(products.filter((q) => !inBasket(c, q) && !q.isNew && !q.isExact));
      const [sa, sb] = rngS.pick([
        ['2023-04-01', '2024-03-31'],
        ['2024-04-01', '2025-03-31'],
        ['2025-04-01', '2026-03-31'],
        ['2025-10-01', null],
      ]);
      const a = parseIso(sa);
      const b = sb ? parseIso(sb) : INF;
      const L = listAt(p, Math.max(a, BASE_FROM));
      const price = Math.max(Math.ceil((maxCostIn(p, a, Math.min(b, END)) / 90) * 1.05), floorMul(L, c.rate10 - 50));
      addSpecial({ c, p, price, start: a, end: b, reason: rngS.pick(REASONS), noise: true });
    }
  }

  // ---- 問題の埋め込み（得意先×商品）
  const rngX = new Rng('scenarios');
  const pairScen = new Map();
  const setScen = (c, p, s) => {
    const k = pairKey(c, p);
    if (used.has(k)) throw new Error(`pair reused ${k}`);
    used.add(k);
    pairScen.set(k, s);
    boost(c, p);
  };
  const active = (c, a, b) => c.start <= b && c.end >= a;
  const randDay = (a, b) => a + rngX.int(0, b - a);
  // 二つ前の定価のまま（乳製品：R1 も R2 も反映されていない）
  {
    const c = customers.find((x) => x.role.twoBehind);
    const p = products.find((q) => q.cat === 'DY' && q.r1Idx >= 0 && q.r2Idx >= 0 && !used.has(pairKey(c, q)) && q.unit !== 'ケース');
    setScen(c, p, { type: 'twoBehind', from: R1, to: INF, stayIdx: 0 });
  }
  // 適用日を後ろ倒しした得意先で、後ろ倒しの適用日が来ても旧価格のまま
  {
    const c = customers.find((x) => x.role.deferLeak);
    const ag = agreements.get(c.code);
    const ps = rngX.shuffle(c.basket.map((b) => b.p).filter((p) => p.r2Idx >= 0 && !used.has(pairKey(c, p)))).slice(0, 5);
    for (const p of ps) setScen(c, p, { type: 'defer', from: ag.eff, to: dn(2026, 3, 1), stayIdx: p.r2Idx - 1 });
  }
  // 前回改定（R2）の反映漏れ 35組
  {
    const eligible = customers.filter((c) => {
      const ag = agreements.get(c.code);
      return ag && ['合意', '一部合意'].includes(ag.status) && !c.role.wholeR2 && !c.role.deferLeak && !c.role.wrongRate && c.end > R2 + 60 && c.start < R2;
    });
    let made = 0;
    let guard = 0;
    while (made < 35 && guard++ < 5000) {
      const c = rngX.pick(eligible);
      const ag = agreements.get(c.code);
      const ps = c.basket.slice(0, 18).map((b) => b.p).filter((p) => p.r2Idx >= 0 && !ag.excluded.has(p.cat) && !used.has(pairKey(c, p)));
      if (!ps.length) continue;
      const p = rngX.pick(ps);
      const fixed = rngX.chance(0.4);
      const to = fixed ? randDay(Math.max(ag.eff + 30, dn(2025, 11, 5)), dn(2026, 5, 20)) : INF;
      setScen(c, p, { type: 'R2', from: ag.eff, to, stayIdx: p.r2Idx - 1 });
      made++;
    }
  }
  // R1（2025-04-16・一斉改定）の反映漏れ：飲料6組・乳製品2組
  {
    const eligible = customers.filter((c) => !c.role.wholeR1 && !c.role.wrongRate && c.start < R1 && c.end > R1 + 90);
    let dr = 0;
    let dy = 0;
    let guard = 0;
    while ((dr < 6 || dy < 2) && guard++ < 5000) {
      const c = rngX.pick(eligible);
      const want = dr < 6 ? 'DR' : 'DY';
      const ps = c.basket.slice(0, 20).map((b) => b.p).filter((p) => p.cat === want && p.r1Idx >= 0 && !p.isCut && !used.has(pairKey(c, p)));
      if (!ps.length) continue;
      const p = rngX.pick(ps);
      let to;
      if (want === 'DR') to = dr < 2 ? INF : randDay(dn(2025, 5, 20), dn(2026, 2, 28));
      else to = randDay(dn(2025, 6, 1), dn(2025, 9, 30));
      if (want === 'DY' && c.end < to) continue;
      setScen(c, p, { type: 'R1', from: R1, to, stayIdx: p.r1Idx - 1 });
      if (want === 'DR') dr++;
      else dy++;
    }
  }
  // R3（2026-04-01・菓子の一斉改定）の反映漏れ 6組
  {
    const eligible = customers.filter((c) => agreements.get(c.code)?.status === '合意' && c.end > R3 && c.start < R3 && c.basket.some((b) => b.p.cat === 'KS'));
    let made = 0;
    let guard = 0;
    while (made < 6 && guard++ < 5000) {
      const c = rngX.pick(eligible);
      const ps = c.basket.map((b) => b.p).filter((p) => p.cat === 'KS' && !used.has(pairKey(c, p)));
      if (!ps.length) continue;
      const p = rngX.pick(ps);
      const to = made < 2 ? [dn(2026, 5, 11), dn(2026, 6, 1)][made] : INF;
      setScen(c, p, { type: 'R3', from: R3, to, stayIdx: p.r3Idx - 1 });
      made++;
    }
  }
  // 値下げ後も旧（高い）定価のまま請求（過大請求。文書では決まらない）
  let cutPair = null;
  {
    const c = customers.find((x) => x.tier === 'B' && agreements.get(x.code)?.status === '合意' && !x.role.eff && !x.role.wholeR2 && x.end > END - 1);
    const p = products.find((q) => q.isCut && !used.has(pairKey(c, q)));
    setScen(c, p, { type: 'cut', from: CUT, to: dn(2026, 4, 11), stayIdx: p.cutIdx - 1 });
    cutPair = { c, p };
  }
  // 期限切れの特値のまま請求
  {
    const cands = rngX.shuffle(
      specials.filter((s) => !s.noise && !s.lowMargin && !s.exact && !s.renewalOf && pairKey(s.c, s.p) !== overlapPair && s.end < dn(2026, 5, 31) && s.end >= dn(2024, 12, 31) && s.c.end > s.end + 60),
    );
    let made = 0;
    let renew = 0;
    for (const s of cands) {
      const k = pairKey(s.c, s.p);
      if (pairScen.has(k)) continue;
      if (s.renewedBy) {
        if (renew >= 3) continue;
        pairScen.set(k, { type: 'renewLeak', from: s.end + 1, to: randDay(dn(2025, 8, 15), dn(2025, 10, 31)), price: s.price });
        renew++;
      } else {
        if (made >= 15) continue;
        const to = rngX.chance(0.5) ? INF : s.end + 1 + rngX.int(30, 150);
        pairScen.set(k, { type: 'expLeak', from: s.end + 1, to, price: s.price });
        made++;
      }
      boost(s.c, s.p);
    }
  }
  // 受注入力時の手入力単価（掛率ランクの下限より下）22組
  {
    const eligible = customers.filter((c) => !c.role.wrongRate && c.tier !== 'E' && c.end > START + 200);
    let made = 0;
    let guard = 0;
    while (made < 22 && guard++ < 5000) {
      const c = rngX.pick(eligible);
      const ps = c.basket.slice(0, 15).map((b) => b.p).filter((p) => !used.has(pairKey(c, p)) && !p.isExact);
      if (!ps.length) continue;
      const p = rngX.pick(ps);
      const a = randDay(Math.max(START, c.start, p.lists[0].from), Math.min(END - 60, c.end - 60));
      const b = Math.min(a + rngX.int(60, 220), END, c.end);
      setScen(c, p, { type: 'manual', from: a, to: b + 1, delta: rngX.pick([15, 20, 25, 30, 40, 50, 60]), prob: 0.55 });
      made++;
    }
  }
  // 上限超え・ランク内の価格差
  const extraPairs = {};
  {
    const pickPair = (pred) => {
      for (const c of rngX.shuffle(customers.filter(pred))) {
        const ps = c.basket.map((b) => b.p).filter((p) => !used.has(pairKey(c, p)) && !p.isExact && !p.isNew && p.r2Idx < 0 && p.r3Idx < 0 && !p.isCut);
        if (ps.length) {
          const p = rngX.pick(ps);
          used.add(pairKey(c, p));
          return { c, p };
        }
      }
      throw new Error('no pair');
    };
    extraPairs.above = pickPair((c) => c.tier === 'C' && agreements.get(c.code)?.status === '合意' && !c.role.wrongRate && c.end > END - 1);
    extraPairs.unexpl1 = pickPair((c) => c.tier === 'C' && c.rate10 - 20 >= TIER.get('C').low && agreements.get(c.code)?.status === '合意' && c.end > END - 1);
    extraPairs.unexpl2 = pickPair((c) => c.tier === 'D' && c.rate10 - 20 >= TIER.get('D').low && agreements.get(c.code)?.status === '合意' && c.end > END - 1);
  }

  // ---- 売上の注文を作る
  const rngO = new Rng('orders');
  const FREQ = { S: [6, 9], A: [5, 8], B: [3, 6], C: [3, 5], D: [2, 3], E: [0, 2] };
  const LINES = { S: [4, 9], A: [3, 7], B: [3, 6], C: [2, 5], D: [1, 4], E: [1, 3] };
  const slips = []; // {d, c, lines:[], seq}
  let seq = 0;
  const monthsList = [];
  for (let y = 2025, m = 1; y < 2026 || (y === 2026 && m <= 6); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) monthsList.push([y, m]);
  const daysOfMonth = (y, m) => {
    const out = [];
    for (let d = dn(y, m, 1); ymd(d)[1] === m; d++) if (isBusinessDay(d)) out.push(d);
    return out;
  };
  function qtyFor(c, p, r) {
    if (p.unit === '個' && p.cat === 'PK') {
      const base = { S: [10, 30], A: [4, 15], B: [2, 8], C: [1, 5], D: [1, 2], E: [1, 2] }[c.tier];
      return r.int(...base) * 100;
    }
    let q = r.int(...{ S: [5, 40], A: [3, 30], B: [2, 20], C: [1, 12], D: [1, 6], E: [1, 4] }[c.tier]);
    if (p.base >= 5000) q = Math.max(1, Math.round(q / 3));
    return q;
  }
  for (const c of customers) {
    for (const [y, m] of monthsList) {
      const days = daysOfMonth(y, m).filter((d) => d >= c.start && d <= c.end && d >= START && d <= END);
      if (!days.length) continue;
      let n = rngO.int(...FREQ[c.tier]);
      if (c.role.light) n = rngO.int(1, 2);
      if (c.tier === 'E' && rngO.chance(0.5)) n = 0;
      const ds = rngO.shuffle(days).slice(0, n).sort((a, b) => a - b);
      if (y === 2026 && m === 6 && c.tier === 'S' && !ds.includes(END)) ds.push(END);
      for (const d of ds) {
        const avail = c.basket.filter((b) => b.p.lists[0].from <= d);
        let L = Math.min(avail.length, rngO.int(...LINES[c.tier]));
        const picked = [];
        const pool = avail.slice();
        while (L-- > 0 && pool.length) {
          const tot = pool.reduce((s, b) => s + b.w, 0);
          let r = rngO.next() * tot;
          let i = 0;
          for (; i < pool.length - 1; i++) {
            r -= pool[i].w;
            if (r <= 0) break;
          }
          picked.push(pool[i].p);
          pool.splice(i, 1);
        }
        const lines = picked.map((p) => ({ p, qty: qtyFor(c, p, rngO) }));
        slips.push({ d, c, lines, seq: seq++ });
      }
    }
  }

  // ---- 価格づけ（販売管理が実際に請求した単価）
  const rngP = new Rng('pricing');
  const VD_FORMS = [
    (x) => `数量値引${x}%`,
    (x) => `まとめ買い${x}%引`,
    (x) => `数量値引 ${x}%`,
    (x) => `数量値引${String(x).replace(/[0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0))}％`,
  ];
  function priceLine(c, p, d, qty) {
    const k = pairKey(c, p);
    const sps = specialsByPair.get(k) || [];
    const inP = sps.filter((s) => s.start <= d && d <= s.end);
    const scen = pairScen.get(k);
    const inWin = scen && d >= scen.from && d < scen.to;
    if (inP.length) {
      if (scen?.type === 'renewLeak' && inWin) return { price: scen.price, ptype: 1, remark: '', intent: 'leak_expired_special' };
      const s = inP.reduce((a, b) => (b.start > a.start ? b : a));
      if (inP.length > 1) return { price: s.price, ptype: 1, remark: '', intent: 'ambiguous' };
      if (!s.lowMargin && !s.exact && !scen && ['B', 'C', 'D'].includes(c.tier) && qty >= 8 && rngP.chance(0.15)) {
        const pct = rngP.pick([3, 5, 2]);
        const vp = Math.floor((s.price * (1000 - pct * 10)) / 1000);
        if (90 * vp >= costAt(p, d) * 1.12) return { price: vp, ptype: 9, remark: rngP.pick(VD_FORMS)(pct), intent: 'ok_volume_discount' };
      }
      return { price: s.price, ptype: 1, remark: '', intent: s.lowMargin ? 'leak_below_margin_floor' : 'ok_special', special: s };
    }
    if (scen?.type === 'expLeak' && inWin) return { price: scen.price, ptype: 1, remark: '', intent: 'leak_expired_special' };
    let rate = c.rate10;
    if (scen && ['R1', 'R2', 'R3', 'defer', 'twoBehind', 'cut'].includes(scen.type) && inWin) {
      let intent = 'leak_old_price';
      if (scen.type === 'twoBehind' && d >= R2) intent = 'ambiguous';
      if (scen.type === 'cut') intent = 'ambiguous';
      return { price: floorMul(p.lists[scen.stayIdx].price, rate), ptype: 1, remark: '', intent };
    }
    if (c.role.wholeR1 && p.r1Idx >= 0 && d >= R1 && d < R2) return { price: floorMul(p.lists[p.r1Idx - 1].price, rate), ptype: 1, remark: '', intent: 'leak_old_price' };
    if (c.role.wholeR2 && p.r2Idx >= 0 && d >= R2 && d < WHOLE_R2_FIX) return { price: floorMul(p.lists[p.r2Idx - 1].price, rate), ptype: 1, remark: '', intent: 'leak_old_price' };
    const L = p.lists[billingIdx(c, p, d)].price;
    if (c.role.wrongRate && d < WRONG_RATE_FIX) return { price: floorMul(L, c.role.wrongRate), ptype: 0, remark: '', intent: 'leak_rate_out_of_tier' };
    if (scen?.type === 'manual' && inWin && rngP.chance(scen.prob)) {
      const t = TIER.get(c.tier);
      return { price: floorMul(L, t.low - scen.delta), ptype: 9, remark: rngP.pick(['', '', '競合対抗価格', '店長決裁', '口頭了承済']), intent: 'leak_rate_out_of_tier' };
    }
    const correct = floorMul(L, rate);
    const ptype = c.tier === 'S' || c.tier === 'A' || (c.tier === 'B' && rngP.chance(0.6)) || agreements.get(c.code)?.status === '見送り' ? 1 : 0;
    const a = applicable(c, p, d);
    const intent = a.amb ? 'ambiguous' : 'auto';
    // 数量値引（備考に記載）
    if (!a.amb && ['B', 'C', 'D'].includes(c.tier) && !scen && qty >= (c.tier === 'D' ? 5 : 10) && rngP.chance(0.15)) {
      const pct = rngP.pick([3, 5, 2, 3, 2.5]);
      const vp = Math.floor((correct * (1000 - pct * 10)) / 1000);
      if (90 * vp >= costAt(p, d) * 1.12) {
        return { price: vp, ptype: 9, remark: rngP.pick(VD_FORMS)(pct), intent: 'ok_volume_discount' };
      }
    }
    return { price: correct, ptype, remark: '', intent };
  }

  // 行を作る
  const lines = []; // 出力する売上明細
  const addLine = (slip, o) => {
    slip.out.push(o);
  };
  for (const s of slips) {
    s.out = [];
    let amount = 0;
    let cool = false;
    for (const ln of s.lines) {
      const pr = priceLine(s.c, ln.p, s.d, ln.qty);
      addLine(s, { kind: 'sale', c: s.c, p: ln.p, qty: ln.qty, ...pr });
      amount += pr.price * ln.qty;
      if (ln.p.cat === 'FZ' || ln.p.cat === 'DY') cool = true;
    }
    if ((s.c.tier === 'D' || s.c.tier === 'E') && amount < 15000) {
      addLine(s, { kind: 'nonproduct', c: s.c, code: '9999', name: '運賃', unit: '式', qty: 1, price: s.d >= dn(2026, 4, 1) ? 950 : 800, ptype: 9, remark: '', intent: 'ok_non_product' });
    }
    if ((s.c.tier === 'D' || s.c.tier === 'E') && cool && rngO.chance(0.7)) {
      addLine(s, { kind: 'nonproduct', c: s.c, code: '9991', name: 'クール便手数料', unit: '式', qty: 1, price: 330, ptype: 9, remark: '', intent: 'ok_non_product' });
    }
  }
  // 数量値引で粗利下限を割る行（S得意先・油・仕入値上げ後）
  {
    const c = customers.find((x) => x.role.vdAmb);
    const ps = c.basket.map((b) => b.p).filter((p) => p.supplier === 'S102' && p.r2Idx >= 0 && !used.has(pairKey(c, p)));
    const p = ps[0];
    used.add(pairKey(c, p));
    for (const d of [dn(2026, 3, 10), dn(2026, 5, 19)]) {
      const correct = floorMul(listAt(p, d), c.rate10);
      const vp = Math.floor((correct * 970) / 1000);
      slips.push({ d, c, seq: seq++, out: [{ kind: 'sale', c, p, qty: 40, price: vp, ptype: 9, remark: '数量値引3%', intent: 'ambiguous' }] });
    }
  }
  // 特定の行を足す（ランク上限超え・ランク内の価格差・値下げ後の旧価格）
  {
    const { above, unexpl1, unexpl2 } = extraPairs;
    for (const d of [dn(2026, 1, 13), dn(2026, 1, 20), dn(2026, 1, 27)]) {
      const L = listAt(above.p, d);
      slips.push({ d, c: above.c, seq: seq++, out: [{ kind: 'sale', c: above.c, p: above.p, qty: 4, price: floorMul(L, TIER.get('C').high + 30), ptype: 9, remark: '単価誤入力', intent: 'leak_rate_out_of_tier' }] });
    }
    for (const [pair, ds] of [
      [unexpl1, [dn(2025, 8, 5), dn(2025, 8, 19), dn(2025, 9, 2)]],
      [unexpl2, [dn(2026, 2, 10), dn(2026, 3, 3)]],
    ]) {
      for (const d of ds) {
        const L = listAt(pair.p, d);
        slips.push({ d, c: pair.c, seq: seq++, out: [{ kind: 'sale', c: pair.c, p: pair.p, qty: 3, price: floorMul(L, pair.c.rate10 - 15), ptype: 9, remark: '', intent: 'unexplained_price_diff' }] });
      }
    }
    for (const d of [dn(2026, 3, 4), dn(2026, 3, 18), dn(2026, 4, 8)]) {
      const { c, p } = cutPair;
      slips.push({ d, c, seq: seq++, out: [{ kind: 'sale', c, p, qty: 5, price: floorMul(p.lists[p.cutIdx - 1].price, c.rate10), ptype: 1, remark: '', intent: 'ambiguous' }] });
    }
  }
  // 見本品・販促品（単価0）
  {
    const rngM = new Rng('samples');
    const SAMPLE_REM = ['見本品', 'ｻﾝﾌﾟﾙ(無償)', '試食用見本', '新商品サンプル', 'サンプル(無償)'];
    const cs = customers.filter((c) => c.end > START + 100);
    for (let i = 0; i < 46; i++) {
      const c = rngM.pick(cs);
      const p = rngM.pick(c.basket).p;
      const d = Math.max(c.start, START, p.lists[0].from) + rngM.int(0, 400);
      if (d > Math.min(END, c.end) || !isBusinessDay(d)) continue;
      slips.push({ d, c, seq: seq++, out: [{ kind: 'sale', c, p, qty: rngM.int(1, 3), price: 0, ptype: 9, remark: rngM.pick(SAMPLE_REM), intent: 'ok_sample' }] });
    }
    for (let i = 0; i < 3; i++) {
      const c = customers.filter((x) => x.tier === 'D' && x.role.status === '合意' && x.end > END - 1)[i];
      const p = c.basket.map((b) => b.p).find((q) => q.r2Idx < 0 && !used.has(pairKey(c, q)));
      const d = [dn(2025, 9, 12), dn(2026, 1, 16), dn(2026, 5, 22)][i];
      slips.push({ d, c, seq: seq++, out: [{ kind: 'sale', c, p, qty: 2, price: 0, ptype: 9, remark: '販促品(無償提供)', intent: 'leak_rate_out_of_tier' }] });
    }
  }
  // 得意先マスタにない得意先（諸口）
  {
    const rngU = new Rng('unknown');
    const ghost = { code: '099999', short: '諸口(現金売上)', tier: 'X', ghost: true };
    for (const d of [dn(2025, 3, 7), dn(2025, 8, 22), dn(2025, 12, 26), dn(2026, 5, 15)]) {
      const out = [];
      for (let i = 0; i < 2; i++) {
        const p = rngU.pick(products.filter((q) => q.cat === 'DR' || q.cat === 'KS'));
        if (p.lists[0].from > d) continue;
        out.push({ kind: 'sale', c: ghost, p, qty: rngU.int(1, 3), price: floorMul(listAt(p, d), 900), ptype: 9, remark: '現金', intent: 'ambiguous' });
      }
      slips.push({ d, c: ghost, seq: seq++, out });
    }
  }
  // 品番の打ち間違い（商品マスタにないコード）
  {
    const typoSlips = slips.filter((s) => s.c.tier === 'C' && s.out.length >= 2).slice(40, 42);
    for (const s of typoSlips) {
      const o = s.out.find((x) => x.kind === 'sale');
      o.typo = o.p.code.replace(/0/, 'O');
      if (o.typo === o.p.code) o.typo = `${o.p.code}X`;
      o.intent = 'ok_non_product';
    }
  }

  // ---- 伝票番号を振る（日付順）
  slips.sort((a, b) => a.d - b.d || (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : 0) || a.seq - b.seq);
  let slipNo = 52000001;
  for (const s of slips) {
    if (!s.out.length) continue;
    s.no = slipNo++;
  }

  // ---- 返品（漏れの行の返品を含む）・赤黒訂正
  const rngR = new Rng('returns');
  const returnSlips = [];
  const allSaleLines = [];
  for (const s of slips) for (const o of s.out) if (o.kind === 'sale' && !o.c.ghost && o.price > 0 && !o.typo) allSaleLines.push({ s, o });
  const nextBiz = (d, k) => {
    let x = d;
    let n = 0;
    while (n < k) {
      x++;
      if (isBusinessDay(x)) n++;
    }
    return x;
  };
  const RET_REM = ['返品(破損)', '返品(賞味期限)', '返品(誤発注)', '返品', '返品(規格違い)'];
  const leakLines = allSaleLines.filter((x) => x.o.intent.startsWith('leak_') && x.o.price > 0);
  const retPicks = [...rngR.shuffle(leakLines).slice(0, 12), ...rngR.shuffle(allSaleLines).slice(0, 190)];
  const seenRet = new Set();
  for (const { s, o } of retPicks) {
    if (seenRet.has(o)) continue;
    seenRet.add(o);
    const d = nextBiz(s.d, rngR.int(1, 10));
    if (d > Math.min(END, o.c.end)) continue;
    const q = -Math.min(o.qty, rngR.int(1, 3) * (o.qty >= 100 ? 100 : 1));
    returnSlips.push({ d, c: o.c, seq: seq++, kubun: 2, out: [{ kind: 'sale', c: o.c, p: o.p, qty: q, price: o.price, ptype: o.ptype, remark: rngR.pick(RET_REM), intent: 'ok_return', retOf: o }] });
  }
  // 赤黒訂正：反映漏れの行を後日まとめて訂正（赤伝はマイナス数量・売上区分1、黒伝は正しい単価）
  {
    const cands = leakLines.filter((x) => x.o.intent === 'leak_old_price' && x.s.d >= dn(2025, 11, 1) && x.s.d <= dn(2026, 1, 10) && pairScen.get(pairKey(x.o.c, x.o.p))?.type === 'R2');
    for (const { s, o } of cands.slice(0, 2)) {
      const d = nextBiz(s.d, 3);
      const correct = floorMul(listAt(o.p, s.d), o.c.rate10);
      returnSlips.push({ d, c: o.c, seq: seq++, kubun: 1, out: [{ kind: 'sale', c: o.c, p: o.p, qty: -o.qty, price: o.price, ptype: 1, remark: `赤伝 ${RED_BLACK_NOTE}(伝票No${s.no})`, intent: 'ok_return' }] });
      returnSlips.push({ d, c: o.c, seq: seq++, kubun: 1, black: true, out: [{ kind: 'sale', c: o.c, p: o.p, qty: o.qty, price: correct, ptype: 9, remark: `黒伝 ${RED_BLACK_NOTE}(伝票No${s.no})`, intent: 'black' }] });
    }
  }
  returnSlips.sort((a, b) => a.d - b.d || a.seq - b.seq);
  // 返品伝票は 59000001 から（販売管理の返品伝票の番号帯という想定）
  let retNo = 59000001;
  for (const s of returnSlips) s.no = retNo++;
  const allSlips = [...slips.filter((s) => s.out.length), ...returnSlips].sort((a, b) => a.d - b.d || a.no - b.no);

  // ---- 明細行
  const rngF = new Rng('format');
  const CODE_FORMS = [
    [60, (c) => c],
    [14, (c) => c.replace('-', '')],
    [8, (c) => c.toLowerCase()],
    [7, (c) => `${c} `],
    [5, (c) => c.replace('-', '－')],
    [3, (c) => c.replace('-', 'ｰ')],
    [3, (c) => c.replace('-', '‐')],
  ];
  const pickForm = () => {
    let r = rngF.int(1, 100);
    for (const [w, f] of CODE_FORMS) {
      r -= w;
      if (r <= 0) return f;
    }
    return CODE_FORMS[0][1];
  };
  for (const s of allSlips) {
    let ln = 1;
    for (const o of s.out) {
      const d = s.d;
      const isProd = o.kind === 'sale' && !o.typo;
      const p = o.p;
      const sys = isProd ? listAt(p, d) : null;
      const cost = isProd || o.typo ? costAt(p, d) : 0;
      const custText = o.c.ghost ? '99999' : rngF.chance(0.03) ? o.c.code : rngF.chance(0.01) ? `${String(Number(o.c.code))} ` : String(Number(o.c.code));
      const codeText = o.kind === 'nonproduct' ? o.code : o.typo ? o.typo : pickForm()(p.code);
      lines.push({
        d,
        slip: s.no,
        lineNo: ln++,
        c: o.c,
        custText,
        p: isProd ? p : null,
        codeText,
        name: o.kind === 'nonproduct' ? o.name : p.name,
        unit: o.kind === 'nonproduct' ? o.unit : p.unit,
        kubun: s.kubun === 2 ? 2 : 1,
        qty: o.qty,
        sys,
        price: o.price,
        cost,
        ptype: o.ptype,
        remark: o.remark,
        intent: o.intent,
        retOf: o.retOf,
      });
    }
  }

  // ---- 判定（文書のルールを自分で実装したもの。正解の定義）
  const prodByNorm = P;
  const custByCode = C;
  const parseVD = (rem) => {
    const m = rem.match(/(?:数量値引|まとめ買い)\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
    return m ? Math.round(Number(m[1]) * 10) : null;
  };
  function classify(L, opts = {}) {
    const prod = prodByNorm.get(normCode(L.codeText));
    if (!prod) return { label: 'ok_non_product' };
    if (L.qty < 0) return { label: 'ok_return' };
    const rem = nfkc(L.remark);
    if (L.price === 0 && (rem.includes('見本') || rem.includes('サンプル'))) return { label: 'ok_sample' };
    const cust = custByCode.get(normCust(L.custText));
    if (!cust) return opts.unknown ? { label: opts.unknown } : { label: 'ambiguous', amb: 'unknown_customer' };
    const d = L.d;
    const sps = specialsByPair.get(pairKey(cust, prod)) || [];
    let inP = sps.filter((s) => s.start <= d && d <= s.end);
    if (new Set(inP.map((s) => s.price)).size > 1) {
      if (!opts.overlap) return { label: 'ambiguous', amb: 'overlapping_specials' };
      const pick = opts.overlap === 'latest' ? inP.reduce((a, b) => (b.start > a.start ? b : a)) : inP.reduce((a, b) => (b.price < a.price ? b : a));
      inP = [pick];
    }
    const app = applicable(cust, prod, d, opts);
    if (app.amb) return { label: 'ambiguous', amb: app.amb };
    const list = prod.lists[app.idx].price;
    const rate = cust.rate10;
    const correct = inP.length ? inP[0].price : floorMul(list, rate);
    const kind = inP.length ? 'ok_special' : app.kind;
    const cost = costAt(prod, d);
    if (cost !== L.cost) throw new Error('cost mismatch');
    const Pp = L.price;
    const q = L.qty;
    const base = { correct, refKind: inP.length ? 'special' : `list${app.kind === 'ok' ? '' : `(${app.kind.slice(3)})`}` };
    const belowInfo = () => (90 * Pp < cost ? { belowFloor: true, floorPrice: cost / 90, floorGap: (cost / 90 - Pp) * q } : {});
    if (Pp === correct) {
      const unitBelow = 90 * Pp < cost;
      const lineCost = roundHalfUpDiv(cost * q, 100);
      const lineBelow = 9 * Pp * q < 10 * lineCost;
      if (unitBelow !== lineBelow) return { label: 'ambiguous', amb: 'exact_floor_rounding', ...base };
      if (unitBelow) {
        if (cost % 90 !== 0) throw new Error('floor price not integral');
        return { label: 'leak_below_margin_floor', ...base, shortfall: (cost / 90 - Pp) * q, ...belowInfo() };
      }
      return { label: kind, ...base };
    }
    const vd = parseVD(rem);
    if (vd !== null && Pp === Math.floor((correct * (1000 - vd)) / 1000)) {
      if (90 * Pp < cost) {
        if (opts.vdFloor === 'ok') return { label: 'ok_volume_discount', ...base };
        if (opts.vdFloor === 'floor') return { label: 'leak_below_margin_floor', ...base, shortfall: (cost / 90 - Pp) * q, ...belowInfo() };
        return { label: 'ambiguous', amb: 'volume_discount_below_floor', ...base };
      }
      return { label: 'ok_volume_discount', ...base };
    }
    for (let j = app.idx - 1; j >= 0; j--) {
      const Lj = prod.lists[j].price;
      if (Lj === list) continue;
      if (Pp === floorMul(Lj, rate)) {
        const oldLeak = { label: 'leak_old_price', ...base, shortfall: (correct - Pp) * q, ...belowInfo() };
        if (j === app.idx - 1) {
          if (Lj < list) return oldLeak;
          if (opts.cut === 'old') return oldLeak;
          if (opts.cut === 'skip') break;
          return { label: 'ambiguous', amb: 'list_cut_old_price', ...base };
        }
        if (opts.twoBehind === 'old') return oldLeak;
        if (opts.twoBehind === 'skip') break;
        return { label: 'ambiguous', amb: 'two_revisions_behind', ...base };
      }
    }
    for (const s of sps) if (s.end < d && s.price === Pp) return { label: 'leak_expired_special', ...base, shortfall: (correct - Pp) * q, ...belowInfo() };
    const t = TIER.get(cust.tier);
    const lo = floorMul(list, t.low);
    const hi = floorMul(list, t.high);
    if (Pp < lo || Pp > hi) return { label: 'leak_rate_out_of_tier', ...base, shortfall: (correct - Pp) * q, ...belowInfo() };
    return { label: 'unexplained_price_diff', ...base, shortfall: (correct - Pp) * q, ...belowInfo() };
  }

  // あいまいな行の2通りの読み方（A：自然と思う読み方 / B：別の読み方）
  const READINGS = {
    no_agreement_row: [{ noRow: '合意' }, { noRow: '見送り' }],
    negotiating_status: [{ negotiating: '見送り' }, { negotiating: '合意' }],
    two_revisions_behind: [{ twoBehind: 'old' }, { twoBehind: 'skip' }],
    list_cut_old_price: [{ cut: 'old' }, { cut: 'skip' }],
    overlapping_specials: [{ overlap: 'latest' }, { overlap: 'lowest' }],
    volume_discount_below_floor: [{ vdFloor: 'ok' }, { vdFloor: 'floor' }],
    unknown_customer: [{ unknown: 'excluded' }, { unknown: 'excluded' }],
  };
  const mism = new Map();
  const autoLabels = {};
  for (const L of lines) {
    const r = classify(L);
    L.truth = r;
    if (r.amb) {
      const rd = READINGS[r.amb];
      if (!rd) throw new Error(`no readings for ${r.amb}`);
      L.alt = rd.map((o) => classify(L, o));
    }
    if (L.intent === 'auto') autoLabels[r.label] = (autoLabels[r.label] || 0) + 1;
    let want = L.intent;
    if (want === 'auto' || want === 'black') continue;
    if (want !== r.label) {
      const k = `${want} -> ${r.label}${r.amb ? `(${r.amb})` : ''}`;
      mism.set(k, (mism.get(k) || 0) + 1);
    }
  }

  // ---- 自己点検：漏れの不足額の符号と、埋め込んだ問題ごとの行数
  const scenLines = {};
  for (const L of lines) {
    const t = L.truth;
    if (t.shortfall !== undefined && t.shortfall <= 0 && !(t.label === 'leak_rate_out_of_tier' && L.remark === '単価誤入力')) {
      throw new Error(`non-positive shortfall ${t.label} ${L.slip}-${L.lineNo} ${t.shortfall}`);
    }
    if (!L.p || L.qty < 0) continue;
    const sc = pairScen.get(pairKey(L.c, L.p));
    if (sc && L.d >= sc.from && L.d < sc.to) scenLines[sc.type] = (scenLines[sc.type] || 0) + 1;
    if (L.c.role?.wholeR1 && L.p.r1Idx >= 0 && L.d >= R1 && L.d < R2) scenLines.wholeR1 = (scenLines.wholeR1 || 0) + 1;
    if (L.c.role?.wholeR2 && L.p.r2Idx >= 0 && L.d >= R2 && L.d < WHOLE_R2_FIX) scenLines.wholeR2 = (scenLines.wholeR2 || 0) + 1;
    if (L.c.role?.wrongRate && L.d < WRONG_RATE_FIX) scenLines.wrongRate = (scenLines.wrongRate || 0) + 1;
    const sps = specialsByPair.get(pairKey(L.c, L.p)) || [];
    for (const sp of sps) if (sp.start <= L.d && L.d <= sp.end) {
      if (sp.exact) scenLines.exactSpecial = (scenLines.exactSpecial || 0) + 1;
      if (sp.lowMargin) scenLines.lowMarginSpecial = (scenLines.lowMarginSpecial || 0) + 1;
      if (L.d === sp.end) scenLines.onSpecialEndDate = (scenLines.onSpecialEndDate || 0) + 1;
      if (L.d === sp.start) scenLines.onSpecialStartDate = (scenLines.onSpecialStartDate || 0) + 1;
    }
    for (const sp of sps) if (L.d === sp.end + 1) scenLines.dayAfterSpecialEnd = (scenLines.dayAfterSpecialEnd || 0) + 1;
  }

  // ---- 書き出し：入力ファイル
  const D = args.data;
  mkdirSync(D, { recursive: true });
  const w = (name, text) => writeFileSync(join(D, name), text);
  w(
    'README.md',
    `# 検証用データ gen-1（架空）\n\nこのフォルダのファイルはすべて架空のデータです。会社名（${COMPANY.name}）・得意先名・仕入先名・商品・価格・取引は作り物で、実在の企業・団体・人物・取引とは関係ありません（名前が一致しても無関係です）。\n\n食品・飲料の卸という想定の、転嫁デスクの独立検証用データです。売上明細は販売管理B形式（Shift_JIS・CRLF）だけです。\n`,
  );
  w('company.json', `${JSON.stringify(COMPANY, null, 2)}\n`);
  w(
    'demo_settings.json',
    `${JSON.stringify(
      {
        note: '初期設定です(架空)。アプリ側で変更できる前提の値です。',
        marginFloorPct: 10,
        previousRevisionDate: '2025-10-01',
        listPriceRounding: [
          { below: 1000, unit: 10 },
          { below: 10000, unit: 50 },
          { unit: 100 },
        ],
      },
      null,
      2,
    )}\n`,
  );
  w('rate_tiers.csv', csvText([['掛率ランク', '名称', '標準掛率(%)', '下限(%)', '上限(%)', '説明'], ...TIERS.map(([c, n, s, l, h, e]) => [c, n, (s / 10).toFixed(1), (l / 10).toFixed(1), (h / 10).toFixed(1), e])]));
  w('categories.csv', csvText([['カテゴリコード', 'カテゴリ名', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)', '主な原材料'], ...CATS.map((c) => [c.code, c.name, c.mat, c.lab, c.ene, c.oth, c.raw])]));
  w('suppliers.csv', csvText([['仕入先コード', '仕入先名', '主な取扱カテゴリ'], ...SUPPLIERS]));
  w(
    'customers.csv',
    csvText([
      ['得意先コード', '得意先名', '略称', '取引先区分', '掛率ランク', '掛率(%)', '担当営業所', '営業担当', '都道府県', '締日', '宛先部署', '取引開始日'],
      ...customers.map((c) => [c.code, c.name, c.short, c.kind, c.tier, (c.rate10 / 10).toFixed(1), c.branch, c.rep, c.pref, c.closing, c.dept, iso(c.start)]),
    ]),
  );
  w(
    'products.csv',
    csvText([
      ['商品コード', '商品名', 'カテゴリコード', '単位', '定価(円)', '原単価(円)', '仕入先コード', '原材料比率(%)', '労務費比率(%)', 'エネルギー比率(%)', 'その他比率(%)'],
      ...products.map((p) => [p.code, p.name, p.cat, p.unit, p.lists.at(-1).price, senStr(p.costs.at(-1).sen), p.supplier, ...p.mix]),
    ]),
  );
  w('list_price_history.csv', csvText([['商品コード', '定価(円)', '適用開始日', '適用終了日'], ...products.flatMap((p) => p.lists.map((e) => [p.code, e.price, iso(e.from), e.to >= INF ? '' : iso(e.to)]))]));
  w('cost_history.csv', csvText([['商品コード', '原単価(円)', '適用開始日', '適用終了日'], ...products.flatMap((p) => p.costs.map((e) => [p.code, senStr(e.sen), iso(e.from), e.to >= INF ? '' : iso(e.to)]))]));
  // 仕入先の値上げ通知
  {
    const rows = [['通知日', '仕入先コード', '仕入先名', '商品コード', '商品名', '現行仕入単価(円)', '改定後仕入単価(円)', '改定率(%)', '適用日', '主な理由', '状態']];
    const supName = new Map(SUPPLIERS.map((s) => [s[0], s[1]]));
    for (const p of products.filter((q) => q.supplier === 'S102')) {
      const i = idxAt(p.costs, YU_COST_UP);
      const before = p.costs[i - 1].sen;
      const after = p.costs[i].sen;
      rows.push(['2025-12-10', 'S102', supName.get('S102'), p.code, p.name, senStr(before), senStr(after), ((after / before - 1) * 100).toFixed(1), iso(YU_COST_UP), '原料菜種・大豆価格と物流費の上昇', '適用済み']);
    }
    for (const [sup, notice, eff, pct, reason] of [
      ['S105', '2026-05-20', '2026-08-01', 6, '容器・物流費の上昇'],
      ['S104', '2026-06-10', '2026-09-01', 8, '原料肉・エネルギーコストの上昇'],
      ['S101', '2026-06-25', '2026-10-01', 5, '原料大豆・包材の上昇'],
    ]) {
      for (const p of products.filter((q) => q.supplier === sup)) {
        const before = p.costs.at(-1).sen;
        const after = Math.round(before * (1 + pct / 100));
        rows.push([notice, sup, supName.get(sup), p.code, p.name, senStr(before), senStr(after), ((after / before - 1) * 100).toFixed(1), eff, reason, '予定']);
      }
    }
    w('supplier_notices.csv', csvText(rows));
  }
  // 前回改定の合意状況
  {
    const rows = [['得意先コード', '得意先名', '申入日', '回答日', '合意状況', '適用日', '対象外カテゴリ', '備考']];
    for (const c of customers) {
      const ag = agreements.get(c.code);
      if (!ag) continue;
      let note = '';
      const effTxt = ag.eff === null ? '' : iso(ag.eff);
      if (ag.status === '合意' && ag.eff !== R2) {
        const [, m, d] = ymd(ag.eff);
        note = `${m}月${d}日納品分から新価格(適用日の後ろ倒し)`;
      } else if (ag.status === '一部合意') note = `${[...ag.excluded].map((x) => CAT.get(x).name).join('・')}は据え置き${ag.eff !== R2 ? `、${ymd(ag.eff)[1]}月${ymd(ag.eff)[2]}日から適用` : ''}`;
      else if (ag.status === '見送り') note = '今回の改定は見送り(価格据え置き)';
      else if (ag.status === '協議中') note = '回答待ち(再訪問予定)';
      else if (ag.status === '対象外(改定後に取引開始)') {
        const [y, m, d] = ymd(c.start);
        note = `${y}年${m}月${d}日取引開始`;
      }
      // 日付の書き方のゆれ（文書で受け付けると書かれている形式）
      const effOut = effTxt && c.tier === 'D' && ag.eff !== R2 ? slashDate(ag.eff) : effTxt;
      rows.push([c.code, c.name, iso(ag.ask), ag.answer ? iso(ag.answer) : '', ag.status, effOut, [...ag.excluded].join(';'), note]);
    }
    w('revision_2025-10_agreements.csv', csvText(rows));
  }
  // 特値一覧（B形式）
  {
    const rows = [['得意先CD', '品番', '特価', '有効開始日', '有効終了日', '摘要']];
    const sorted = specials.slice().sort((a, b) => (a.c.code < b.c.code ? -1 : a.c.code > b.c.code ? 1 : a.p.code < b.p.code ? -1 : a.p.code > b.p.code ? 1 : a.start - b.start));
    const rngT = new Rng('special-format');
    for (const s of sorted) {
      const code = rngT.chance(0.15) ? s.p.code.replace('-', '') : rngT.chance(0.05) ? s.p.code.toLowerCase() : s.p.code;
      const fmt = (n) => (rngT.chance(0.08) ? slashDate(n) : compact(n));
      rows.push([String(Number(s.c.code)), code, s.price, fmt(s.start), s.end >= INF ? '99991231' : fmt(s.end), s.reason]);
    }
    w('special_prices_B.csv', csvText(rows));
  }
  // 売上明細（B形式）
  const SALES_FILE = 'sales_B_202501-202606.csv';
  const salesRows = [['伝票日付', '伝票No', '明細No', '得意先CD', '得意先略称', '品番', '品名', '売上区分', '数量', '単位', '標準価格', '掛率', '売単価', '売上金額', '原価単価', '原価金額', '単価種別', '摘要']];
  const EXCEL_TO = dn(2025, 3, 31); // 2025年1〜3月分は Excel で開いて保存した書き出し
  for (const L of lines) {
    const ex = L.d <= EXCEL_TO;
    const num = (n) => (ex && Math.abs(n) >= 1000 ? sep3(n) : String(n));
    const amount = L.price * L.qty;
    const costAmt = roundHalfUpDiv(L.cost * L.qty, 100);
    const rateTxt = L.sys ? (ex ? String(Number((L.price / L.sys).toFixed(3))) : (L.price / L.sys).toFixed(3)) : '';
    L.row = salesRows.length; // 見出しを除いた1始まりの行番号
    salesRows.push([
      ex ? slashDate(L.d) : compact(L.d),
      L.slip,
      L.lineNo,
      L.custText,
      L.c.short,
      L.codeText,
      toHalfKana(L.name),
      L.kubun,
      num(L.qty),
      toHalfKana(L.unit),
      L.sys === null ? '' : num(L.sys),
      rateTxt,
      num(L.price),
      num(amount),
      ex ? senStrExcel(L.cost) : senStr(L.cost),
      num(costAmt),
      L.ptype,
      L.remark,
    ]);
  }
  const salesText = csvText(salesRows, args.utf8 ? '\n' : '\r\n');
  const salesBuf = args.utf8 ? Buffer.from(salesText, 'utf8') : encodeSjis(salesText, buildSjis());
  writeFileSync(join(D, SALES_FILE), salesBuf);

  // ---- 書いたファイルを読み直して、文書の正規化で元の値に戻るか確かめる
  {
    const buf = readFileSync(join(D, SALES_FILE));
    const text = new TextDecoder(args.utf8 ? 'utf-8' : 'shift_jis', { fatal: true }).decode(buf);
    const rows = parseCsv(text);
    if (rows.length !== lines.length + 1) throw new Error(`row count ${rows.length} vs ${lines.length + 1}`);
    const pd = (s) => {
      if (/^\d{8}$/.test(s)) return dn(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
      const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
      if (m) return dn(+m[1], +m[2], +m[3]);
      throw new Error(`date ${s}`);
    };
    const pn = (s) => Number(s.replaceAll(',', ''));
    lines.forEach((L, i) => {
      const r = rows[i + 1];
      if (pd(r[0]) !== L.d) throw new Error('date');
      if (normCust(r[3]) !== L.c.code) throw new Error('cust');
      if (L.p && normCode(r[5]) !== L.p.norm) throw new Error(`code ${r[5]}`);
      if (pn(r[8]) !== L.qty || pn(r[12]) !== L.price || Math.round(pn(r[14]) * 100) !== L.cost) throw new Error('num');
      if (nfkc(r[6]) !== nfkc(L.name)) throw new Error(`name ${r[6]}`);
    });
  }

  // ---- 正解（リポジトリの外）
  const T = join(args.sealed, 'truth');
  mkdirSync(T, { recursive: true });
  const truthRows = [['file', 'row', 'line_id', 'date', 'customer_code', 'product_code', 'qty', 'billed', 'label', 'ambiguity', 'reference', 'reference_kind', 'shortfall_yen', 'below_floor', 'floor_price', 'floor_gap_yen', 'last12m']];
  const LEAKS = ['leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor'];
  const counts = {};
  const counts12 = {};
  const leakAgg = {};
  const ambAgg = {};
  for (const k of [...LEAKS, 'unexplained_price_diff']) leakAgg[k] = { lines: 0, linesLast12m: 0, pairs: new Set(), pairsLast12m: new Set(), shortfallLast12mYen: 0, shortfallAllYen: 0, negativeLinesLast12m: 0, negativeYenLast12m: 0, alsoBelowFloorLines: 0 };
  for (const L of lines) {
    const t = L.truth;
    const last12 = L.d >= L12_FROM;
    counts[t.label] = (counts[t.label] || 0) + 1;
    if (last12) counts12[t.label] = (counts12[t.label] || 0) + 1;
    if (t.amb) {
      ambAgg[t.amb] ??= { lines: 0, linesLast12m: 0, readingA: { labels: {}, shortfallLast12mYen: {} }, readingB: { labels: {}, shortfallLast12mYen: {} } };
      const g = ambAgg[t.amb];
      g.lines++;
      if (last12) g.linesLast12m++;
      L.alt.forEach((r, i) => {
        const tgt = i === 0 ? g.readingA : g.readingB;
        tgt.labels[r.label] = (tgt.labels[r.label] || 0) + 1;
        if (last12 && r.shortfall !== undefined) tgt.shortfallLast12mYen[r.label] = (tgt.shortfallLast12mYen[r.label] || 0) + r.shortfall;
      });
    }
    if (leakAgg[t.label]) {
      const a = leakAgg[t.label];
      const pk = `${L.c.code}|${L.p.code}`;
      a.lines++;
      a.pairs.add(pk);
      a.shortfallAllYen += t.shortfall;
      if (t.belowFloor && t.label !== 'leak_below_margin_floor') a.alsoBelowFloorLines++;
      if (last12) {
        a.linesLast12m++;
        a.pairsLast12m.add(pk);
        a.shortfallLast12mYen += t.shortfall;
        if (t.shortfall < 0) {
          a.negativeLinesLast12m++;
          a.negativeYenLast12m += t.shortfall;
        }
      }
    }
    truthRows.push([
      SALES_FILE,
      L.row,
      `${L.slip}-${L.lineNo}`,
      iso(L.d),
      L.c.code,
      L.p ? L.p.code : normCode(L.codeText),
      L.qty,
      L.price,
      t.label,
      t.amb ? `${t.amb}|A=${L.alt[0].label}|B=${L.alt[1].label}` : '',
      t.correct ?? '',
      t.refKind ?? '',
      t.shortfall ?? '',
      t.belowFloor ? 1 : 0,
      t.floorPrice ?? '',
      t.floorGap ?? '',
      last12 ? 1 : 0,
    ]);
  }
  writeFileSync(join(T, 'lines.csv'), csvText(truthRows));
  const leaksOut = {};
  for (const [k, a] of Object.entries(leakAgg)) {
    leaksOut[k] = {
      lines: a.lines,
      linesLast12m: a.linesLast12m,
      pairs: a.pairs.size,
      pairsLast12m: a.pairsLast12m.size,
      shortfallLast12mYen: a.shortfallLast12mYen,
      shortfallLast12mYenPositiveOnly: a.shortfallLast12mYen - a.negativeYenLast12m,
      negativeLinesLast12m: a.negativeLinesLast12m,
      shortfallAllPeriodYen: a.shortfallAllYen,
      leakLinesAlsoBelowFloor: a.alsoBelowFloorLines,
    };
  }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const summary = {
    note: 'gen-1 の正解（架空データ）。lines.csv の row は見出しを除いた1始まりの行番号（ファイル上の行 = row + 1）。',
    generator: 'portfolio-samples/tenka-desk/blind/gen-1/generate.mjs',
    salesFile: SALES_FILE,
    salesEncoding: args.utf8 ? 'UTF-8, LF' : 'Shift_JIS, CRLF',
    period: { from: iso(START), to: iso(END), last12m: { from: iso(L12_FROM), to: iso(END) } },
    marginFloorPct: 10,
    rows: {
      [SALES_FILE]: lines.length,
      'customers.csv': customers.length,
      'products.csv': products.length,
      'special_prices_B.csv': specials.length,
      'revision_2025-10_agreements.csv': agreements.size,
    },
    labelCounts: sortObj(counts),
    labelCountsLast12m: sortObj(counts12),
    leaks: leaksOut,
    totalLeakShortfallLast12mYen: LEAKS.reduce((s, k) => s + leaksOut[k].shortfallLast12mYen, 0),
    ambiguous: sortObj(ambAgg),
  };
  writeFileSync(join(T, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  // ---- notes.md（正解と同じ場所。リポジトリには置かない）
  {
    const yen = (n) => `${sep3(n)}円`;
    const amb = summary.ambiguous;
    const ambLine = (k) => {
      const g = amb[k];
      if (!g) return '（このデータでは0行）';
      const fmt = (r) =>
        Object.entries(r.labels)
          .map(([l, n]) => `${l} ${n}行${r.shortfallLast12mYen[l] !== undefined ? `（直近12か月 ${yen(r.shortfallLast12mYen[l])}）` : ''}`)
          .join('、');
      return `${g.lines}行（うち直近12か月 ${g.linesLast12m}行）。読み方A：${fmt(g.readingA)}。読み方B：${fmt(g.readingB)}。`;
    };
    const lk = summary.leaks;
    const md = `# gen-1 正解の注記（架空データ・リポジトリの外に置く）

生成器：\`portfolio-samples/tenka-desk/blind/gen-1/generate.mjs\`（固定シード）。正解は \`truth/lines.csv\`（売上明細1行ごと）と \`truth/summary.json\`。

- \`row\` は売上明細ファイルの見出しを除いた1始まりの行番号（ファイル上の行 = row + 1）。\`line_id\` は「伝票No-明細No」。
- 直近12か月 = データの最終月（2026年6月）までの12か月：${summary.period.last12m.from}〜${summary.period.last12m.to}。データ全体は ${summary.period.from}〜${summary.period.to}（18か月）。
- \`shortfall_yen\` は、反映漏れ・期限切れ・ランク外・原因不明では（正しい単価 − 請求単価）× 数量、粗利下限割れでは（原単価 ÷ 0.9 − 請求単価）× 数量。
- \`ambiguity\` 列は「パターン|A=読み方Aのラベル|B=読み方Bのラベル」。

## 文書のルールの読み方（決まると判断したもの）

判定は data-gen/README.md の手順1〜8を、この順番どおりに自分で実装したもの（公開した入力ファイルの値だけを使う）。

1. **前回改定**は合意状況ファイル \`revision_2025-10_agreements.csv\`（改定日 2025-10-01）の改定。合意状況が効くのは、2025-10-01 に定価が変わった商品だけ。ほかの定価の変更（2025-04-16 の飲料・乳製品、2026-03-01 の飲料3品の値下げ、2026-04-01 の菓子・製菓材料）は合意記録がなく、全得意先に一斉に適用。見送り・協議中・合意記録なしの得意先には、菓子と値下げ品を売っていない（「見送りは後の改定も止めるか」で答えが変わらないように）。
2. 合意で \`適用日\` が後ろ倒しの得意先は、その日の前日まで旧定価（ok_deferred）。一部合意の \`対象外カテゴリ\` と見送りは旧定価のまま（ok_declined）。2025-10-01 に定価が変わらなかった商品（同じカテゴリでも据え置き品がある）は、合意状況に関係なく定価の履歴どおり。
3. 改定後に取引を始めた得意先（customers.csv の取引開始日が 2025-10-01 以降）は、合意状況に行がなくても新定価（旧定価で取引したことがないため）。
4. 特値の期間は開始日・終了日を含む。終了日の当日の行は特値が正しく、翌日からは期限切れ。期間中は定価が変わっても特値が正しい。
5. **旧定価**（手順5）は、その得意先に適用すべき定価の一つ前の定価。二つ以上前の定価のままの行は下の「あいまい」に入れた。
6. 粗利率は行の単価と原単価で計算：（単価 − 原単価）÷ 単価 が 10% 未満で下限割れ。原単価はすべて 0.9円の倍数にしてあり、粗利10%の単価（原単価 ÷ 0.9）は整数円になるので、端数処理の違いで結果が変わらない。行の原価金額（四捨五入）で計算しても同じ判定になることを全行で確かめている。**粗利率ちょうど10%** の特値（原単価 567.00円・特値 630円）は「未満」ではないので ok_special。
7. 粗利下限割れは手順3（請求単価 = 正しい単価）でだけ判定。合意状況で旧定価が正しい行（見送り・据え置き）でも、粗利が下限未満なら leak_below_margin_floor。反映漏れなどの行が同時に下限未満のときは種類は漏れのほう（\`below_floor\`=1）。
8. 返品は数量マイナスの行。売上区分2の返品のほか、売上区分1でマイナス数量の赤伝も対象外（ok_return）。漏れの行が後で返品・赤黒訂正されても、元の行は漏れのまま数え、返品で差し引かない。
9. 数量値引の備考は文書の例（\`数量値引3%\`・\`まとめ買い5%引\`）のほか、\`数量値引 2%\`（空白）、\`数量値引３％\`（全角。NFKC で半角になる）、\`数量値引2.5%\`（小数）を使った。正しい単価 ×（100 − 値引率）% の切り捨てと一致すれば ok_volume_discount（特値に対する数量値引も同じ）。
10. 単価0円でも備考が「見本」「サンプル」を含まない行（\`販促品(無償提供)\`）は見本品ではないので、手順7で掛率ランク外。
11. 商品マスタにない品番（数字の0を英字のOに打ち間違えた品番）は手順1で ok_non_product。運賃 \`9999\`・クール便手数料 \`9991\` も同じ。
12. ランクの上限を超える請求は手順7で leak_rate_out_of_tier。不足額は負（過大請求）。summary.json の \`shortfallLast12mYen\` は負の値も含めた合計、\`shortfallLast12mYenPositiveOnly\` は正の値だけの合計。
13. 期限切れの特値が、後ろ倒し中の旧定価の時期に切れた組がある（正しい単価は 旧定価 × 掛率）。
14. ランクの範囲内で、正しい単価より安い手入力単価は手順8「原因不明の価格差」。文書にラベル名がないので \`unexplained_price_diff\` とした。
15. 売上明細は Shift_JIS・CRLF。2025年1〜3月分だけ Excel で開いて保存した形（日付 \`2025/1/6\`、数量・金額の3桁区切り、原価単価の末尾の0が落ちる）。品番は \`CS-2101\`・\`CS2101\`・\`cs-2101\`・末尾空白・\`CS－2101\`・\`CSｰ2101\`・\`CS‐2101\` がまざる。得意先CDは \`30101\`・\`030101\`・末尾空白。
16. \`demo_settings.json\` と \`company.json\` は、見出し3行しか見られなかったので、キー名は推測（\`marginFloorPct\` は見えたもの、\`previousRevisionDate\` などは推測）。正解は粗利率の下限10%・前回改定 2025-10-01 を前提にしている。

## あいまいなパターン（label = ambiguous）

文書のルールでは決まらないと判断した行。どちらの読み方でも数えられるよう、2通りの結果を書く。漏れの種類別の合計（summary.json の \`leaks\`）には入れていない。

- **no_agreement_row**：2025-10-01 より前から取引がある得意先なのに、合意状況ファイルに行がない（担当者の記入漏れの想定）。販売管理は新定価で請求している。A＝合意扱い（新定価が正しい→正常）、B＝見送り扱い（旧定価が正しい→新定価での請求はランクの上限超え）。${ambLine('no_agreement_row')}
- **negotiating_status**：合意状況が「協議中」（文書の合意状況の値にない）。販売管理は旧定価のまま。A＝未合意なので旧定価が正しい（ok_declined 相当）、B＝改定日から新定価が正しい（反映漏れ）。${ambLine('negotiating_status')}
- **two_revisions_behind**：乳製品1組が 2025-04-16 の改定も 2025-10-01 の改定も反映されず、2024年の定価 × 掛率 のまま。2025-04-16〜09-30 の行は一つ前の定価なので leak_old_price。2025-10-01 以降は二つ前の定価で、「旧定価」に含めるかで種類が変わる。A＝反映漏れ、B＝手順5に当たらず手順7（ランク外）。不足額はどちらも同じ。${ambLine('two_revisions_behind')}
- **list_cut_old_price**：2026-03-01 に定価を下げた飲料を、値下げ前の（高い）定価 × 掛率で請求（過大請求）。手順5の文言どおりなら反映漏れだが不足額は負。A＝leak_old_price（負の額）、B＝手順5は値上げだけと読み、手順7でランク外（上限超え・負の額）。${ambLine('list_cut_old_price')}
- **overlapping_specials**：同じ得意先・商品の特値2件の期間が 2026-02-16〜02-28 で重なり、価格が違う。請求は新しいほう（開始日が後）。A＝開始日が後の特値が正しい（正常）、B＝安いほうが正しい（請求が高すぎる→ランク外）。${ambLine('overlapping_specials')}
- **volume_discount_below_floor**：数量値引の計算は合うが、値引後の単価が粗利下限（10%）を下回る。手順4は「正常（数量値引）」で終わるが、README の「1行に複数の問題があるときは…粗利下限割れの順で1つに数える」とも読める。A＝ok_volume_discount、B＝leak_below_margin_floor。${ambLine('volume_discount_below_floor')}
- **unknown_customer**：得意先CD \`99999\`（諸口・現金売上）。得意先マスタにないので掛率もランクも決まらない。対象外として扱うのが自然だが、文書には書かれていない。${ambLine('unknown_customer')}
- **exact_floor_rounding**（行の原価金額の四捨五入で、単価ベースと行ベースの粗利の判定が分かれる行）：${ambLine('exact_floor_rounding')}

## 集計（summary.json と同じ）

| 種類 | 行 | うち直近12か月 | 組（得意先×商品） | 直近12か月の不足額 |
|---|---:|---:|---:|---:|
${['leak_old_price', 'leak_expired_special', 'leak_rate_out_of_tier', 'leak_below_margin_floor', 'unexplained_price_diff'].map((k) => `| ${k} | ${lk[k].lines} | ${lk[k].linesLast12m} | ${lk[k].pairs} | ${yen(lk[k].shortfallLast12mYen)}${lk[k].negativeLinesLast12m ? `（正の値だけ ${yen(lk[k].shortfallLast12mYenPositiveOnly)}）` : ''} |`).join('\n')}

4種類の合計（直近12か月）：${yen(summary.totalLeakShortfallLast12mYen)}

ラベル別の行数：${Object.entries(summary.labelCounts).map(([k, v]) => `${k} ${v}`).join('、')}
`;
    writeFileSync(join(args.sealed, 'notes.md'), md);
  }

  // 生成ログ（意図と判定のずれ）
  console.log(JSON.stringify({ lines: lines.length, labelCounts: summary.labelCounts, scenarioLines: sortObj(scenLines), autoLabels, intentMismatches: Object.fromEntries(mism) }, null, 2));
  return { summary, mism };
}

main();
