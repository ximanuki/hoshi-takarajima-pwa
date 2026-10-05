// よみあげ。まえもって つくった ずんだもん（VOICEVOX）の おんせいが あれば それを ならし、
// なければ ブラウザの おんせいごうせい（Web Speech API）で よむ。
import { toSpeakableText, voiceKey } from './voiceKey';

export { toSpeakableText };

const VOICE_BASE = `${import.meta.env.BASE_URL}voice/`;
// みじかい むおんの WAV（iOS で さいしょの タップの ときに Audio を ひらく ため）
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

let manifestPromise: Promise<Set<string>> | null = null;
let voiceCount = 0;
let audio: HTMLAudioElement | null = null;
let requestId = 0;
let cachedVoice: SpeechSynthesisVoice | null | undefined;

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && (typeof Audio !== 'undefined' || 'speechSynthesis' in window);
}

function hasWebSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** おんせいファイルの いちらんを よみこむ（なければ からっぽ） */
export function loadVoiceManifest(): Promise<Set<string>> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${VOICE_BASE}manifest.json`)
      .then((response) => (response.ok ? response.json() : { keys: [] }))
      .then((data: { keys?: unknown }) => {
        const keys = Array.isArray(data.keys) ? data.keys.filter((key): key is string => typeof key === 'string') : [];
        voiceCount = keys.length;
        return new Set(keys);
      })
      .catch(() => new Set<string>());
  }
  return manifestPromise;
}

/** ずんだもんの おんせいが いくつ あるか（クレジット ひょうじ よう） */
export function getVoiceCount(): number {
  return voiceCount;
}

function getAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

/** さいしょの タップで よぶ。iOS でも あとから じどうで ならせるように する */
export function unlockVoice(): void {
  const element = getAudio();
  if (!element || element.dataset.unlocked) return;
  element.dataset.unlocked = '1';
  element.src = SILENT_WAV;
  void element.play().catch(() => undefined);
  void loadVoiceManifest();
}

function pickJapaneseVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  cachedVoice = voices.find((voice) => voice.lang === 'ja-JP') ?? voices.find((voice) => voice.lang.startsWith('ja')) ?? null;
  return cachedVoice;
}

function speakWithWebSpeech(text: string): void {
  if (!hasWebSpeech()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(toSpeakableText(text));
  utterance.lang = 'ja-JP';
  utterance.rate = 0.95;
  utterance.pitch = 1.35;
  const voice = pickJapaneseVoice();
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function speak(text: string): void {
  if (!text) return;
  stopSpeaking();
  const id = ++requestId;
  const key = voiceKey(text);

  void loadVoiceManifest().then((keys) => {
    if (id !== requestId) return;
    const element = getAudio();
    if (!keys.has(key) || !element) {
      speakWithWebSpeech(text);
      return;
    }
    element.src = `${VOICE_BASE}${key}.mp3`;
    element.play().catch(() => {
      if (id === requestId) speakWithWebSpeech(text);
    });
  });
}

export function stopSpeaking(): void {
  requestId += 1;
  if (audio && !audio.paused) {
    audio.pause();
  }
  if (hasWebSpeech()) window.speechSynthesis.cancel();
}
