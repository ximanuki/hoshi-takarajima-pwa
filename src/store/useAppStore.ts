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
import { createSubjectRecord, isSubject } from '../data/subjects';
import {
  CHEST_REWARD_STARS,
  QUEST_REWARD_STARS,
  applyMissionToCounters,
  createDailyQuestState,
  ensureDailyQuestState,
  findNewBadges,
  getQuestStatuses,
  levelFromXp,
  todayKey,
} from '../utils/progression';
import type {
  AnswerTrace,
  DailyQuestState,
  PlayerStats,
  ThemePreference,
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
  stats: PlayerStats;
  /** ミッションを またいで つづく れんぞく せいかい */
  comboStreak: number;
  dailyQuest: DailyQuestState;
  mission: MissionSession | null;
  /** いまの ミッションの なかで いちばん ながい コンボ */
  missionBestCombo: number;
  latestResult: MissionResult | null;
  startMission: (subject: Subject) => void;
  submitAnswer: (choiceIndex: number) => void;
  goNextQuestion: () => void;
  finishMission: () => MissionResult | null;
  abandonMission: () => void;
  claimQuest: (questId: string) => boolean;
  claimQuestChest: () => boolean;
  updateSettings: (patch: Partial<Settings>) => void;
  clearProgress: () => void;
};

const defaultSettings: Settings = {
  soundEnabled: true,
  sfxVolume: 0.8,
  readAloud: false,
  largeText: false,
  theme: 'system',
};

const defaultStats: PlayerStats = {
  totalAnswered: 0,
  totalCorrect: 0,
  perfectCount: 0,
  bestCombo: 0,
  bestStreakDays: 0,
  challengeClears: 0,
  difficultyUps: 0,
  questsCompleted: 0,
  morningMissions: 0,
};

const createDefaultSubjectClears = (): SubjectCounts => createSubjectRecord(() => 0);
const createDefaultRecentQuestionIds = (): SubjectRecentQuestions => createSubjectRecord(() => []);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMisconceptionTag(value: unknown): value is MisconceptionTag {
  return typeof value === 'string' && MISCONCEPTION_TAG_SET.has(value as MisconceptionTag);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return value;
}

function normalizeSubjectClears(value: unknown): SubjectCounts {
  const source = isRecord(value) ? value : {};
  return createSubjectRecord((subject) => toNumber(source[subject], 0));
}

function normalizeSettings(value: unknown): Settings {
  if (!isRecord(value)) return defaultSettings;
  const theme: ThemePreference = value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system';
  return {
    soundEnabled: typeof value.soundEnabled === 'boolean' ? value.soundEnabled : defaultSettings.soundEnabled,
    sfxVolume: Math.max(0, Math.min(1, toNumber(value.sfxVolume, defaultSettings.sfxVolume))),
    readAloud: typeof value.readAloud === 'boolean' ? value.readAloud : defaultSettings.readAloud,
    largeText: typeof value.largeText === 'boolean' ? value.largeText : defaultSettings.largeText,
    theme,
  };
}

function normalizeStats(value: unknown, legacy: { badges: unknown; streakDays: unknown }): PlayerStats {
  const source = isRecord(value) ? value : {};
  const stats = Object.fromEntries(
    (Object.keys(defaultStats) as Array<keyof PlayerStats>).map((key) => [key, Math.max(0, toNumber(source[key], 0))]),
  ) as unknown as PlayerStats;

  // v3 いぜんの データ: もっている バッジから さいていげんの きろくを ふくげんする
  const badges = Array.isArray(legacy.badges) ? legacy.badges : [];
  if (badges.includes('perfect_mission')) stats.perfectCount = Math.max(stats.perfectCount, 1);
  if (badges.includes('challenge_clear')) stats.challengeClears = Math.max(stats.challengeClears, 1);
  if (badges.includes('difficulty_climber')) stats.difficultyUps = Math.max(stats.difficultyUps, 1);
  if (badges.includes('three_day_streak')) stats.bestStreakDays = Math.max(stats.bestStreakDays, 3);
  stats.bestStreakDays = Math.max(stats.bestStreakDays, toNumber(legacy.streakDays, 0));
  return stats;
}

