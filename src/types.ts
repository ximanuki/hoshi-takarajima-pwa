export type Subject = 'math' | 'japanese';

export interface Question {
  id: string;
  subject: Subject;
  prompt: string;
  choices: string[];
  answerIndex: number;
  hint: string;
}

export interface MissionSession {
  subject: Subject;
  questions: Question[];
  currentIndex: number;
  answers: number[];
  startedAt: number;
}

export interface MissionResult {
  date: string;
  subject: Subject;
  total: number;
  correct: number;
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
