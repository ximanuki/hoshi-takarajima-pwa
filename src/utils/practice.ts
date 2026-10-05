import { islandPaths } from '../data/islandPaths';
import { questionBank } from '../data/questions';
import type { MissionPlan, NodeKind, NodeStars, Question, Subject } from '../types';

export const SKILL_MISSION_SIZE = 5;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function skillQuestions(skillId: string): Question[] {
  return questionBank.filter((question) => question.skillId === skillId);
}

/**
 * スキル せんようの 5もん。
 * れんしゅう: スキルの なかで やさしい ほう 6わり から
 * ボス: スキルの なかで むずかしい ほう 5わり から
 * さいきん でた もんだいは なるべく さける。でる じゅんは やさしい → むずかしい。
 */
export function buildSkillMission(
  skillId: string,
  kind: Exclude<NodeKind, 'lesson'>,
  recentIds: string[] = [],
): { questions: Question[]; plan: MissionPlan } {
  const pool = [...skillQuestions(skillId)].sort((a, b) => a.difficulty - b.difficulty);
  const cut = kind === 'practice' ? pool.slice(0, Math.max(SKILL_MISSION_SIZE, Math.ceil(pool.length * 0.6))) : pool.slice(Math.floor(pool.length * 0.5));
  const band = cut.length >= SKILL_MISSION_SIZE ? cut : pool;

  const recent = new Set(recentIds);
  const fresh = shuffle(band.filter((question) => !recent.has(question.id)));
  const stale = shuffle(band.filter((question) => recent.has(question.id)));
  const questions = [...fresh, ...stale].slice(0, SKILL_MISSION_SIZE).sort((a, b) => a.difficulty - b.difficulty);
  const avg = questions.reduce((sum, question) => sum + question.difficulty, 0) / Math.max(1, questions.length);

  return {
    questions,
    plan: {
      mode: kind === 'boss' ? 'challenge' : 'learn',
      targetDifficulty: Math.round(avg) || 1,
      misconceptionCount: 0,
      reviewCount: 0,
      coreCount: kind === 'practice' ? questions.length : 0,
      challengeCount: kind === 'boss' ? questions.length : 0,
    },
  };
}

/** せいかいりつ → ほしの かず（0〜3）。ボスは ぜんもん せいかいで ★3 */
export function starsForAccuracy(accuracy: number, kind: Exclude<NodeKind, 'lesson'>): number {
  if (accuracy >= 1) return 3;
  if (kind === 'boss') return accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.4) return 1;
  return 0;
}

export function emptyNodeStars(): NodeStars {
  return { lesson: 0, practice: 0, boss: 0 };
}

/** ステージ i が ひらいているか: さいしょ か、まえの れんしゅうが ★1いじょう */
export function isStageUnlocked(index: number, previous: NodeStars | undefined): boolean {
  return index === 0 || (previous?.practice ?? 0) >= 1;
}

export type NextStep = { subject: Subject; skillId: string; kind: NodeKind; stageIndex: number };

/** しまの なかで つぎに やると よい ノード */
export function getNextStepInIsland(subject: Subject, nodeProgress: Record<string, NodeStars>): NextStep {
  const stages = islandPaths[subject];
  for (let index = 0; index < stages.length; index += 1) {
    const stars = nodeProgress[stages[index].skillId] ?? emptyNodeStars();
    if (stars.practice === 0) {
      return { subject, skillId: stages[index].skillId, kind: stars.lesson === 0 ? 'lesson' : 'practice', stageIndex: index };
    }
  }
  const bossIndex = stages.findIndex((stage) => (nodeProgress[stage.skillId]?.boss ?? 0) === 0);
  const index = bossIndex >= 0 ? bossIndex : stages.length - 1;
  return { subject, skillId: stages[index].skillId, kind: bossIndex >= 0 ? 'boss' : 'practice', stageIndex: index };
}

export function getNextStep(nodeProgress: Record<string, NodeStars>, lastIsland: Subject | null): NextStep {
  return getNextStepInIsland(lastIsland ?? 'math', nodeProgress);
}

export function getIslandStars(subject: Subject, nodeProgress: Record<string, NodeStars>): { earned: number; max: number } {
  const stages = islandPaths[subject];
  const earned = stages.reduce((sum, stage) => {
    const stars = nodeProgress[stage.skillId];
    return sum + (stars ? stars.lesson / 3 + stars.practice + stars.boss : 0);
  }, 0);
  // レッスンは 1つぶん、れんしゅう・ボスは 3つぶん → 1ステージ 7こ
  return { earned: Math.round(earned), max: stages.length * 7 };
}
