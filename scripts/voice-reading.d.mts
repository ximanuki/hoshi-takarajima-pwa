export type VoiceDict = { nouns?: Record<string, string>; tokens?: Record<string, string> };
export type VoiceProfile = {
  speedScale: number;
  intonationScale: number;
  pitchScale: number;
  pauseLengthScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
};
export const VOICE_PROFILES: Record<'question' | 'answer' | 'lesson' | 'praise' | 'talk', VoiceProfile>;
export function toReadingText(text: string, dict?: VoiceDict): string;
export function applyProfile(
  query: Record<string, unknown>,
  kind: string,
  scale?: { speed?: number; intonation?: number; pitch?: number; pause?: number },
): Record<string, unknown> & VoiceProfile;
