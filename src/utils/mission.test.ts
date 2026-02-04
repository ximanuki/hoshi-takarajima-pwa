import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MisconceptionTag, SkillProgress } from '../types';
import { buildAdaptiveMission, updateAdaptiveProgress } from './mission';

const MATH_SKILLS = ['add_within10', 'add_within20', 'compare_numbers', 'sub_within10', 'sub_within20', 'word_math'];

function makeSkillProgress(
  overrides: Partial<Record<string, Partial<SkillProgress>>>,
): Record<string, SkillProgress> {
  const now = Date.now();
  const base: SkillProgress = {
    mastery: 80,
    streak: 0,
    nextReviewAt: now + 10_000,
    seenCount: 1,
    misconceptions: {},
  };

  return Object.fromEntries(
    MATH_SKILLS.map((skillId) => {
      const patch = overrides[skillId] ?? {};
      return [
        skillId,
        {
          ...base,
          ...patch,
          misconceptions: patch.misconceptions ?? base.misconceptions,
        },
      ];
    }),
  );
}

function misconceptionState(tag: MisconceptionTag, priority: number): Partial<SkillProgress> {
  const now = Date.now();
  return {
    misconceptions: {
      [tag]: {
        errorCount: 3,
        recentErrorCount: 2,
        resolvedStreak: 0,
        priority,
        dueAt: now - 1,
        lastSeenAt: now - 2,
      },
    },
    lastErrorTag: tag,
  };
}

describe('mission step1', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prioritizes misconception questions in mission building', () => {
    const skillProgress = makeSkillProgress({
      add_within10: misconceptionState('math_counting_slip', 80),
    });

    const result = buildAdaptiveMission(
      'math',
      { targetDifficulty: 2, missionCount: 4 },
      skillProgress,
      [],
      Date.now(),
    );

    expect(result.plan.misconceptionCount).toBeGreaterThan(0);
    expect(result.questions.some((question) => question.skillId === 'add_within10')).toBe(true);
  });

  it('blocks promotion when unresolved misconceptions are too high', () => {
    const skillProgress = makeSkillProgress({
      add_within10: misconceptionState('math_counting_slip', 100),
      sub_within10: misconceptionState('math_operation_confusion', 100),
    });

    const result = updateAdaptiveProgress({
      subject: 'math',
      subjectState: { targetDifficulty: 2, missionCount: 0 },
      skillProgress,
      outcomes: [
        { skillId: 'add_within10', difficulty: 2, correct: true },
        { skillId: 'sub_within10', difficulty: 2, correct: true },
      ],
      accuracy: 1,
      avgDifficulty: 2,
      mode: 'learn',
      now: Date.now(),
    });

    expect(result.unresolvedIndex).toBeGreaterThanOrEqual(0.65);
    expect(result.afterDifficulty).toBe(1);
  });

  it('promotes when performance is strong and unresolved misconceptions are low', () => {
    const skillProgress = makeSkillProgress({});

    const result = updateAdaptiveProgress({
      subject: 'math',
      subjectState: { targetDifficulty: 2, missionCount: 0 },
      skillProgress,
      outcomes: [
        { skillId: 'add_within10', difficulty: 2, correct: true },
        { skillId: 'sub_within10', difficulty: 2, correct: true },
      ],
      accuracy: 1,
      avgDifficulty: 2,
      mode: 'learn',
      now: Date.now(),
    });

    expect(result.unresolvedIndex).toBe(0);
    expect(result.afterDifficulty).toBe(3);
  });
});

