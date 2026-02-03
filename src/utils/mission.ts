import { questionBank } from '../data/questions';
import type {
  MissionMode,
  MissionPlan,
  MissionSession,
  Question,
  SkillProgress,
  Subject,
  SubjectAdaptiveMap,
  SubjectAdaptiveState,
} from '../types';

const MISSION_SIZE = 5;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 5;
const BASE_MASTERY = 45;

const REVIEW_INTERVALS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
];

export function createDefaultAdaptiveMap(): SubjectAdaptiveMap {
  return {
    math: { targetDifficulty: 1, missionCount: 0 },
    japanese: { targetDifficulty: 1, missionCount: 0 },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function subjectQuestions(subject: Subject): Question[] {
  return questionBank.filter((question) => question.subject === subject);
}

function getSubjectSkillIds(subject: Subject): string[] {
  return Array.from(new Set(subjectQuestions(subject).map((question) => question.skillId)));
}

function getSkillProgress(skillProgress: Record<string, SkillProgress>, skillId: string, now: number): SkillProgress {
  const existing = skillProgress[skillId];
  if (existing) return existing;
  return {
    mastery: BASE_MASTERY,
    streak: 0,
    nextReviewAt: now,
    seenCount: 0,
  };
}

function pickQuestion(
  candidates: Question[],
  usedIds: Set<string>,
  targetDifficulty: number,
  mode: 'core' | 'challenge',
): Question | undefined {
  const available = candidates.filter((question) => !usedIds.has(question.id));
  if (available.length === 0) return undefined;

  const desired = mode === 'challenge' ? clamp(targetDifficulty + 1, MIN_DIFFICULTY, MAX_DIFFICULTY) : targetDifficulty;

  return shuffle(available)
    .map((question) => {
      const challengePenalty = mode === 'challenge' && question.difficulty < desired ? 3 : 0;
      const score = Math.abs(question.difficulty - desired) + challengePenalty;
      return { question, score };
    })
    .sort((a, b) => a.score - b.score)[0]?.question;
}

function pickBySkills(
  skillIds: string[],
  buckets: Map<string, Question[]>,
  usedIds: Set<string>,
  targetDifficulty: number,
  count: number,
): Question[] {
  const selected: Question[] = [];

  for (const skillId of skillIds) {
    if (selected.length >= count) break;
    const questions = buckets.get(skillId) ?? [];
    const near = questions.filter((question) => Math.abs(question.difficulty - targetDifficulty) <= 1);
    const picked = pickQuestion(near.length > 0 ? near : questions, usedIds, targetDifficulty, 'core');

    if (!picked) continue;
    usedIds.add(picked.id);
    selected.push(picked);
  }

  return selected;
}

function buildSkillBuckets(questions: Question[]): Map<string, Question[]> {
  const buckets = new Map<string, Question[]>();
  for (const question of questions) {
    const bucket = buckets.get(question.skillId) ?? [];
    bucket.push(question);
    buckets.set(question.skillId, bucket);
  }
  return buckets;
}

export function buildAdaptiveMission(
  subject: Subject,
  subjectState: SubjectAdaptiveState,
  skillProgress: Record<string, SkillProgress>,
  now = Date.now(),
): { questions: Question[]; plan: MissionPlan } {
  const questions = subjectQuestions(subject);
  const buckets = buildSkillBuckets(questions);
  const skills = getSubjectSkillIds(subject);

  const dueSkills = skills
    .map((skillId) => ({
      skillId,
      progress: getSkillProgress(skillProgress, skillId, now),
    }))
    .filter(({ progress }) => progress.nextReviewAt <= now)
    .sort((a, b) => a.progress.mastery - b.progress.mastery || a.progress.seenCount - b.progress.seenCount)
    .map(({ skillId }) => skillId);

  const weaknessSkills = skills
    .map((skillId) => ({
      skillId,
      progress: getSkillProgress(skillProgress, skillId, now),
    }))
    .sort((a, b) => a.progress.mastery - b.progress.mastery || a.progress.seenCount - b.progress.seenCount)
    .map(({ skillId }) => skillId);

  const usedIds = new Set<string>();
  const reviewCountTarget = Math.min(2, dueSkills.length);
  const reviewQuestions = pickBySkills(dueSkills, buckets, usedIds, subjectState.targetDifficulty, reviewCountTarget);

  const hasChallengeCandidate = questions.some(
    (question) => question.difficulty >= clamp(subjectState.targetDifficulty + 1, MIN_DIFFICULTY, MAX_DIFFICULTY),
  );
  const challengeCountTarget = hasChallengeCandidate ? 1 : 0;
  const coreCountTarget = MISSION_SIZE - reviewQuestions.length - challengeCountTarget;

  const coreQuestions = pickBySkills(
    weaknessSkills,
    buckets,
    usedIds,
    subjectState.targetDifficulty,
    Math.max(0, coreCountTarget),
  );

  const challengeQuestions: Question[] = [];
  if (challengeCountTarget > 0) {
    const challenge = pickQuestion(questions, usedIds, subjectState.targetDifficulty, 'challenge');
    if (challenge) {
      usedIds.add(challenge.id);
      challengeQuestions.push(challenge);
    }
  }

  const selected = [...reviewQuestions, ...coreQuestions, ...challengeQuestions];

  if (selected.length < MISSION_SIZE) {
    const fillers = shuffle(questions.filter((question) => !usedIds.has(question.id))).slice(0, MISSION_SIZE - selected.length);
    selected.push(...fillers);
  }

  const reviewCount = reviewQuestions.length;
  const challengeCount = challengeQuestions.length;
  const coreCount = selected.length - reviewCount - challengeCount;

  const mode: MissionMode =
    reviewCount >= 2 ? 'review' : challengeCount === 1 && subjectState.targetDifficulty >= 2 ? 'challenge' : 'learn';

  const plan: MissionPlan = {
    mode,
    targetDifficulty: subjectState.targetDifficulty,
    reviewCount,
    coreCount,
    challengeCount,
  };

  return {
    questions: selected.slice(0, MISSION_SIZE),
    plan,
  };
}

export function evaluateMission(mission: MissionSession, answers: number[]) {
  const outcomes = mission.questions.map((question, index) => {
    const correct = answers[index] === question.answerIndex;
    return {
      questionId: question.id,
      skillId: question.skillId,
      difficulty: question.difficulty,
      correct,
    };
  });

  const total = mission.questions.length;
  const correct = outcomes.reduce((count, outcome) => count + (outcome.correct ? 1 : 0), 0);
  const accuracy = total === 0 ? 0 : correct / total;
  const avgDifficulty =
    total === 0 ? mission.plan.targetDifficulty : mission.questions.reduce((sum, question) => sum + question.difficulty, 0) / total;

  return {
    outcomes,
    total,
    correct,
    accuracy,
    avgDifficulty,
  };
}

export function updateAdaptiveProgress(params: {
  subject: Subject;
  subjectState: SubjectAdaptiveState;
  skillProgress: Record<string, SkillProgress>;
  outcomes: Array<{ skillId: string; difficulty: number; correct: boolean }>;
  accuracy: number;
  avgDifficulty: number;
  mode: MissionMode;
  now?: number;
}) {
  const { subject, subjectState, skillProgress, outcomes, accuracy, avgDifficulty, mode } = params;
  const now = params.now ?? Date.now();

  const nextSkillProgress: Record<string, SkillProgress> = { ...skillProgress };
  const dueBefore = new Set<string>();

  for (const outcome of outcomes) {
    const previous = getSkillProgress(skillProgress, outcome.skillId, now);
    if (previous.nextReviewAt <= now) {
      dueBefore.add(outcome.skillId);
    }

    if (outcome.correct) {
      const gain = 6 + Math.max(0, outcome.difficulty - subjectState.targetDifficulty) * 2;
      const streak = previous.streak + 1;
      const interval = REVIEW_INTERVALS_MS[Math.min(streak, REVIEW_INTERVALS_MS.length - 1)];

      nextSkillProgress[outcome.skillId] = {
        mastery: clamp(previous.mastery + gain, 0, 100),
        streak,
        nextReviewAt: now + interval,
        seenCount: previous.seenCount + 1,
      };
      continue;
    }

    nextSkillProgress[outcome.skillId] = {
      mastery: clamp(previous.mastery - (10 + outcome.difficulty * 2), 0, 100),
      streak: 0,
      nextReviewAt: now + 3 * 60 * 1000,
      seenCount: previous.seenCount + 1,
    };
  }

  const reviewedSkills = Array.from(
    new Set(outcomes.map((outcome) => outcome.skillId).filter((skillId) => dueBefore.has(skillId))),
  ).length;

  const subjectSkills = getSubjectSkillIds(subject);
  const avgMastery =
    subjectSkills.reduce((sum, skillId) => sum + getSkillProgress(nextSkillProgress, skillId, now).mastery, 0) /
    subjectSkills.length;

  const beforeDifficulty = subjectState.targetDifficulty;
  let afterDifficulty = beforeDifficulty;

  if (
    accuracy >= 0.8 &&
    avgMastery >= 55 &&
    avgDifficulty >= beforeDifficulty - 0.25 &&
    mode !== 'review'
  ) {
    afterDifficulty += 1;
  }

  if (accuracy <= 0.4) {
    afterDifficulty -= 1;
  }

  afterDifficulty = clamp(afterDifficulty, MIN_DIFFICULTY, MAX_DIFFICULTY);

  return {
    subjectState: {
      targetDifficulty: afterDifficulty,
      missionCount: subjectState.missionCount + 1,
    },
    skillProgress: nextSkillProgress,
    beforeDifficulty,
    afterDifficulty,
    avgMastery,
    reviewedSkills,
  };
}

export function calcRewards(params: {
  correct: number;
  total: number;
  mode: MissionMode;
  beforeDifficulty: number;
  afterDifficulty: number;
  avgDifficulty: number;
}) {
  const { correct, total, mode, beforeDifficulty, afterDifficulty, avgDifficulty } = params;

  const baseXp = correct * 10;
  const modeBonus = mode === 'challenge' ? 12 : mode === 'review' ? 8 : 5;
  const accuracyBonus = total === 0 ? 0 : Math.round((correct / total) * 10);
  const progressionBonus = afterDifficulty > beforeDifficulty ? 15 : 0;
  const difficultyBonus = Math.round(avgDifficulty * 2);

  const baseStars = correct;
  const clearBonusStars = correct === total ? 3 : 1;
  const progressionStars = afterDifficulty > beforeDifficulty ? 1 : 0;

  return {
    earnedXp: baseXp + modeBonus + accuracyBonus + progressionBonus + difficultyBonus,
    earnedStars: baseStars + clearBonusStars + progressionStars,
  };
}

export function getDueReviewCount(subject: Subject, skillProgress: Record<string, SkillProgress>, now = Date.now()): number {
  return getSubjectSkillIds(subject).filter((skillId) => {
    const progress = skillProgress[skillId];
    if (!progress) return false;
    return progress.seenCount > 0 && progress.nextReviewAt <= now;
  }).length;
}

export function getSubjectMastery(subject: Subject, skillProgress: Record<string, SkillProgress>, now = Date.now()): number {
  const skills = getSubjectSkillIds(subject);
  if (skills.length === 0) return BASE_MASTERY;

  const masterySum = skills.reduce((sum, skillId) => sum + getSkillProgress(skillProgress, skillId, now).mastery, 0);
  return Math.round(masterySum / skills.length);
}
