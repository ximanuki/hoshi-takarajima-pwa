import { questionBank } from '../data/questions';
import type { Question, Subject } from '../types';

const MISSION_SIZE = 5;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildMission(subject: Subject): Question[] {
  const candidates = questionBank.filter((q) => q.subject === subject);
  return shuffle(candidates).slice(0, MISSION_SIZE);
}

export function calcRewards(correct: number, total: number) {
  const baseXp = correct * 10;
  const baseStars = correct;
  const clearBonusXp = correct === total ? 30 : 10;
  const clearBonusStars = correct === total ? 3 : 1;

  return {
    earnedXp: baseXp + clearBonusXp,
    earnedStars: baseStars + clearBonusStars,
  };
}