function normalizeDailyQuest(value: unknown): DailyQuestState {
  const today = todayKey();
  if (!isRecord(value) || value.date !== today || !isRecord(value.counters)) return createDailyQuestState(today);
  const counters = value.counters;
  return {
    date: today,
    counters: {
      missions: toNumber(counters.missions, 0),
      correct: toNumber(counters.correct, 0),
      perfect: toNumber(counters.perfect, 0),
      maxCombo: toNumber(counters.maxCombo, 0),
      reviewMissions: toNumber(counters.reviewMissions, 0),
      subjects: Array.isArray(counters.subjects) ? counters.subjects.filter(isSubject) : [],
    },
    claimed: Array.isArray(value.claimed) ? value.claimed.filter((id): id is string => typeof id === 'string') : [],
    chestClaimed: Boolean(value.chestClaimed),
  };
}

function normalizeAdaptiveBySubject(value: unknown): SubjectAdaptiveMap {
  if (!isRecord(value)) return createDefaultAdaptiveMap();

  const defaults = createDefaultAdaptiveMap();
  const normalizeOne = (raw: unknown, fallback: { targetDifficulty: number; missionCount: number }) => {
    if (!isRecord(raw)) return fallback;
    return {
      targetDifficulty: Math.max(1, Math.min(5, Math.round(toNumber(raw.targetDifficulty, fallback.targetDifficulty)))),
      missionCount: Math.max(0, Math.round(toNumber(raw.missionCount, fallback.missionCount))),
    };
  };

  return createSubjectRecord((subject) => normalizeOne(value[subject], defaults[subject]));
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
  const source = isRecord(value) ? value : {};
  return createSubjectRecord((subject) => {
    const ids = source[subject];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  });
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

function nextStreak(lastPlayedDate: string | null, today: string): number {
  if (!lastPlayedDate) return 1;
  const last = new Date(`${lastPlayedDate}T00:00:00`);
  const current = new Date(`${today}T00:00:00`);
  const diffDays = Math.round((current.getTime() - last.getTime()) / DAY_MS);

  if (diffDays <= 0) return 0;
  if (diffDays === 1) return 1;
  return -999;
}

function badgeContext(state: Pick<AppState, 'stats' | 'subjectClears' | 'streakDays' | 'level'>) {
  return { stats: state.stats, subjectClears: state.subjectClears, streakDays: state.streakDays, level: state.level };
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
      subjectClears: createDefaultSubjectClears(),
      recentResults: [],
      diagnosticLogs: [],
      settings: defaultSettings,
      adaptiveBySubject: createDefaultAdaptiveMap(),
      skillProgress: {},
      recentQuestionIdsBySubject: createDefaultRecentQuestionIds(),
      stats: defaultStats,
      comboStreak: 0,
      dailyQuest: createDailyQuestState(todayKey()),
      mission: null,
      missionBestCombo: 0,
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
          missionBestCombo: 0,
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
        const comboStreak = correct ? state.comboStreak + 1 : 0;
        set({
          mission: { ...mission, answers: nextAnswers, answerTraces: nextTraces },
          comboStreak,
          missionBestCombo: Math.max(state.missionBestCombo, comboStreak),
          stats: { ...state.stats, bestCombo: Math.max(state.stats.bestCombo, comboStreak) },
        });
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

        const today = todayKey();
        const streakChange = nextStreak(state.lastPlayedDate, today);
        const newStreak =
          streakChange === 1 ? state.streakDays + 1 : streakChange === -999 ? 1 : Math.max(1, state.streakDays);

        const nextXp = state.xp + earnedXp;
        const nextLevel = levelFromXp(nextXp);
        const perfect = evaluation.total > 0 && evaluation.correct === evaluation.total;
        const hour = new Date().getHours();
        const stats: PlayerStats = {
          ...state.stats,
          totalAnswered: state.stats.totalAnswered + evaluation.total,
          totalCorrect: state.stats.totalCorrect + evaluation.correct,
          perfectCount: state.stats.perfectCount + (perfect ? 1 : 0),
          bestStreakDays: Math.max(state.stats.bestStreakDays, newStreak),
          challengeClears: state.stats.challengeClears + (perfect && mission.plan.mode === 'challenge' ? 1 : 0),
          difficultyUps:
            state.stats.difficultyUps + (adaptiveUpdate.afterDifficulty > adaptiveUpdate.beforeDifficulty ? 1 : 0),
          morningMissions: state.stats.morningMissions + (hour >= 5 && hour < 10 ? 1 : 0),
        };

        const questBefore = ensureDailyQuestState(state.dailyQuest, today);
        const dailyQuest: DailyQuestState = {
          ...questBefore,
          counters: applyMissionToCounters(questBefore.counters, {
            subject: mission.subject,
            correct: evaluation.correct,
            total: evaluation.total,
            maxCombo: state.missionBestCombo,
            mode: mission.plan.mode,
          }),
        };
        const doneBefore = new Set(getQuestStatuses(questBefore).filter((quest) => quest.done).map((quest) => quest.quest.id));
        const completedQuests = getQuestStatuses(dailyQuest)
          .filter((quest) => quest.done && !doneBefore.has(quest.quest.id))
          .map((quest) => quest.quest.id);

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

        const newBadges = findNewBadges(
          state.badges,
          badgeContext({ stats, subjectClears, streakDays: newStreak, level: nextLevel }),
        );
        const finalResult: MissionResult = {
          ...result,
          bestComboInMission: state.missionBestCombo,
          levelBefore: state.level,
          levelAfter: nextLevel,
          newBadges,
          completedQuests,
        };

        set({
          xp: nextXp,
          level: nextLevel,
          stars: state.stars + earnedStars,
          streakDays: newStreak,
          lastPlayedDate: today,
          subjectClears,
          adaptiveBySubject,
          skillProgress: adaptiveUpdate.skillProgress,
          recentQuestionIdsBySubject,
          recentResults: [finalResult, ...state.recentResults].slice(0, 30),
          diagnosticLogs: [...state.diagnosticLogs, ...missionTraces].slice(-MAX_DIAGNOSTIC_LOGS),
          latestResult: finalResult,
          mission: null,
          missionBestCombo: 0,
          stats,
          dailyQuest,
          badges: [...state.badges, ...newBadges],
        });
        return finalResult;
      },

      abandonMission: () => {
        set({ mission: null, missionBestCombo: 0 });
      },

      claimQuest: (questId) => {
        const state = get();
        const dailyQuest = ensureDailyQuestState(state.dailyQuest, todayKey());
        const status = getQuestStatuses(dailyQuest).find((quest) => quest.quest.id === questId);
        if (!status || !status.done || status.claimed) return false;

        const stats = { ...state.stats, questsCompleted: state.stats.questsCompleted + 1 };
        const newBadges = findNewBadges(state.badges, badgeContext({ ...state, stats }));
        set({
          stars: state.stars + QUEST_REWARD_STARS,
          stats,
          dailyQuest: { ...dailyQuest, claimed: [...dailyQuest.claimed, questId] },
          badges: [...state.badges, ...newBadges],
        });
        return true;
      },

      claimQuestChest: () => {
        const state = get();
        const dailyQuest = ensureDailyQuestState(state.dailyQuest, todayKey());
        const statuses = getQuestStatuses(dailyQuest);
        if (dailyQuest.chestClaimed || !statuses.every((quest) => quest.claimed)) return false;
        set({
          stars: state.stars + CHEST_REWARD_STARS,
          dailyQuest: { ...dailyQuest, chestClaimed: true },
        });
        return true;
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
          subjectClears: createDefaultSubjectClears(),
          recentResults: [],
          diagnosticLogs: [],
          adaptiveBySubject: createDefaultAdaptiveMap(),
          skillProgress: {},
          recentQuestionIdsBySubject: createDefaultRecentQuestionIds(),
          stats: defaultStats,
          comboStreak: 0,
          dailyQuest: createDailyQuestState(todayKey()),
          mission: null,
          missionBestCombo: 0,
          latestResult: null,
        });
      },
    }),
    {
      name: 'hoshi-takarajima-pwa',
      version: 4,
      migrate: (persistedState, version) => {
        void version;
        if (!isRecord(persistedState)) return persistedState;

        return {
          ...persistedState,
          settings: normalizeSettings(persistedState.settings),
          stats: normalizeStats(persistedState.stats, {
            badges: persistedState.badges,
            streakDays: persistedState.streakDays,
          }),
          comboStreak: Math.max(0, toNumber(persistedState.comboStreak, 0)),
          dailyQuest: normalizeDailyQuest(persistedState.dailyQuest),
          subjectClears: normalizeSubjectClears(persistedState.subjectClears),
          adaptiveBySubject: normalizeAdaptiveBySubject(persistedState.adaptiveBySubject),
          skillProgress: normalizeSkillProgressMap(persistedState.skillProgress),
          recentQuestionIdsBySubject: normalizeRecentQuestionIdsBySubject(persistedState.recentQuestionIdsBySubject),
          diagnosticLogs: normalizeDiagnosticLogs(persistedState.diagnosticLogs),
        };
      },
    },
  ),
);
