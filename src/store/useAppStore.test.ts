import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './useAppStore';

function answerAll(pick: (index: number, answerIndex: number) => number) {
  for (let guard = 0; guard < 20; guard += 1) {
    const mission = useAppStore.getState().mission;
    if (!mission) return;
    const question = mission.questions[mission.currentIndex];
    const choice = pick(mission.currentIndex, question.answerIndex);
    useAppStore.getState().submitAnswer(choice);
    if (choice !== question.answerIndex) useAppStore.getState().queueRetry();
    const latest = useAppStore.getState().mission!;
    if (latest.currentIndex >= latest.questions.length - 1) return;
    useAppStore.getState().goNextQuestion();
  }
}

describe('store: path missions', () => {
  beforeEach(() => {
    useAppStore.getState().clearProgress();
  });

  it('scores practice on the first pass only and unlocks the next stage', () => {
    useAppStore.getState().startMission('math', { skillId: 'add_within10', kind: 'practice' });
    // 1もんめだけ まちがえる → さいごに だしなおし（6もん）
    answerAll((index, answer) => (index === 0 ? (answer + 1) % 3 : answer));
    expect(useAppStore.getState().mission?.questions).toHaveLength(6);
    const result = useAppStore.getState().finishMission()!;
    expect(result.total).toBe(5);
    expect(result.correct).toBe(4);
    expect(result.nodeStars).toBe(2);
    expect(result.unlockedNextSkill).toBe('sub_within10');
    expect(useAppStore.getState().nodeProgress.add_within10.practice).toBe(2);
  });

  it('awards a sticker when the boss is defeated, counting retry hits', () => {
    useAppStore.getState().startMission('nature', { skillId: 'animals_life', kind: 'boss' });
    answerAll((index, answer) => (index === 2 ? (answer + 1) % 3 : answer));
    const result = useAppStore.getState().finishMission()!;
    expect(result.bossDefeated).toBe(true);
    expect(result.newSticker).toBe('🐘');
    expect(useAppStore.getState().stickers).toContain('animals_life');
    expect(useAppStore.getState().stats.bossWins).toBe(1);
  });

  it('lets the boss escape when a retry is also missed', () => {
    useAppStore.getState().startMission('nature', { skillId: 'seasons', kind: 'boss' });
    answerAll((index, answer) => (index === 0 || index === 5 ? (answer + 1) % 3 : answer));
    const result = useAppStore.getState().finishMission()!;
    expect(result.bossDefeated).toBe(false);
    expect(useAppStore.getState().stickers).not.toContain('seasons');
  });

  it('records lessons once for stats but keeps the best lesson stars', () => {
    useAppStore.getState().completeLesson('seasons', false);
    useAppStore.getState().completeLesson('seasons', true);
    const state = useAppStore.getState();
    expect(state.nodeProgress.seasons.lesson).toBe(3);
    expect(state.stats.lessonsDone).toBe(1);
    expect(state.badges).toContain('lesson_first');
  });
});
