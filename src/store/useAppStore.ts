import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  buildAdaptiveMission,
  calcRewards,
  createDefaultAdaptiveMap,
  evaluateMission,
  updateAdaptiveProgress,
} from '../utils/mission';
import type {
  MissionResult,
  MissionSession,
  Settings,
  SkillProgress,
  Subject,
  SubjectAdaptiveMap,
} from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

type SubjectCounts = Record<Subject, number>;

type AppState = {
  xp: number;
  level: number;
  stars: number;
  streakDays: number;
  lastPlayedDate: string | null;
  badges: string[];
  subjectClears: SubjectCounts;
  recentResults: MissionResult[];
  settings: Settings;
  adaptiveBySubject: SubjectAdaptiveMap;
  skillProgress: Record<string, SkillProgress>;
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

function normalizeDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
      settings: defaultSettings,
      adaptiveBySubject: createDefaultAdaptiveMap(),
      skillProgress: {},
      mission: null,
      latestResult: null,

      startMission: (subject) => {
        const state = get();
        const subjectState = state.adaptiveBySubject[subject];
        const { questions, plan } = buildAdaptiveMission(subject, subjectState, state.skillProgress);

        set({
          mission: {
            subject,
            questions,
            plan,
            currentIndex: 0,
            answers: [],
            startedAt: Date.now(),
          },
        });
      },

      submitAnswer: (choiceIndex) => {
        const mission = get().mission;
        if (!mission) return;
        const nextAnswers = [...mission.answers];
        nextAnswers[mission.currentIndex] = choiceIndex;
        set({ mission: { ...mission, answers: nextAnswers } });
      },

      goNextQuestion: () => {
        const mission = get().mission;
        if (!mission) return;
        const lastIndex = mission.questions.length - 1;
        if (mission.currentIndex >= lastIndex) return;
        set({ mission: { ...mission, currentIndex: mission.currentIndex + 1 } });
      },

      finishMission: () => {
        const state = get();
        const mission = state.mission;
        if (!mission) return null;

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
          recentResults: [result, ...state.recentResults].slice(0, 30),
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
          adaptiveBySubject: createDefaultAdaptiveMap(),
          skillProgress: {},
          mission: null,
          latestResult: null,
        });
      },
    }),
    {
      name: 'hoshi-takarajima-pwa',
    },
  ),
);
