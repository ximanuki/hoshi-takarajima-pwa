export type VoiceKind = 'question' | 'answer' | 'lesson' | 'praise' | 'talk';

/** アプリが よみあげる テキストを ぜんぶ あつめる（key → よみあげ テキストと しゅるい） */
export function collectVoiceTexts(): Map<string, { text: string; kind: VoiceKind }>;
