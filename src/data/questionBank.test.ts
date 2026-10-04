import { describe, expect, it } from 'vitest';
import { questionBank } from './questions';
import { SUBJECTS, skillLabels } from './subjects';

describe('question bank', () => {
  it('has unique ids', () => {
    const ids = questionBank.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has three distinct choices and a valid answer for every question', () => {
    const broken = questionBank.filter(
      (question) =>
        question.choices.length !== 3 ||
        new Set(question.choices).size !== 3 ||
        question.answerIndex < 0 ||
        question.answerIndex >= question.choices.length,
    );
    expect(broken.map((question) => question.id)).toEqual([]);
  });

  it('covers every island with enough questions at each difficulty band', () => {
    for (const subject of SUBJECTS) {
      const questions = questionBank.filter((question) => question.subject === subject);
      expect(questions.length, subject).toBeGreaterThanOrEqual(100);
      expect(questions.some((question) => question.difficulty <= 2), subject).toBe(true);
      expect(questions.some((question) => question.difficulty >= 4), subject).toBe(true);
    }
  });

  it('has a child-friendly label for every skill', () => {
    const missing = Array.from(new Set(questionBank.map((question) => question.skillId))).filter((skillId) => !skillLabels[skillId]);
    expect(missing).toEqual([]);
  });
});
