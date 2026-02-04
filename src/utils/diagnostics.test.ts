import { describe, expect, it } from 'vitest';
import { questionBank } from '../data/questions';
import type { AnswerTrace, Question } from '../types';
import { getGuessThresholdMs, inferErrorTag } from './diagnostics';

function makeTrace(latencyMs: number): AnswerTrace {
  return {
    answeredAt: 0,
    subject: 'math',
    questionId: 'm1',
    skillId: 'add_within10',
    difficulty: 1,
    selectedIndex: 0,
    correct: true,
    latencyMs,
  };
}

describe('diagnostics', () => {
  it('uses default threshold when samples are insufficient', () => {
    const threshold = getGuessThresholdMs({
      subject: 'math',
      difficulty: 1,
      diagnosticLogs: [makeTrace(1200), makeTrace(1000)],
    });

    expect(threshold).toBe(900);
  });

  it('uses dynamic threshold with clamp when enough samples exist', () => {
    const threshold = getGuessThresholdMs({
      subject: 'math',
      difficulty: 1,
      diagnosticLogs: Array.from({ length: 20 }, () => makeTrace(1000)),
    });

    expect(threshold).toBe(700);
  });

  it('prefers metadata tags when available', () => {
    const question = questionBank.find((entry) => entry.id === 'm1');
    expect(question).toBeTruthy();

    const tag = inferErrorTag({
      question: question as Question,
      selectedIndex: 0,
      correct: false,
      latencyMs: 3000,
      guessThresholdMs: 900,
    });

    expect(tag).toBe('math_counting_slip');
  });

  it('falls back to unknown_guess for fast wrong answers without metadata', () => {
    const fakeQuestion: Question = {
      id: 'x1',
      subject: 'math',
      skillId: 'add_within10',
      difficulty: 1,
      prompt: '1+1?',
      choices: ['1', '2', '3'],
      answerIndex: 1,
      hint: '',
    };

    const tag = inferErrorTag({
      question: fakeQuestion,
      selectedIndex: 0,
      correct: false,
      latencyMs: 500,
      guessThresholdMs: 900,
    });

    expect(tag).toBe('unknown_guess');
  });
});

