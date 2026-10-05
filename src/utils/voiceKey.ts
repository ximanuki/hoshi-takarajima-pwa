// よみあげ テキストの せいき化と、おんせいファイルの キー。
// アプリ（speech.ts）と せいせい スクリプト（scripts/generate-voice.mjs）で おなじものを つかう。
// node から そのまま import するので、ほかの ファイルを import しないこと。

const SPEAK_REPLACEMENTS: Array<[RegExp, string]> = [
  [/□/g, 'しかく'],
  [/△/g, 'さんかく'],
  [/○/g, 'まる'],
  [/＋|\+/g, ' たす '],
  [/−|-/g, ' ひく '],
  [/×/g, ' かける '],
  [/÷/g, ' わる '],
  [/＝|=/g, ' は '],
  [/→/g, '、'],
  [/／|\//g, '、'],
];

export function toSpeakableText(text: string): string {
  return SPEAK_REPLACEMENTS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32bit を 2つ ならべた 16けたの キー */
export function voiceKey(text: string): string {
  const source = toSpeakableText(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
