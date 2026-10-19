// 売上明細の生成（伝票・行）。請求単価は「その得意先の仕組み」（特値・更新漏れ・手入力など）から決まる。
import { RNG, hashStr, ymd, dow, mulRate } from './util.mjs';
import { NAME_STEMS, SITE_KIND, NEUTRAL_REMARKS, TIERS } from './catalog.mjs';
import { SEED, listFor, specialAt, regimeAt, costAt, available, priceAt } from './world.mjs';

const SEASON = [0.85, 0.95, 1.2, 1.05, 0.85, 1.0, 1.0, 0.8, 1.15, 1.1, 1.05, 1.1];
const LN_W = [0.2, 0.19, 0.16, 0.12, 0.09, 0.07, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];
// 商品コードの書きゆれ：0標準 1ハイフンなし 2小文字 3末尾に空白 4全角ハイフン 5長音記号
const STY = {
  本社営業部: [0.82, 0.08, 0.04, 0.04, 0.0, 0.02],
  東部営業所: [0.5, 0.32, 0.02, 0.04, 0.1, 0.02],
  西部営業所: [0.4, 0.1, 0.25, 0.1, 0.0, 0.15],
};
export function fmtCode(code, office, rng) {
  const st = rng.weightedIndex(STY[office] ?? STY['本社営業部']);
  switch (st) {
    case 1: return code.replace('-', '');
    case 2: return code.toLowerCase();
    case 3: return code + ' ';
    case 4: return code.replace('-', '－');
    case 5: return code.replace('-', 'ー');
    default: return code;
  }
}

function genQty(L, c, rng) {
  let mean;
  if (L < 400) mean = 60;
  else if (L < 1500) mean = 20;
  else if (L < 6000) mean = 8;
  else if (L < 30000) mean = 3;
  else if (L < 150000) mean = 1.5;
  else mean = 1.1;
  mean *= Math.pow(Math.max(0.35, c.size), 0.6);
  const q = Math.round(mean * rng.lognormal(0.6));
  return Math.max(1, q);
}
const fmtPct = (v10) => (v10 % 10 === 0 ? String(v10 / 10) : (v10 / 10).toFixed(1));
const SAMPLE_REMARKS = ['見本品', 'サンプル(無償)', 'サンプル', '無償', '試供品', '見本'];
const FREE_OTHER = ['サービス品', '販促品', 'おまけ', '現場サービス', '端材サービス'];

