import { describe, expect, it } from 'vitest';
import dict from '../../scripts/voice-dict.json';
import { applyProfile, toReadingText, VOICE_PROFILES } from '../../scripts/voice-reading.mjs';
import { collectVoiceTexts } from '../../scripts/generate-voice.mjs';

describe('toReadingText', () => {
  it('removes spaces between Japanese words but keeps punctuation', () => {
    expect(toReadingText('おはよう！ きょうも ぼうけんに いこう！', dict)).toBe('おはよう！今日も冒険にいこう！');
  });

  it('converts frequent words to kanji only at word starts followed by particles', () => {
    expect(toReadingText('とけいの みじかい はりが 1、ながい はりが 12。なんじ？', dict)).toBe(
      '時計の短い針が1、長い針が12。何時？',
    );
    // 「とき」で はじまっても じょしが つづかない ことばは そのまま
    expect(toReadingText('ときどき あそぶ', dict)).toBe('ときどきあそぶ');
  });

  it('reads numbers with counters naturally', () => {
    expect(toReadingText('4こ を 2にんで わけると ひとり なんこ？', dict)).toBe('4個を2人で分けると一人何個？');
    expect(toReadingText('1じ から 10ぷん たつと？', dict)).toBe('1時から10分たつと？');
    expect(toReadingText('100えん 1まいと 3じはん', dict)).toBe('100円1枚と3時半');
  });

  it('adds a short pause before the answer', () => {
    expect(toReadingText('こたえは 13', dict)).toBe('答えは、13');
    expect(toReadingText('2じ ちょうどを あらわす こたえは？', dict)).toBe('2時ちょうどをあらわす答えは？');
  });

  it('never produces an empty reading for app lines', () => {
    const empty = [...collectVoiceTexts().values()].filter((entry) => toReadingText(entry.text, dict).length === 0);
    expect(empty).toEqual([]);
  });
});

describe('voice profiles', () => {
  it('reads lessons slower than praise and questions with longer pauses than praise', () => {
    expect(VOICE_PROFILES.lesson.speedScale).toBeLessThan(VOICE_PROFILES.praise.speedScale);
    expect(VOICE_PROFILES.question.pauseLengthScale).toBeGreaterThan(VOICE_PROFILES.praise.pauseLengthScale);
  });

  it('applies global multipliers on top of the profile', () => {
    const params = applyProfile({ speedScale: 1, accent_phrases: [] }, 'question', { speed: 1.1, pitch: 0.02 });
    expect(params.speedScale).toBeCloseTo(0.99);
    expect(params.pitchScale).toBeCloseTo(0.02);
    expect(params.accent_phrases).toEqual([]);
  });

  it('assigns every collected line a known kind', () => {
    const kinds = new Set([...collectVoiceTexts().values()].map((entry) => entry.kind));
    for (const kind of kinds) expect(Object.keys(VOICE_PROFILES)).toContain(kind);
  });
});
