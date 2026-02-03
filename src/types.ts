export type Subject = 'math' | 'japanese';
export type MissionMode = 'learn' | 'review' | 'challenge';

export interface Question {
  id: string;
  subject: Subject;
  skillId: string;
  difficulty: number;
  prompt: string;
  choices: string[];
  answerIndex: number;
  hint: string;
}

export interface MissionPlan {
  mode: MissionMode;
  targetDifficulty: number;
  reviewCount: number;
  coreCount: number;
  challengeCount: number;
}

export interface MissionSession {
  subject: Subject;
  questions: Question[];
  plan: MissionPlan;
  currentIndex: number;
  answers: number[];
  startedAt: number;
}

export interface MissionResult {
  date: string;
  subject: Subject;
  mode: MissionMode;
  total: number;
  correct: number;
  accuracy: number;
  avgDifficulty: number;
  beforeDifficulty: number;
  afterDifficulty: number;
  durationSec: number;
  earnedXp: number;
  earnedStars: number;
}

export interface Settings {
  soundEnabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
}

export interface ParentDailyStat {
  date: string;
  total: number;
  correct: number;
  durationSec: number;
}

export interface SkillProgress {
  mastery: number;
  streak: number;
  nextReviewAt: number;
  seenCount: number;
}

export interface SubjectAdaptiveState {
  targetDifficulty: number;
  missionCount: number;
}

export type SubjectAdaptiveMap = Record<Subject, SubjectAdaptiveState>;