// 1行分の請求単価を決める。null を返したら別の商品で作り直す。
export function priceLine(w, c, p, d, qty, rng, opts) {
  const L = listFor(w, c, p, d);
  if (L === null) return null;
  const normal = mulRate(L, c.rate1000);
  const sp = specialAt(w, c, p, d);
  const reg = sp ? null : regimeAt(w, c, p, d);
  let billed;
  let ptype;
  let remark = '';
  let amb = null;
  let needMargin = false;
  let tag = 'normal';
  if (sp) {
    billed = sp.price;
    ptype = 1;
    tag = 'special';
  } else if (reg) {
    tag = reg.type;
    switch (reg.type) {
      case 'stale':
        billed = mulRate(reg.frozen, c.rate1000);
        ptype = 1;
        if (reg.tag === 'ambig') amb = { pattern: 'PARTIAL_NO_CATEGORY' };
        break;
      case 'expired':
        billed = reg.price;
        ptype = 1;
        break;
      case 'manual':
        billed = mulRate(L, c.rate1000 - reg.delta10);
        ptype = 9;
        break;
      case 'custrate':
        billed = mulRate(L, reg.rate1000);
        ptype = 0;
        break;
      default:
        billed = mulRate(L, c.rate1000 - reg.delta10);
        ptype = reg.type === 'unexp' ? 9 : 0;
        needMargin = true;
    }
  } else {
    billed = normal;
    ptype = hashStr(c.code + p.code) % 100 < c.regPct ? 1 : 0;
    const amount = normal * qty;
    if (amount >= 60000 && rng.chance(0.13)) {
      tag = 'volume';
      const v10 = rng.pick([30, 30, 50, 50, 25, 70, 100]);
      const style = rng.next();
      if (opts.allowAmb && style < 0.012) {
        const vb = rng.pick([80, 100]);
        billed = Math.floor((normal * (1000 - vb)) / 1000);
        remark = rng.pick(['数量値引', 'まとめ買い値引', '数量値引き']);
        amb = { pattern: 'DISCOUNT_REMARK_NO_RATE' };
      } else {
        const exact = Math.floor((normal * (1000 - v10)) / 1000);
        const ps = fmtPct(v10);
        remark = rng.chance(0.7) ? `数量値引${ps}%` : `まとめ買い${ps}%引`;
        if (rng.chance(0.06)) remark = remark.replace('%', '％');
        billed = exact;
        if (opts.allowAmb && c.office === '西部営業所' && rng.chance(0.13)) {
          const rounded = Math.round((normal * (1000 - v10)) / 1000);
          if (rounded !== exact) {
            billed = rounded;
            amb = { pattern: 'DISCOUNT_ROUNDING' };
          }
        }
      }
      ptype = rng.chance(0.6) ? 9 : 1;
    } else if (opts.allowOneOff && rng.chance(0.0022)) {
      tag = 'oneoff_low';
      billed = Math.floor(normal * (1 - rng.range(0.06, 0.16)));
      ptype = 9;
      remark = rng.chance(0.5) ? '' : rng.pick(['現場調整', '出精', '端数調整']);
    } else if (opts.allowOneOff && rng.chance(0.0007)) {
      tag = 'oneoff_unexp';
      const b = Math.floor(normal * (1 - rng.range(0.006, 0.014)));
      if (b < normal && b >= mulRate(L, TIERS[c.tier].lo)) {
        billed = b;
        needMargin = true;
      }
      ptype = 9;
    }
  }
  if (billed > 0) {
    const cost100 = costAt(p, d);
    const m = (billed * 100 - cost100) / (billed * 100);
    if (Math.abs(m - 0.1) < 0.005) return null;
    if ((needMargin || amb) && m < 0.105) return null;
  }
  return { billed, ptype, remark, amb, tag };
}

function lineCount(c, rng) {
  return 1 + rng.weightedIndex(LN_W) + (c.size > 1.8 ? 2 : c.size > 1.2 ? 1 : 0);
}

