import { questionBank } from '../data/questions';
import { questionMetaById } from '../data/question_meta';
import type {
  MisconceptionState,
  MisconceptionTag,
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
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 100;
const MISCONCEPTION_ERROR_BASE_INTERVAL_MS = 3 * 60 * 1000;
const MISCONCEPTION_ERROR_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MISCONCEPTION_RESOLVE_INTERVAL_MS = 8 * 60 * 60 * 1000;
const MISCONCEPTION_PRIORITY_THRESHOLD = 25;
const MISCONCEPTION_MAX_QUESTIONS = 2;
const MISCONCEPTION_DIFFICULTY_TOLERANCE = 2;
const PROMOTION_ACCURACY_MIN = 0.8;
const PROMOTION_MASTERY_MIN = 55;
const PROMOTION_UNRESOLVED_MAX = 0.35;
const DEMOTION_ACCURACY_MAX = 0.4;
const DEMOTION_UNRESOLVED_MIN = 0.65;

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
    life: { targetDifficulty: 1, missionCount: 0 },
    insight: { targetDifficulty: 1, missionCount: 0 },
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
  if (existing) {
    return {
      mastery: existing.mastery,
      streak: existing.streak,
      nextReviewAt: existing.nextReviewAt,
      seenCount: existing.seenCount,
      misconceptions: existing.misconceptions ?? {},
      lastErrorTag: existing.lastErrorTag,
    };
  }
  return {
    mastery: BASE_MASTERY,
    streak: 0,
    nextReviewAt: now,
    seenCount: 0,
    misconceptions: {},
  };
}

function createDefaultMisconceptionState(now: number): MisconceptionState {
  return {
    errorCount: 0,
    recentErrorCount: 0,
    resolvedStreak: 0,
    priority: 0,
    dueAt: now,
    lastSeenAt: now,
  };
}

function updateMisconceptionOnError(previous: MisconceptionState | undefined, difficulty: number, now: number): MisconceptionState {
  const base = previous ?? createDefaultMisconceptionState(now);
  const nextRecentErrorCount = base.recentErrorCount + 1;
  const severity = 1 + difficulty * 0.2;
  const interval = Math.min(
    MISCONCEPTION_ERROR_BASE_INTERVAL_MS * 2 ** Math.max(nextRecentErrorCount - 1, 0),
    MISCONCEPTION_ERROR_MAX_INTERVAL_MS,
  );

  return {
    errorCount: base.errorCount + 1,
    recentErrorCount: nextRecentErrorCount,
    resolvedStreak: 0,
    priority: clamp(base.priority + 12 * severity, MIN_PRIORITY, MAX_PRIORITY),
    dueAt: now + interval,
    lastSeenAt: now,
  };
}

function decayTopMisconception(
  misconceptions: Partial<Record<MisconceptionTag, MisconceptionState>>,
  now: number,
): Partial<Record<MisconceptionTag, MisconceptionState>> {
  const entries = Object.entries(misconceptions) as Array<[MisconceptionTag, MisconceptionState]>;
  if (entries.length === 0) return misconceptions;

  const top = entries.sort((a, b) => b[1].priority - a[1].priority)[0];
  if (!top) return misconceptions;

  const [topTag, topState] = top;
  const resolvedStreak = topState.resolvedStreak + 1;
  const priorityDrop = 6 + resolvedStreak * 2;

  return {
    ...misconceptions,
    [topTag]: {
      ...topState,
      resolvedStreak,
      recentErrorCount: Math.max(0, topState.recentErrorCount - 1),
      priority: clamp(topState.priority - priorityDrop, MIN_PRIORITY, MAX_PRIORITY),
      dueAt: now + MISCONCEPTION_RESOLVE_INTERVAL_MS,
      lastSeenAt: now,
    },
  };
}

function calcUnresolvedIndex(subjectSkills: string[], skillProgress: Record<string, SkillProgress>, now: number): number {
  const priorities = subjectSkills.flatMap((skillId) =>
    Object.values(getSkillProgress(skillProgress, skillId, now).misconceptions ?? {}).map((state) => state.priority),
  );

  if (priorities.length === 0) return 0;
  const top2 = [...priorities].sort((a, b) => b - a).slice(0, 2);
  const avgTopPriority = top2.reduce((sum, value) => sum + value, 0) / top2.length;
  return Number((avgTopPriority / 100).toFixed(3));
}

type MisconceptionCandidate = {
  skillId: string;
  tag: MisconceptionTag;
  priority: number;
  dueAt: number;
};

