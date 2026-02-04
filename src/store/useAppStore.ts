import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  buildAdaptiveMission,
  calcRewards,
  createDefaultAdaptiveMap,
  evaluateMission,
  updateAdaptiveProgress,
} from '../utils/mission';
import { getGuessThresholdMs, inferErrorTag } from '../utils/diagnostics';
import type {
  AnswerTrace,
  MisconceptionState,
  MisconceptionTag,
  MissionResult,
  MissionSession,
  Settings,
  SkillProgress,
  Subject,
  SubjectAdaptiveMap,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DIAGNOSTIC_LOGS = 200;
const DEFAULT_MASTERY = 45;

const MISCONCEPTION_TAGS: MisconceptionTag[] = [
  'unknown_guess',
  'attention_slip',
  'math_counting_slip',
  'math_operation_confusion',
  'math_place_value_confusion',
  'math_carry_confusion',
  'math_borrow_confusion',
  'jp_sound_confusion',
  'jp_dakuten_confusion',
  'jp_particle_confusion',
  'jp_vocab_meaning_confusion',
  'jp_antonym_confusion',
];

const MISCONCEPTION_TAG_SET = new Set(MISCONCEPTION_TAGS);

type SubjectCounts = Record<Subject, number>;
type SubjectRecentQuestions = Record<Subject, string[]>;

type AppState = {
  xp: number;
  level: number;
  stars: number;
  streakDays: number;
  lastPlayedDate: string | null;
  badges: string[];
  subjectClears: SubjectCounts;
  recentResults: MissionResult[];
  diagnosticLogs: AnswerTrace[];
  settings: Settings;
  adaptiveBySubject: SubjectAdaptiveMap;
  skillProgress: Record<string, SkillProgress>;
  recentQuestionIdsBySubject: SubjectRecentQuestions;
  mission: MissionSession | null;
  latestResult: MissionResult | null;
  startMission: (subject: Subject) => void;
  submitAnswer: (choiceIndex: number) => void;
  goNextQuestion: () => void;
  finishMission: () => MissionResult | null;
  updateSettings: (patch: Partial<Settings>) => void;
  clearProgress: () => void;
};

const defaultSettings: Settings = {
  soundEnabled: true,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
};

const defaultSubjectClears: SubjectCounts = {
  math: 0,
  japanese: 0,
};

const defaultRecentQuestionIdsBySubject: SubjectRecentQuestions = {
  math: [],
  japanese: [],
};

function normalizeDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSubject(value: unknown): value is Subject {
  return value === 'math' || value === 'japanese';
}

function isMisconceptionTag(value: unknown): value is MisconceptionTag {
  return typeof value === 'string' && MISCONCEPTION_TAG_SET.has(value as MisconceptionTag);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return value;
}

function normalizeMisconceptions(value: unknown, now: number): Partial<Record<MisconceptionTag, MisconceptionState>> {
  if (!isRecord(value)) return {};

  const normalized: Partial<Record<MisconceptionTag, MisconceptionState>> = {};
  for (const [tag, rawState] of Object.entries(value)) {
    if (!isMisconceptionTag(tag) || !isRecord(rawState)) continue;
    normalized[tag] = {
      errorCount: toNumber(rawState.errorCount, 0),
      recentErrorCount: toNumber(rawState.recentErrorCount, 0),
      resolvedStreak: toNumber(rawState.resolvedStreak, 0),
      priority: toNumber(rawState.priority, 0),
      dueAt: toNumber(rawState.dueAt, now),
      lastSeenAt: toNumber(rawState.lastSeenAt, now),
    };
  }
  return normalized;
}

function normalizeSkillProgressMap(value: unknown): Record<string, SkillProgress> {
  if (!isRecord(value)) return {};
  const now = Date.now();
  const normalized: Record<string, SkillProgress> = {};

  for (const [skillId, rawProgress] of Object.entries(value)) {
    if (!isRecord(rawProgress)) continue;
    const lastErrorTag = isMisconceptionTag(rawProgress.lastErrorTag) ? rawProgress.lastErrorTag : undefined;

    normalized[skillId] = {
      mastery: toNumber(rawProgress.mastery, DEFAULT_MASTERY),
      streak: toNumber(rawProgress.streak, 0),
      nextReviewAt: toNumber(rawProgress.nextReviewAt, now),
      seenCount: toNumber(rawProgress.seenCount, 0),
      misconceptions: normalizeMisconceptions(rawProgress.misconceptions, now),
      lastErrorTag,
    };
  }

  return normalized;
}

function normalizeRecentQuestionIdsBySubject(value: unknown): SubjectRecentQuestions {
  if (!isRecord(value)) return { math: [], japanese: [] };

  const math = Array.isArray(value.math) ? value.math.filter((id): id is string => typeof id === 'string') : [];
  const japanese = Array.isArray(value.japanese)
    ? value.japanese.filter((id): id is string => typeof id === 'string')
    : [];

  return { math, japanese };
}

function normalizeDiagnosticLogs(value: unknown): AnswerTrace[] {
  if (!Array.isArray(value)) return [];

  const normalized: AnswerTrace[] = [];
  const now = Date.now();

  for (const rawTrace of value) {
    if (!isRecord(rawTrace)) continue;
    if (!isSubject(rawTrace.subject)) continue;
    if (typeof rawTrace.questionId !== 'string' || typeof rawTrace.skillId !== 'string') continue;

    normalized.push({
      answeredAt: toNumber(rawTrace.answeredAt, now),
      subject: rawTrace.subject,
      questionId: rawTrace.questionId,
      skillId: rawTrace.skillId,
      difficulty: toNumber(rawTrace.difficulty, 1),
      selectedIndex: toNumber(rawTrace.selectedIndex, 0),
      correct: Boolean(rawTrace.correct),
      latencyMs: toNumber(rawTrace.latencyMs, 0),
      errorTag: isMisconceptionTag(rawTrace.errorTag) ? rawTrace.errorTag : undefined,
    });
  }

  return normalized.slice(-MAX_DIAGNOSTIC_LOGS);
}

function mergeRecentQuestionIds(current: string[], latest: string[], limit: number): string[] {
  const merged = [...latest, ...current];
  return Array.from(new Set(merged)).slice(0, limit);
}

function nextStreak(lastPlayedDate: string | null): number {
  if (!lastPlayedDate) return 1;
  const now = new Date();
  const last = new Date(`${lastPlayedDate}T00:00:00`);
  const today = new Date(`${normalizeDate(now)}T00:00:00`);
  const diffDays = Math.floor((today.getTime() - last.getTime()) / DAY_MS);

  if (diffDays <= 0) return 0;
  if (diffDays === 1) return 1;
  return -999;
}

function grantBadge(state: AppState, result: MissionResult): string[] {
  const unlocked = new Set(state.badges);

  if (!unlocked.has('first_clear')) unlocked.add('first_clear');
  if (result.correct === result.total) unlocked.add('perfect_mission');
  if (state.streakDays >= 3) unlocked.add('three_day_streak');
  if (state.subjectClears.math >= 3) unlocked.add('math_explorer');
  if (state.subjectClears.japanese >= 3) unlocked.add('word_adventurer');
  if (result.afterDifficulty > result.beforeDifficulty) unlocked.add('difficulty_climber');
  if (result.mode === 'challenge' && result.correct === result.total) unlocked.add('challenge_clear');

  return Array.from(unlocked);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      xp: 0,
      level: 1,
      stars: 0,
      streakDays: 0,
      lastPlayedDate: null,
      badges: [],
      subjectClears: defaultSubjectClears,
      recentResults: [],
      diagnosticLogs: [],
      settings: defaultSettings,
      adaptiveBySubject: createDefaultAdaptiveMap(),
      skillProgress: {},
      recentQuestionIdsBySubject: defaultRecentQuestionIdsBySubject,
      mission: null,
      latestResult: null,

      startMission: (subject) => {
        const state = get();
        const subjectState = state.adaptiveBySubject[subject];
        const startedAt = Date.now();
        const { questions, plan } = buildAdaptiveMission(
          subject,
          subjectState,
          state.skillProgress,
          state.recentQuestionIdsBySubject[subject],
        );

        set({
          mission: {
            subject,
            questions,
            plan,
            currentIndex: 0,
            answers: [],
            answerTraces: [],
            questionStartedAt: startedAt,
            startedAt,
          },
        });
      },

      submitAnswer: (choiceIndex) => {
        const state = get();
        const mission = state.mission;
        if (!mission) return;
        const question = mission.questions[mission.currentIndex];
        if (!question) return;
        const now = Date.now();
        const questionStartedAt = mission.questionStartedAt ?? now;
        const latencyMs = Math.max(0, now - questionStartedAt);
        const correct = choiceIndex === question.answerIndex;
        const observedLogs = [...state.diagnosticLogs, ...(mission.answerTraces ?? [])];
        const guessThresholdMs = getGuessThresholdMs({
          subject: mission.subject,
          difficulty: question.difficulty,
          diagnosticLogs: observedLogs,
        });
        const errorTag = inferErrorTag({
          question,
          selectedIndex: choiceIndex,
          correct,
          latencyMs,
          guessThresholdMs,
        });
        const trace: AnswerTrace = {
          answeredAt: now,
          subject: mission.subject,
          questionId: question.id,
          skillId: question.skillId,
          difficulty: question.difficulty,
          selectedIndex: choiceIndex,
          correct,
          latencyMs,
          errorTag,
        };

        const nextAnswers = [...mission.answers];
        nextAnswers[mission.currentIndex] = choiceIndex;
        const nextTraces = [...(mission.answerTraces ?? []), trace];
        set({ mission: { ...mission, answers: nextAnswers, answerTraces: nextTraces } });
      },

      goNextQuestion: () => {
        const mission = get().mission;
        if (!mission) return;
        const lastIndex = mission.questions.length - 1;
        if (mission.currentIndex >= lastIndex) return;
        set({
          mission: {
            ...mission,
            currentIndex: mission.currentIndex + 1,
            questionStartedAt: Date.now(),
          },
        });
      },

      finishMission: () => {
        const state = get();
        const mission = state.mission;
        if (!mission) return null;
        const missionTraces = mission.answerTraces ?? [];

        const evaluation = evaluateMission(mission, mission.answers);

        const adaptiveUpdate = updateAdaptiveProgress({
          subject: mission.subject,
          subjectState: state.adaptiveBySubject[mission.subject],
          skillProgress: state.skillProgress,
          outcomes: evaluation.outcomes,
          accuracy: evaluation.accuracy,
          avgDifficulty: evaluation.avgDifficulty,
          mode: mission.plan.mode,
        });

        const { earnedXp, earnedStars } = calcRewards({
          correct: evaluation.correct,
          total: evaluation.total,
          mode: mission.plan.mode,
          beforeDifficulty: adaptiveUpdate.beforeDifficulty,
          afterDifficulty: adaptiveUpdate.afterDifficulty,
          avgDifficulty: evaluation.avgDifficulty,
        });

        const misconceptionCountMap = missionTraces
          .filter((trace) => !trace.correct && trace.errorTag)
          .reduce<Record<MisconceptionTag, number>>((acc, trace) => {
            const tag = trace.errorTag as MisconceptionTag;
            acc[tag] = (acc[tag] ?? 0) + 1;
            return acc;
          }, {} as Record<MisconceptionTag, number>);

        const topMisconceptions = Object.entries(misconceptionCountMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([tag, count]) => ({ tag: tag as MisconceptionTag, count }));

        const result: MissionResult = {
          date: new Date().toISOString(),
          subject: mission.subject,
          mode: mission.plan.mode,
          total: evaluation.total,
          correct: evaluation.correct,
          accuracy: evaluation.accuracy,
          avgDifficulty: Number(evaluation.avgDifficulty.toFixed(2)),
          beforeDifficulty: adaptiveUpdate.beforeDifficulty,
          afterDifficulty: adaptiveUpdate.afterDifficulty,
          durationSec: Math.max(10, Math.round((Date.now() - mission.startedAt) / 1000)),
          earnedXp,
          earnedStars,
          topMisconceptions,
          recommendedFocusTag: topMisconceptions[0]?.tag,
        };

        const streakChange = nextStreak(state.lastPlayedDate);
        const today = normalizeDate(new Date());
        const newStreak =
          streakChange === 1 ? state.streakDays + 1 : streakChange === -999 ? 1 : state.streakDays;

        const nextXp = state.xp + earnedXp;
        const nextLevel = Math.floor(nextXp / 100) + 1;
        const subjectClears: SubjectCounts = {
          ...state.subjectClears,
          [mission.subject]: state.subjectClears[mission.subject] + 1,
        };

        const adaptiveBySubject: SubjectAdaptiveMap = {
          ...state.adaptiveBySubject,
          [mission.subject]: adaptiveUpdate.subjectState,
        };

        const recentQuestionIdsBySubject: SubjectRecentQuestions = {
          ...state.recentQuestionIdsBySubject,
          [mission.subject]: mergeRecentQuestionIds(
            state.recentQuestionIdsBySubject[mission.subject],
            mission.questions.map((question) => question.id),
            30,
          ),
        };

        const nextState: AppState = {
          ...state,
          xp: nextXp,
          level: nextLevel,
          stars: state.stars + earnedStars,
          streakDays: newStreak,
          lastPlayedDate: today,
          subjectClears,
          adaptiveBySubject,
          skillProgress: adaptiveUpdate.skillProgress,
          recentQuestionIdsBySubject,
          recentResults: [result, ...state.recentResults].slice(0, 30),
          diagnosticLogs: [...state.diagnosticLogs, ...missionTraces].slice(-MAX_DIAGNOSTIC_LOGS),
          latestResult: result,
          mission: null,
          badges: state.badges,
        };

        nextState.badges = grantBadge(nextState, result);
        set(nextState);
        return result;
      },

      updateSettings: (patch) => {
        set((state) => ({ settings: { ...state.settings, ...patch } }));
      },

      clearProgress: () => {
        set({
          xp: 0,
          level: 1,
          stars: 0,
          streakDays: 0,
          lastPlayedDate: null,
          badges: [],
          subjectClears: defaultSubjectClears,
          recentResults: [],
          diagnosticLogs: [],
          adaptiveBySubject: createDefaultAdaptiveMap(),
          skillProgress: {},
          recentQuestionIdsBySubject: defaultRecentQuestionIdsBySubject,
          mission: null,
          latestResult: null,
        });
      },
    }),
    {
      name: 'hoshi-takarajima-pwa',
      version: 2,
      migrate: (persistedState, version) => {
        void version;
        if (!isRecord(persistedState)) return persistedState;

        return {
          ...persistedState,
          skillProgress: normalizeSkillProgressMap(persistedState.skillProgress),
          recentQuestionIdsBySubject: normalizeRecentQuestionIdsBySubject(persistedState.recentQuestionIdsBySubject),
          diagnosticLogs: normalizeDiagnosticLogs(persistedState.diagnosticLogs),
        };
      },
    },
  ),
);