export function generateLines(w, days, opts) {
  const rng = new RNG(hashStr(opts.seedName + ':' + SEED));
  const lines = [];
  let slip = opts.slipStart;
  const custs = w.customers.filter((c) => c.freq > 0);
  const masterFreq = w.masterCustomers.reduce((a, c) => a + c.freq, 0);
  for (const d of days) {
    const [, mo] = ymd(d);
    const dm = (dow(d) === 1 ? 1.15 : dow(d) === 5 ? 0.9 : 1) * SEASON[mo - 1] * opts.volume;
    for (const c of custs) {
      if (d < c.first || d > c.last) continue;
      const pOrder = c.ghost && c.code === '99999' ? (opts.cashPerDay ?? 0.55) * dm : ((c.freq / masterFreq) * opts.ordersPerDay * dm);
      if (!rng.chance(pOrder)) continue;
      if (c.ghost && c.code !== '99999' && opts.noGhost) continue;
      slip++;
      const n = lineCount(c, rng);
      const used = new Set();
      const olines = [];
      let amountSum = 0;
      for (let i = 0; i < n; i++) {
        const r = rng.next();
        let made = null;
        for (let tries = 0; tries < 14 && !made; tries++) {
          const e = c.items[rng.weightedIndex(c.itemW)];
          const p = e.p;
          if (!available(p, d) || used.has(p.code)) continue;
          const Lco = priceAt(p, d);
          if (r < 0.012) {
            // 返品
            const qty = -Math.max(1, Math.round(genQty(Lco, c, rng) * 0.4));
            const L = listFor(w, c, p, d);
            if (L === null) continue;
            const pr = mulRate(L, c.rate1000);
            made = { kind: 'return', p, qty, billed: pr, ptype: c.regPct > 50 ? 1 : 0, remark: rng.pick(['返品', '返品(破損)', '返品(誤発注)', '返品']), amb: null };
          } else if (r < 0.016) {
            const qty = rng.int(1, 3);
            made = { kind: 'sample', p, qty, billed: 0, ptype: 9, remark: rng.pick(SAMPLE_REMARKS), amb: null };
          } else if (opts.allowAmb && r < 0.0164) {
            const qty = rng.int(1, 4);
            made = { kind: 'free_other', p, qty, billed: 0, ptype: 9, remark: rng.pick(FREE_OTHER), amb: { pattern: 'FREE_GOODS_OTHER_WORDING' } };
          } else {
            const qty = genQty(Lco, c, rng);
            const pl = priceLine(w, c, p, d, qty, rng, opts);
            if (!pl) continue;
            made = { kind: 'normal', p, qty, billed: pl.billed, ptype: pl.ptype, remark: pl.remark, amb: pl.amb, tag: pl.tag };
            if (!made.remark && rng.chance(0.1)) {
              made.remark = rng.chance(0.6) ? `${rng.pick(NAME_STEMS)}邸${rng.pick(SITE_KIND)}` : rng.pick(NEUTRAL_REMARKS);
            }
          }
          used.add(p.code);
        }
        if (made) {
          amountSum += made.billed * Math.max(0, made.qty);
          olines.push(made);
        }
      }
      // 運賃・荷造費・取付工賃・出精値引（商品マスタにないコード）
      const rf = rng.next();
      const fr = amountSum >= 150000 ? 0.2 : 0.06;
      if (olines.length && rf < fr) {
        olines.push({ kind: 'nonproduct', code: '9999', name: '運賃', unit: '式', qty: 1, billed: rng.int(15, 180) * 100, ptype: 0, remark: rng.chance(0.3) ? '現場直送' : '' });
      } else if (olines.length && rf < fr + 0.004) {
        olines.push({ kind: 'nonproduct', code: '9998', name: '荷造費', unit: '式', qty: 1, billed: rng.int(3, 20) * 100, ptype: 0, remark: '' });
      } else if (olines.length && rf < fr + 0.0075) {
        olines.push({ kind: 'nonproduct', code: '9980', name: '取付工賃', unit: '式', qty: 1, billed: rng.int(80, 600) * 100, ptype: 0, remark: '' });
      } else if (olines.length && rf < fr + 0.0095) {
        olines.push({ kind: 'nonproduct', code: '9900', name: '出精値引', unit: '式', qty: 1, billed: -rng.int(5, 80) * 100, ptype: 0, remark: '' });
      }
      olines.forEach((o, i) => {
        lines.push({ slip, ln: i + 1, d, c, ...o });
      });
    }
  }
  // 原価・定価・書きゆれを確定
  const rng2 = new RNG(hashStr(opts.seedName + ':fmt:' + SEED));
  for (const l of lines) {
    if (l.kind === 'nonproduct') {
      l.listCo = l.billed;
      l.cost100 = 0;
      l.code = l.code;
      l.rawCode = l.code;
      l.rawName = l.name;
      l.rawUnit = l.unit;
    } else {
      l.listCo = priceAt(l.p, l.d);
      l.cost100 = costAt(l.p, l.d);
      l.rawCode = fmtCode(l.p.code, l.c.office, rng2);
      l.rawName = l.p.name;
      l.rawUnit = l.p.unit;
      l.code = l.p.code;
    }
  }
  return { lines, nextSlip: slip };
}