function getDueMisconceptionCandidates(
  skillIds: string[],
  skillProgress: Record<string, SkillProgress>,
  now: number,
): MisconceptionCandidate[] {
  const candidates: MisconceptionCandidate[] = [];

  for (const skillId of skillIds) {
    const progress = getSkillProgress(skillProgress, skillId, now);
    const entries = Object.entries(progress.misconceptions ?? {}) as Array<[MisconceptionTag, MisconceptionState | undefined]>;

    for (const [tag, state] of entries) {
      if (!state) continue;
      if (state.priority < MISCONCEPTION_PRIORITY_THRESHOLD) continue;
      if (state.dueAt > now) continue;
      candidates.push({
        skillId,
        tag,
        priority: state.priority,
        dueAt: state.dueAt,
      });
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority || a.dueAt - b.dueAt);
}

function hasMisconceptionTag(question: Question, tag: MisconceptionTag): boolean {
  return (questionMetaById[question.id]?.wrongChoiceTags ?? []).some((entry) => entry === tag);
}

function pickByMisconceptions(
  candidates: MisconceptionCandidate[],
  buckets: Map<string, Question[]>,
  usedIds: Set<string>,
  targetDifficulty: number,
  count: number,
  recentIds: Set<string>,
): Question[] {
  const selected: Question[] = [];
  const usedTags = new Set<MisconceptionTag>();

  const pickOne = (candidate: MisconceptionCandidate) => {
    const skillQuestions = buckets.get(candidate.skillId) ?? [];
    const tagged = skillQuestions.filter((question) => hasMisconceptionTag(question, candidate.tag));
    if (tagged.length === 0) return;

    const inRange = tagged.filter(
      (question) => Math.abs(question.difficulty - targetDifficulty) <= MISCONCEPTION_DIFFICULTY_TOLERANCE,
    );
    const picked = pickQuestion(inRange.length > 0 ? inRange : tagged, usedIds, targetDifficulty, 'core', recentIds);
    if (!picked) return;

    usedIds.add(picked.id);
    selected.push(picked);
    usedTags.add(candidate.tag);
  };

  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (usedTags.has(candidate.tag)) continue;
    pickOne(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= count) break;
    pickOne(candidate);
  }

  return selected;
}

