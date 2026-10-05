export type Subject = 'math' | 'japanese' | 'life' | 'insight' | 'nature';
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
  bestComboInMission?: number;
  levelBefore?: number;
  levelAfter?: number;
  newBadges?: string[];
  completedQuests?: string[];
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  soundEnabled: boolean;
  sfxVolume: number;
  /** もんだいを じどうで よみあげる */
  readAloud: boolean;
  /** もじを おおきく する */
  largeText: boolean;
  theme: ThemePreference;
}

export interface PlayerStats {
  totalAnswered: number;
  totalCorrect: number;
  perfectCount: number;
  bestCombo: number;
  bestStreakDays: number;
  challengeClears: number;
  difficultyUps: number;
  questsCompleted: number;
  morningMissions: number;
}

export interface DailyQuestCounters {
  missions: number;
  correct: number;
  perfect: number;
  maxCombo: number;
  subjects: Subject[];
  reviewMissions: number;
}

export interface DailyQuestState {
  date: string;
  counters: DailyQuestCounters;
  claimed: string[];
  chestClaimed: boolean;
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
