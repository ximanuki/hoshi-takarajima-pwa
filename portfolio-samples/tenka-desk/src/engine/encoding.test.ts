import { describe, expect, it } from 'vitest';
import {
  decodeBytes,
  detectEncoding,
  encodeShiftJis,
  encodeUtf8,
  UnmappableCharacterError,
} from './encoding.ts';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('detection and decoding', () => {
  it('detects UTF-8 with and without BOM', () => {
    expect(detectEncoding(encodeUtf8('得意先', true))).toEqual({ encoding: 'utf-8', bom: true });
    expect(detectEncoding(encodeUtf8('得意先', false))).toEqual({ encoding: 'utf-8', bom: false });
    const d = decodeBytes(encodeUtf8('得意先,品番', true));
    expect(d).toEqual({ text: '得意先,品番', encoding: 'utf-8', bom: true });
  });

  it('falls back to Shift_JIS when the bytes are not UTF-8', () => {
    const bytes = encodeShiftJis('得意先CD,品番,品名\r\n1001,DB-1001,ｴｱｰｷｬｯﾌﾟ\r\n');
    expect(detectEncoding(bytes).encoding).toBe('shift_jis');
    expect(decodeBytes(bytes).text).toBe('得意先CD,品番,品名\r\n1001,DB-1001,ｴｱｰｷｬｯﾌﾟ\r\n');
  });

  it('decodes UTF-16 with a BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x30]);
    expect(decodeBytes(bytes)).toEqual({ text: 'Aあ', encoding: 'utf-16le', bom: true });
  });

  it('honours an explicit encoding', () => {
    const sjis = encodeShiftJis('価格');
    expect(decodeBytes(sjis, 'shift_jis').text).toBe('価格');
  });
});

describe('encodeShiftJis', () => {
  it('produces the CP932 codes', () => {
    expect(hex(encodeShiftJis('あ'))).toBe('82 a0');
    expect(hex(encodeShiftJis('ア'))).toBe('83 41');
    expect(hex(encodeShiftJis('ｱ'))).toBe('b1');
    expect(hex(encodeShiftJis('－'))).toBe('81 7c');
    expect(hex(encodeShiftJis('①'))).toBe('87 40');
    // IBM extension preferred over the NEC-selected duplicate (0xED40)
    expect(hex(encodeShiftJis('纊'))).toBe('fa 5c');
    expect(hex(encodeShiftJis('A1,'))).toBe('41 31 2c');
  });

  it('round-trips typical 販売管理 text', () => {
    const s =
      '"００１００１","株式会社アルス運送","ＤＢ－１００１","段ボール箱　Ａ式　２００×１５０×１００ｍｍ","R08/12/01","3,825"\r\n';
    expect(decodeBytes(encodeShiftJis(s), 'shift_jis').text).toBe(s);
  });

  it('reports characters Shift_JIS cannot hold', () => {
    expect(() => encodeShiftJis('𠮷野家')).toThrow(UnmappableCharacterError);
    try {
      encodeShiftJis('𠮷と🍣');
    } catch (e) {
      expect((e as UnmappableCharacterError).characters).toEqual(['𠮷', '🍣']);
    }
    expect(decodeBytes(encodeShiftJis('𠮷野家', 'replace'), 'shift_jis').text).toBe('?野家');
  });
});

describe('Shift_JIS: characters typed on macOS or by an input method', () => {
  it('writes the CP932 code for MINUS SIGN, WAVE DASH, EM DASH, ‖, ¢, £, ¬ and ¥', () => {
    expect(hex(encodeShiftJis('−〜—‖¢£¬'))).toBe('81 7c 81 60 81 5c 81 61 81 91 81 92 81 ca');
    // ¥ as 全角 ￥, so reading the file back does not give a backslash
    expect(hex(encodeShiftJis('¥'))).toBe('81 8f');
  });

  it('saves ordinary names that used to fail, and reads them back', () => {
    const names = ['紙コップ 10〜20個入', '幅12−18mm', 'ラベル ¥100'];
    for (const n of names) {
      const back = decodeBytes(encodeShiftJis(n), 'shift_jis').text;
      expect(back.normalize('NFKC')).toBe(n.normalize('NFKC').replace('〜', '~').replace('−', '-'));
    }
  });
});
