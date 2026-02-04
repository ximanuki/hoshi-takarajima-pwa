export type Subject = 'math' | 'japanese' | 'life' | 'insight';
export type MissionMode = 'learn' | 'review' | 'challenge';
export type MisconceptionTag =
  | 'unknown_guess'
  | 'attention_slip'
  | 'math_counting_slip'
  | 'math_operation_confusion'
  | 'math_place_value_confusion'
  | 'math_carry_confusion'
  | 'math_borrow_confusion'
  | 'jp_sound_confusion'
  | 'jp_dakuten_confusion'
  | 'jp_particle_confusion'
  | 'jp_vocab_meaning_confusion'
  | 'jp_antonym_confusion';

export interface MisconceptionState {
  errorCount: number;
  recentErrorCount: number;
  resolvedStreak: number;
  priority: number;
  dueAt: number;
  lastSeenAt: number;
}

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
  misconceptionCount: number;
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
  answerTraces: AnswerTrace[];
  questionStartedAt: number;
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
  topMisconceptions?: MisconceptionSummary[];
  recommendedFocusTag?: MisconceptionTag;
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

export interface AnswerTrace {
  answeredAt: number;
  subject: Subject;
  questionId: string;
  skillId: string;
  difficulty: number;
  selectedIndex: number;
  correct: boolean;
  latencyMs: number;
  errorTag?: MisconceptionTag;
}

export interface MisconceptionSummary {
  tag: MisconceptionTag;
  count: number;
}

export interface SkillProgress {
  mastery: number;
  streak: number;
  nextReviewAt: number;
  seenCount: number;
  misconceptions: Partial<Record<MisconceptionTag, MisconceptionState>>;
  lastErrorTag?: MisconceptionTag;
}

export interface SubjectAdaptiveState {
  targetDifficulty: number;
  missionCount: number;
}

export type SubjectAdaptiveMap = Record<Subject, SubjectAdaptiveState>;
