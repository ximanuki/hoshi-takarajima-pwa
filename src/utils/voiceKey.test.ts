import { describe, expect, it } from 'vitest';
import { collectVoiceTexts } from '../../scripts/generate-voice.mjs';
import { allLessons } from '../data/lessons';
import { questionBank } from '../data/questions';
import { answerLine, lessonSpeech, PRAISE_LINES } from '../data/voiceLines';
import { toSpeakableText, voiceKey } from './voiceKey';

describe('voiceKey', () => {
  it('is stable, 16 hex chars, and ignores spacing differences', () => {
    expect(voiceKey('せいかい！')).toMatch(/^[0-9a-f]{16}$/);
    expect(voiceKey('せいかい！')).toBe(voiceKey('せいかい！'));
    expect(voiceKey('1 + 1 は いくつ？')).toBe(voiceKey('1  +  1 は  いくつ？'));
    expect(voiceKey('すごい！')).not.toBe(voiceKey('せいかい！'));
  });

  it('reads math symbols as words', () => {
    expect(toSpeakableText('□ + 3 = 7')).toBe('しかく たす 3 は 7');
  });
});

describe('generate-voice collectVoiceTexts', () => {
  const texts = collectVoiceTexts();

  it('covers every line the app can read aloud', () => {
    const expected = [
      ...PRAISE_LINES,
      ...questionBank.map((question) => question.prompt),
      ...questionBank.map((question) => answerLine(question.choices[question.answerIndex])),
      ...allLessons.flatMap((lesson) => {
        const lines = lessonSpeech(lesson);
        return [lines.goal, ...lines.steps, lines.example, lines.exampleAnswer, lines.tip];
      }),
    ];
    const missing = expected.filter((text) => !texts.has(voiceKey(text)));
    expect(missing).toEqual([]);
  });
});
