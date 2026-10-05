import { describe, expect, it } from 'vitest';
import { islandPaths } from '../data/islandPaths';
import { getLesson } from '../data/lessons';
import { questionBank } from '../data/questions';
import { SUBJECTS } from '../data/subjects';
import {
  SKILL_MISSION_SIZE,
  buildSkillMission,
  getIslandStars,
  getNextStepInIsland,
  isStageUnlocked,
  skillQuestions,
  starsForAccuracy,
} from './practice';

describe('island paths and lessons', () => {
  it('puts every skill on exactly one island path, matching its subject', () => {
    const skills = new Map<string, string>();
    for (const question of questionBank) skills.set(question.skillId, question.subject);
    const placed = SUBJECTS.flatMap((subject) => islandPaths[subject].map((stage) => ({ subject, skillId: stage.skillId })));
    expect(placed.map((entry) => entry.skillId).sort()).toEqual([...skills.keys()].sort());
    for (const entry of placed) expect(skills.get(entry.skillId), entry.skillId).toBe(entry.subject);
  });

  it('has a lesson with steps and an example for every skill', () => {
    for (const subject of SUBJECTS) {
      for (const stage of islandPaths[subject]) {
        const lesson = getLesson(stage.skillId);
        expect(lesson, stage.skillId).toBeDefined();
        expect(lesson?.steps.length, stage.skillId).toBeGreaterThan(0);
        expect(lesson?.example.answer, stage.skillId).toBeTruthy();
      }
    }
  });
});

describe('buildSkillMission', () => {
  it('builds 5 questions from the requested skill, easiest first', () => {
    const { questions, plan } = buildSkillMission('add_within20', 'practice');
    expect(questions).toHaveLength(SKILL_MISSION_SIZE);
    expect(new Set(questions.map((question) => question.id)).size).toBe(SKILL_MISSION_SIZE);
    expect(questions.every((question) => question.skillId === 'add_within20')).toBe(true);
    const difficulties = questions.map((question) => question.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
    expect(plan.mode).toBe('learn');
  });

  it('makes boss missions at least as hard as practice on average', () => {
    for (const skillId of ['animals_life', 'calendar_days', 'sub_within20']) {
      const avg = (kind: 'practice' | 'boss') => {
        let total = 0;
        for (let run = 0; run < 20; run += 1) {
          const { questions } = buildSkillMission(skillId, kind);
          total += questions.reduce((sum, question) => sum + question.difficulty, 0) / questions.length;
        }
        return total / 20;
      };
      expect(avg('boss'), skillId).toBeGreaterThanOrEqual(avg('practice'));
    }
  });

  it('prefers questions that were not seen recently', () => {
    const pool = skillQuestions('clock_hour');
    const recent = pool.slice(0, pool.length - SKILL_MISSION_SIZE).map((question) => question.id);
    const { questions } = buildSkillMission('clock_hour', 'practice', recent);
    // れんしゅうの はんいに あたらしい もんだいが のこっていれば それを えらぶ
    expect(questions.some((question) => !recent.includes(question.id))).toBe(true);
  });
});

describe('stars and unlocking', () => {
  it('scores practice and boss runs', () => {
    expect(starsForAccuracy(1, 'practice')).toBe(3);
    expect(starsForAccuracy(0.4, 'practice')).toBe(1);
    expect(starsForAccuracy(0.2, 'practice')).toBe(0);
    expect(starsForAccuracy(0.4, 'boss')).toBe(0);
  });

  it('unlocks the next stage after one practice star', () => {
    expect(isStageUnlocked(0, undefined)).toBe(true);
    expect(isStageUnlocked(1, { lesson: 3, practice: 0, boss: 0 })).toBe(false);
    expect(isStageUnlocked(1, { lesson: 0, practice: 1, boss: 0 })).toBe(true);
  });

  it('suggests the lesson first, then practice, then moves along the path', () => {
    const first = islandPaths.math[0].skillId;
    const second = islandPaths.math[1].skillId;
    expect(getNextStepInIsland('math', {})).toMatchObject({ skillId: first, kind: 'lesson', stageIndex: 0 });
    expect(getNextStepInIsland('math', { [first]: { lesson: 3, practice: 0, boss: 0 } })).toMatchObject({ kind: 'practice' });
    expect(getNextStepInIsland('math', { [first]: { lesson: 3, practice: 2, boss: 0 } })).toMatchObject({
      skillId: second,
      kind: 'lesson',
    });
  });

  it('counts island stars', () => {
    const first = islandPaths.nature[0].skillId;
    expect(getIslandStars('nature', { [first]: { lesson: 3, practice: 3, boss: 3 } })).toEqual({
      earned: 7,
      max: islandPaths.nature.length * 7,
    });
  });
});
