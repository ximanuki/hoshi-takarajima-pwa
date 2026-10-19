// 正解の判定（文書化された価格ルールをそのまま適用する）
import { mulRate } from './util.mjs';
import { TIERS } from './catalog.mjs';
import { listFor, prevListFor, specialAt, priceAt } from './world.mjs';

export function parseVol(remark) {
  const s = (remark || '').normalize('NFKC');
  const m = s.match(/数量値引\s*([0-9]+(?:\.[0-9]+)?)\s*%/) || s.match(/まとめ買い\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*引/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 10);
}
export function isSampleRemark(remark) {
  return /見本|サンプル|無償|試供/.test((remark || '').normalize('NFKC'));
}

function causeLabel(w, c, p) {
  const ag = w.ag2.get(c.code);
  if (!ag) return 'ok_declined';
  if (ag.status === 'declined' || ag.status === 'negotiating' || (ag.status === 'partial' && ag.excl.has(p.cat))) return 'ok_declined';
  return 'ok_deferred';
}

const NONE = { reference: '', refKind: 'other', shortfall: 0, below: 0, floorPrice: '', floorGap: 0 };

export function judgeMain(w, L) {
  const c = L.c;
  if (L.kind === 'nonproduct' || c.ghost || !L.p.inMaster) return { ...NONE, label: 'ok_non_product' };
  if (L.qty < 0) return { ...NONE, label: 'ok_return' };
  if (L.billed === 0 && isSampleRemark(L.remark)) return { ...NONE, label: 'ok_sample' };
  const p = L.p;
  const d = L.d;
  const billed = L.billed;
  const qty = L.qty;
  const floorPrice = Math.ceil(L.cost100 / 90);
  const below = 90 * billed < L.cost100 ? 1 : 0;
  const floorGap = below ? (floorPrice - billed) * qty : 0;
  const sp = specialAt(w, c, p, d);
  const Lc = listFor(w, c, p, d);
  const normal = mulRate(Lc, c.rate1000);
  const ref = sp ? sp.price : normal;
  const co = priceAt(p, d);
  let refKind = sp ? 'special' : Lc === co ? 'list_x_rate' : 'old_list_x_rate';
  let reference = ref;
  let label;
  if (billed === ref) {
    label = sp ? 'ok_special' : Lc === co ? 'ok' : causeLabel(w, c, p);
  } else if (billed > ref) {
    label = 'overcharge';
  } else {
    const v10 = parseVol(L.remark);
    if (v10 !== null && Math.floor((ref * (1000 - v10)) / 1000) === billed) {
      label = 'ok_volume_discount';
      reference = billed;
    } else {
      const prev = prevListFor(w, c, p, d);
      const prevPrice = prev !== null ? mulRate(prev, c.rate1000) : null;
      const exp = (w.specialMap.get(c.code + '|' + p.code) || []).some((s) => s.end < d && s.price === billed);
      if (!sp && prevPrice !== null && prevPrice === billed) label = 'leak_old_price';
      else if (exp) label = 'leak_expired_special';
      else {
        const lo = mulRate(Lc, TIERS[c.tier].lo);
        const hi = mulRate(Lc, TIERS[c.tier].hi);
        label = billed < lo || billed > hi ? 'leak_rate_out_of_tier' : 'unexplained';
      }
    }
  }
  let shortfall = 0;
  if (label.startsWith('ok') && below) {
    label = 'leak_below_margin_floor';
    shortfall = floorGap;
  } else if (label === 'leak_old_price' || label === 'leak_expired_special' || label === 'leak_rate_out_of_tier') {
    shortfall = (ref - billed) * qty;
  }
  return {
    label,
    reference,
    refKind,
    shortfall,
    below,
    floorPrice,
    floorGap,
  };
}

// 判断が分かれる行：A/B の2通りの読みを返す
export function ambiguityOf(L, j) {
  if (!L.amb) return null;
  const pat = L.amb.pattern;
  if (pat === 'PARTIAL_NO_CATEGORY') {
    if (j.label !== 'leak_old_price') return null;
    return { pattern: pat, A: 'leak_old_price', B: 'ok_declined' };
  }
  if (pat === 'FREE_GOODS_OTHER_WORDING') return { pattern: pat, A: 'ok_sample', B: j.label };
  if (pat === 'DISCOUNT_REMARK_NO_RATE') return { pattern: pat, A: 'ok_volume_discount', B: j.label };
  if (pat === 'DISCOUNT_ROUNDING') return { pattern: pat, A: 'ok_volume_discount', B: j.label };
  return null;
}
