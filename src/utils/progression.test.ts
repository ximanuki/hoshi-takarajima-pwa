import { describe, expect, it } from 'vitest';
import { SUBJECTS, createSubjectRecord } from '../data/subjects';
import type { PlayerStats } from '../types';
import {
  applyMissionToCounters,
  badgeMaster,
  createDailyQuestState,
  ensureDailyQuestState,
  findNewBadges,
  getDailyQuests,
  getIslandRank,
  getQuestStatuses,
  levelFromXp,
  levelProgress,
} from './progression';

const emptyStats: PlayerStats = {
  totalAnswered: 0,
  totalCorrect: 0,
  perfectCount: 0,
  bestCombo: 0,
  bestStreakDays: 0,
  challengeClears: 0,
  difficultyUps: 0,
  questsCompleted: 0,
  morningMissions: 0,
  lessonsDone: 0,
  bossWins: 0,
};

describe('levels', () => {
  it('advances one level per 100 XP', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelProgress(250)).toMatchObject({ level: 3, current: 50, needed: 100 });
  });
});

describe('island ranks', () => {
  it('ranks up at the configured clear counts', () => {
    expect(getIslandRank(0).rank).toBe(0);
    expect(getIslandRank(1).rank).toBe(1);
    expect(getIslandRank(5).rank).toBe(2);
    expect(getIslandRank(4).nextAt).toBe(5);
    expect(getIslandRank(999).nextAt).toBeNull();
  });
});

describe('badges', () => {
  it('has unique ids', () => {
    const ids = badgeMaster.map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('awards first clear and island badges from counts, skipping owned ones', () => {
    const subjectClears = createSubjectRecord(() => 0);
    subjectClears.nature = 3;
    const ctx = { stats: emptyStats, subjectClears, streakDays: 1, level: 1 };
    const fresh = findNewBadges([], ctx);
    expect(fresh).toContain('first_clear');
    expect(fresh).toContain('nature_ranger');
    expect(fresh).not.toContain('math_explorer');
    expect(findNewBadges(['first_clear'], ctx)).not.toContain('first_clear');
  });

  it('awards all_islands only when every island is cleared', () => {
    const subjectClears = createSubjectRecord(() => 1);
    subjectClears.insight = 0;
    const ctx = { stats: emptyStats, subjectClears, streakDays: 1, level: 1 };
    expect(findNewBadges([], ctx)).not.toContain('all_islands');
    subjectClears.insight = 1;
    expect(findNewBadges([], ctx)).toContain('all_islands');
  });
});

describe('daily quests', () => {
  it('is deterministic per day and picks distinct quest families', () => {
    const a = getDailyQuests('2026-10-04').map((quest) => quest.id);
    const b = getDailyQuests('2026-10-04').map((quest) => quest.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a.map((id) => id.split('_')[0])).size).toBe(3);
  });

  it('varies across days', () => {
    const days = Array.from({ length: 14 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
    const sets = new Set(days.map((day) => getDailyQuests(day).map((quest) => quest.id).join(',')));
    expect(sets.size).toBeGreaterThan(5);
  });

  it('tracks mission progress into counters', () => {
    let counters = createDailyQuestState('2026-10-04').counters;
    counters = applyMissionToCounters(counters, { subject: 'math', correct: 5, total: 5, maxCombo: 5, mode: 'learn' });
    counters = applyMissionToCounters(counters, { subject: 'math', correct: 2, total: 5, maxCombo: 1, mode: 'review' });
    expect(counters).toEqual({
      missions: 2,
      correct: 7,
      perfect: 1,
      maxCombo: 5,
      subjects: ['math'],
      reviewMissions: 1,
      lessons: 0,
      bosses: 0,
    });
  });

  it('resets state on a new day and reports quest completion', () => {
    const state = createDailyQuestState('2026-10-03');
    expect(ensureDailyQuestState(state, '2026-10-04').date).toBe('2026-10-04');
    expect(ensureDailyQuestState(state, '2026-10-03')).toBe(state);

    let counters = state.counters;
    for (const subject of SUBJECTS) {
      counters = applyMissionToCounters(counters, { subject, correct: 5, total: 5, maxCombo: 25, mode: 'review', kind: 'boss' });
    }
    counters = { ...counters, lessons: 2 };
    const statuses = getQuestStatuses({ ...state, counters });
    expect(statuses.every((quest) => quest.done)).toBe(true);
  });
});
