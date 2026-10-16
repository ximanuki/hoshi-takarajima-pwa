import { describe, expect, it } from 'vitest';
import {
  codeKey,
  customerKey,
  formatBp,
  formatPm,
  formatRatioPct,
  formatSen,
  formatYen,
  isSampleRemark,
  normalizeText,
  parseIntLoose,
  parsePercentPm,
  parseRemarkDiscount,
  parseScaled,
  parseSen,
  toFullWidth,
  withCommas,
} from './text.ts';

describe('normalisation', () => {
  it('turns 全角英数字 and 半角カナ into one form', () => {
    expect(normalizeText('ＤＢ－１００１ ')).toBe('DB-1001');
    expect(normalizeText('ｻﾝﾌﾟﾙ(無償)')).toBe('サンプル(無償)');
    expect(normalizeText('段ﾎﾞｰﾙ箱　Ａ式')).toBe('段ボール箱 A式');
  });

  it('matches 品番ゆれ to one key', () => {
    const variants = [
      'ＤＢ－１００１',
      'ＤＢ１００１',
      'ＤＢー１００１',
      'DB-1001',
      'DB1001',
      'db-1001',
      'DB-1001 ',
      'DB－1001',
      'DBｰ1001',
    ];
    for (const v of variants) expect(codeKey(v)).toBe('DB1001');
  });

  it('zero-pads customer codes', () => {
    expect(customerKey('００１００１')).toBe('001001');
    expect(customerKey('1001')).toBe('001001');
    expect(customerKey(' 1001 ')).toBe('001001');
    expect(customerKey('')).toBe('');
  });

  it('converts ASCII to full width', () => {
    expect(toFullWidth('DB-1001 A')).toBe('ＤＢ－１００１　Ａ');
    expect(normalizeText(toFullWidth('DB-1001'))).toBe('DB-1001');
  });
});

describe('number parsing', () => {
  it('reads integers with commas, 全角 and negative markers', () => {
    expect(parseIntLoose('12,800')).toBe(12800);
    expect(parseIntLoose('１，２３４')).toBe(1234);
    expect(parseIntLoose('△1,234')).toBe(-1234);
    expect(parseIntLoose('▲5')).toBe(-5);
    expect(parseIntLoose('-12')).toBe(-12);
    expect(parseIntLoose('(30)')).toBe(-30);
    expect(parseIntLoose('1,234円')).toBe(1234);
    expect(parseIntLoose('12.5')).toBeNull();
    expect(parseIntLoose('abc')).toBeNull();
    expect(parseIntLoose('')).toBeNull();
  });

  it('reads decimals exactly', () => {
    expect(parseSen('1,234.50')).toBe(123450);
    expect(parseSen('1234.5')).toBe(123450);
    expect(parseSen('311.41')).toBe(31141);
    expect(parseSen('12')).toBe(1200);
    expect(parseSen('1.234')).toBeNull();
    expect(parseSen('1.230')).toBe(123);
    expect(parsePercentPm('72.0')).toBe(720);
    expect(parsePercentPm('72.5%')).toBe(725);
    expect(parseScaled('0.725', 1000)).toBe(725);
    expect(parseScaled('-', 100)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats yen, sen, percentages', () => {
    expect(withCommas(1234567)).toBe('1,234,567');
    expect(withCommas(-1000)).toBe('-1,000');
    expect(withCommas(999)).toBe('999');
    expect(formatYen(12800)).toBe('12,800円');
    expect(formatSen(123450)).toBe('1,234.50');
    expect(formatSen(5)).toBe('0.05');
    expect(formatBp(518, 2)).toBe('5.18%');
    expect(formatBp(518)).toBe('5.2%');
    expect(formatBp(515)).toBe('5.2%');
    expect(formatBp(-909)).toBe('-9.1%');
    expect(formatBp(4, 1)).toBe('0.0%');
    expect(formatBp(1000, 0)).toBe('10%');
    expect(formatPm(725)).toBe('72.5%');
  });

  it('formats a ratio with a single rounding', () => {
    // -20 / 580 = -3.448%: rounding to basis points first would give -3.45% and then -3.5%
    expect(formatRatioPct(-20, 580)).toBe('-3.4%');
    expect(formatBp(-345)).toBe('-3.5%');
    expect(formatRatioPct(84, 1265)).toBe('6.6%');
    expect(formatRatioPct(1, 3, 2)).toBe('33.33%');
    expect(formatRatioPct(1, 8, 0)).toBe('13%');
    expect(formatRatioPct(1, 0)).toBe('-');
  });
});

describe('remarks', () => {
  it('reads volume discounts in several wordings', () => {
    expect(parseRemarkDiscount('数量値引3%')).toBe(300);
    expect(parseRemarkDiscount('数量値引き 3%')).toBe(300);
    expect(parseRemarkDiscount('まとめ買い5%引')).toBe(500);
    expect(parseRemarkDiscount('大口数量割引(5%)')).toBe(500);
    expect(parseRemarkDiscount('大口数量割引（５％）')).toBe(500);
    expect(parseRemarkDiscount('2.5%値引')).toBe(250);
    expect(parseRemarkDiscount('1割引')).toBe(1000);
    expect(parseRemarkDiscount('3%OFF')).toBe(300);
  });

  it('ignores remarks that are not discounts', () => {
    for (const r of [
      '至急',
      '納品書2部',
      '返品(伝票No.1000123)',
      '分納',
      '次回まとめて請求',
      '',
      '値引なし検討',
    ]) {
      expect(parseRemarkDiscount(r)).toBeNull();
    }
  });

  it('recognises free samples', () => {
    expect(isSampleRemark('見本品')).toBe(true);
    expect(isSampleRemark('ｻﾝﾌﾟﾙ(無償)')).toBe(true);
    expect(isSampleRemark('至急')).toBe(false);
  });
});
