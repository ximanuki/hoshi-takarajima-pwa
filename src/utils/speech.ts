// ブラウザの おんせいごうせい（Web Speech API）で もんだいを よみあげる。
// 1ねんせいでも ひとりで あそべるように するための サポート。

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

let cachedVoice: SpeechSynthesisVoice | null | undefined;

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function pickJapaneseVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  cachedVoice = voices.find((voice) => voice.lang === 'ja-JP') ?? voices.find((voice) => voice.lang.startsWith('ja')) ?? null;
  return cachedVoice;
}

export function toSpeakableText(text: string): string {
  return SPEAK_REPLACEMENTS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text: string): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(toSpeakableText(text));
  utterance.lang = 'ja-JP';
  utterance.rate = 0.92;
  utterance.pitch = 1.1;
  const voice = pickJapaneseVoice();
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}
