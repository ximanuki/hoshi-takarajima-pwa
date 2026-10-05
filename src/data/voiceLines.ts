// よみあげる きまった セリフ。VOICEVOX の おんせいを まえもって つくる たいしょう。
// scripts/generate-voice.mjs からも import するので、type いがいの import は しないこと。
import type { Lesson } from './lessons';

export const PRAISE_LINES = ['せいかい！', 'すごい！', 'やったね！', 'ばっちり！', 'さすが！'];

export const GREETING_LINES: Record<'morning' | 'day' | 'night', string[]> = {
  morning: ['おはよう！ きょうも ぼうけんに いこう！', 'あさの おかしの しまへ しゅっぱつ！', 'おはよう！ キラキラを あつめに いこう！'],
  day: ['こんにちは！ どの しまに いく？', 'いい てんき！ おかしの しま びより！', 'こんにちは！ たからを さがそう！'],
  night: ['こんばんは！ ほしが きれいだね。', 'ゆめの うみを わたろう！', 'こんばんは！ すこしだけ ぼうけんしよう。'],
};

export const FIXED_LINES = [
  ...PRAISE_LINES,
  ...Object.values(GREETING_LINES).flat(),
  'レッスン クリア！ よく がんばったね！',
  'もんだいを よみあげるよ',
];

export function answerLine(answer: string): string {
  return `こたえは ${answer}`;
}

export type LessonSpeech = {
  goal: string;
  steps: string[];
  example: string;
  exampleAnswer: string;
  tip: string;
};

export function lessonSpeech(lesson: Lesson): LessonSpeech {
  return {
    goal: `きょうの めあて。${lesson.goal}`,
    steps: lesson.steps.map((step) => step.text),
    example: `れいだい。${lesson.example.question}`,
    exampleAnswer: `${answerLine(lesson.example.answer)}。${lesson.example.why}`,
    tip: `コツ。${lesson.tip}`,
  };
}

export function quizLine(prompt: string): string {
  return `ミニクイズ。${prompt}`;
}