function pickQuestion(
  candidates: Question[],
  usedIds: Set<string>,
  targetDifficulty: number,
  mode: 'core' | 'challenge',
  recentIds: Set<string>,
): Question | undefined {
  const available = candidates.filter((question) => !usedIds.has(question.id));
  if (available.length === 0) return undefined;

  const desired = mode === 'challenge' ? clamp(targetDifficulty + 1, MIN_DIFFICULTY, MAX_DIFFICULTY) : targetDifficulty;

  return shuffle(available)
    .map((question) => {
      const challengePenalty = mode === 'challenge' && question.difficulty < desired ? 3 : 0;
      const recentPenalty = recentIds.has(question.id) ? 2 : 0;
      const score = Math.abs(question.difficulty - desired) + challengePenalty + recentPenalty;
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
  recentIds: Set<string>,
): Question[] {
  const selected: Question[] = [];

  for (const skillId of skillIds) {
    if (selected.length >= count) break;
    const questions = buckets.get(skillId) ?? [];
    const near = questions.filter((question) => Math.abs(question.difficulty - targetDifficulty) <= 1);
    const picked = pickQuestion(near.length > 0 ? near : questions, usedIds, targetDifficulty, 'core', recentIds);

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
  recentQuestionIds: string[] = [],
  now = Date.now(),
): { questions: Question[]; plan: MissionPlan } {
  const questions = subjectQuestions(subject);
  const buckets = buildSkillBuckets(questions);
  const skills = getSubjectSkillIds(subject);
  const misconceptionCandidates = getDueMisconceptionCandidates(skills, skillProgress, now);

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
  const recentIds = new Set(recentQuestionIds);
  const misconceptionCountTarget = Math.min(MISCONCEPTION_MAX_QUESTIONS, misconceptionCandidates.length);
  const misconceptionQuestions = pickByMisconceptions(
    misconceptionCandidates,
    buckets,
    usedIds,
    subjectState.targetDifficulty,
    misconceptionCountTarget,
    recentIds,
  );

  const reviewCountTarget = Math.min(2, dueSkills.length, MISSION_SIZE - misconceptionQuestions.length);
  const reviewQuestions = pickBySkills(
    dueSkills,
    buckets,
    usedIds,
    subjectState.targetDifficulty,
    reviewCountTarget,
    recentIds,
  );

  const hasChallengeCandidate = questions.some(
    (question) => question.difficulty >= clamp(subjectState.targetDifficulty + 1, MIN_DIFFICULTY, MAX_DIFFICULTY),
  );
  const remainingAfterReview = MISSION_SIZE - misconceptionQuestions.length - reviewQuestions.length;
  const challengeCountTarget = hasChallengeCandidate && remainingAfterReview > 0 ? 1 : 0;
  const coreCountTarget = MISSION_SIZE - misconceptionQuestions.length - reviewQuestions.length - challengeCountTarget;

  const coreQuestions = pickBySkills(
    weaknessSkills,
    buckets,
    usedIds,
    subjectState.targetDifficulty,
    Math.max(0, coreCountTarget),
    recentIds,
  );

  const challengeQuestions: Question[] = [];
  if (challengeCountTarget > 0) {
    const challenge = pickQuestion(questions, usedIds, subjectState.targetDifficulty, 'challenge', recentIds);
    if (challenge) {
      usedIds.add(challenge.id);
      challengeQuestions.push(challenge);
    }
  }

  const selected = [...misconceptionQuestions, ...reviewQuestions, ...coreQuestions, ...challengeQuestions];

  if (selected.length < MISSION_SIZE) {
    const fillers = shuffle(questions.filter((question) => !usedIds.has(question.id))).slice(0, MISSION_SIZE - selected.length);
    selected.push(...fillers);
  }

  const reviewCount = reviewQuestions.length + misconceptionQuestions.length;
  const challengeCount = challengeQuestions.length;
  const coreCount = selected.length - reviewCount - challengeCount;

  const mode: MissionMode =
    reviewCount >= 2 ? 'review' : challengeCount === 1 && subjectState.targetDifficulty >= 2 ? 'challenge' : 'learn';

  const plan: MissionPlan = {
    mode,
    targetDifficulty: subjectState.targetDifficulty,
    misconceptionCount: misconceptionQuestions.length,
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
    const trace = mission.answerTraces[index];
    return {
      questionId: question.id,
      skillId: question.skillId,
      difficulty: question.difficulty,
      correct,
      errorTag: trace?.errorTag,
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
  outcomes: Array<{ skillId: string; difficulty: number; correct: boolean; errorTag?: MisconceptionTag }>;
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
        misconceptions: decayTopMisconception(previous.misconceptions ?? {}, now),
        lastErrorTag: previous.lastErrorTag,
      };
      continue;
    }

    const misconceptions = { ...(previous.misconceptions ?? {}) };
    let lastErrorTag = previous.lastErrorTag;
    if (outcome.errorTag) {
      misconceptions[outcome.errorTag] = updateMisconceptionOnError(
        misconceptions[outcome.errorTag],
        outcome.difficulty,
        now,
      );
      lastErrorTag = outcome.errorTag;
    }

    nextSkillProgress[outcome.skillId] = {
      mastery: clamp(previous.mastery - (10 + outcome.difficulty * 2), 0, 100),
      streak: 0,
      nextReviewAt: now + 3 * 60 * 1000,
      seenCount: previous.seenCount + 1,
      misconceptions,
      lastErrorTag,
    };
  }

  const reviewedSkills = Array.from(
    new Set(outcomes.map((outcome) => outcome.skillId).filter((skillId) => dueBefore.has(skillId))),
  ).length;

  const subjectSkills = getSubjectSkillIds(subject);
  const avgMastery =
    subjectSkills.reduce((sum, skillId) => sum + getSkillProgress(nextSkillProgress, skillId, now).mastery, 0) /
    subjectSkills.length;
  const unresolvedIndex = calcUnresolvedIndex(subjectSkills, nextSkillProgress, now);

  const beforeDifficulty = subjectState.targetDifficulty;
  let afterDifficulty = beforeDifficulty;

  if (
    accuracy >= PROMOTION_ACCURACY_MIN &&
    avgMastery >= PROMOTION_MASTERY_MIN &&
    unresolvedIndex <= PROMOTION_UNRESOLVED_MAX &&
    avgDifficulty >= beforeDifficulty - 0.25 &&
    mode !== 'review'
  ) {
    afterDifficulty += 1;
  }

  if (accuracy <= DEMOTION_ACCURACY_MAX || unresolvedIndex >= DEMOTION_UNRESOLVED_MIN) {
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
    unresolvedIndex,
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
