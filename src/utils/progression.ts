import { SUBJECTS, subjectInfo } from '../data/subjects';
import type { DailyQuestCounters, DailyQuestState, PlayerStats, Subject } from '../types';

export const XP_PER_LEVEL = 100;
export const QUEST_REWARD_STARS = 3;
export const CHEST_REWARD_STARS = 5;
export const DAILY_QUEST_COUNT = 3;

/* ------------------------------------------------------------------ */
/* レベル                                                              */
/* ------------------------------------------------------------------ */

export function levelFromXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

export function levelProgress(xp: number): { level: number; current: number; needed: number; ratio: number } {
  const safeXp = Math.max(0, xp);
  const level = levelFromXp(safeXp);
  const current = safeXp % XP_PER_LEVEL;
  return { level, current, needed: XP_PER_LEVEL, ratio: current / XP_PER_LEVEL };
}

const LEVEL_TITLES: Array<[number, string]> = [
  [1, 'みならい たんけんか'],
  [3, 'わくわく たんけんか'],
  [5, 'ほしあつめ たんけんか'],
  [8, 'しまめぐり たんけんか'],
  [12, 'たからじま マイスター'],
  [16, 'ほしの ゆうしゃ'],
  [20, 'でんせつの たんけんか'],
];

export function getLevelTitle(level: number): string {
  let title = LEVEL_TITLES[0][1];
  for (const [minLevel, name] of LEVEL_TITLES) {
    if (level >= minLevel) title = name;
  }
  return title;
}

/* ------------------------------------------------------------------ */
/* しまの ランク                                                        */
/* ------------------------------------------------------------------ */

export type IslandRank = {
  rank: number;
  name: string;
  nextAt: number | null;
  progress: number;
};

const ISLAND_RANKS: Array<{ minClears: number; name: string }> = [
  { minClears: 0, name: 'みはっけん' },
  { minClears: 1, name: 'たんけんちゅう' },
  { minClears: 5, name: 'なかよし' },
  { minClears: 12, name: 'ベテラン' },
  { minClears: 25, name: 'マスター' },
  { minClears: 50, name: 'でんせつ' },
];

export const MAX_ISLAND_RANK = ISLAND_RANKS.length - 1;

export function getIslandRank(clears: number): IslandRank {
  let rank = 0;
  ISLAND_RANKS.forEach((entry, index) => {
    if (clears >= entry.minClears) rank = index;
  });
  const next = ISLAND_RANKS[rank + 1];
  const floor = ISLAND_RANKS[rank].minClears;
  return {
    rank,
    name: ISLAND_RANKS[rank].name,
    nextAt: next ? next.minClears : null,
    progress: next ? (clears - floor) / (next.minClears - floor) : 1,
  };
}

/* ------------------------------------------------------------------ */
/* バッジ                                                              */
/* ------------------------------------------------------------------ */

export type BadgeContext = {
  stats: PlayerStats;
  subjectClears: Record<Subject, number>;
  streakDays: number;
  level: number;
  lastResult?: {
    correct: number;
    total: number;
    mode: 'learn' | 'review' | 'challenge';
    beforeDifficulty: number;
    afterDifficulty: number;
  };
};

export type BadgeCategory = 'start' | 'island' | 'skill' | 'habit' | 'legend';

export type BadgeDef = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  /** しんちょく（ロックちゅうの バッジに バーを だす） */
  progress: (ctx: BadgeContext) => { value: number; target: number };
};

function totalClears(ctx: BadgeContext): number {
  return SUBJECTS.reduce((sum, subject) => sum + (ctx.subjectClears[subject] ?? 0), 0);
}

function count(value: number, target: number) {
  return { value: Math.min(value, target), target };
}

function islandBadge(subject: Subject, id: string, name: string, icon: string): BadgeDef {
  return {
    id,
    name,
    description: `${subjectInfo[subject].island}を 3かい クリア`,
    icon,
    category: 'island',
    progress: (ctx) => count(ctx.subjectClears[subject] ?? 0, 3),
  };
}

export const badgeCategoryLabels: Record<BadgeCategory, string> = {
  start: 'はじめの いっぽ',
  island: 'しまの たんけん',
  skill: 'わざ と ちから',
  habit: 'まいにちの しゅうかん',
  legend: 'でんせつ',
};

export const badgeMaster: BadgeDef[] = [
  {
    id: 'first_clear',
    name: 'はじめてクリア',
    description: 'ミッションを 1かい クリア',
    icon: '🚩',
    category: 'start',
    progress: (ctx) => count(totalClears(ctx), 1),
  },
  {
    id: 'perfect_mission',
    name: 'かんぺきスター',
    description: '1かいの ミッションで ぜんもん せいかい',
    icon: '🌟',
    category: 'start',
    progress: (ctx) => count(ctx.stats.perfectCount, 1),
  },
  {
    id: 'lesson_first',
    name: 'まなびの はじまり',
    description: 'レッスンを 1つ よんだ',
    icon: '📖',
    category: 'start',
    progress: (ctx) => count(ctx.stats.lessonsDone, 1),
  },
  {
    id: 'quest_first',
    name: 'クエストデビュー',
    description: 'きょうの クエストを 1つ たっせい',
    icon: '📜',
    category: 'start',
    progress: (ctx) => count(ctx.stats.questsCompleted, 1),
  },
  islandBadge('math', 'math_explorer', 'さんすうたんけんたい', '🧮'),
  islandBadge('japanese', 'word_adventurer', 'ことばぼうけんか', '📖'),
  islandBadge('life', 'life_helper', 'くらしの おてつだい', '🏠'),
  islandBadge('insight', 'insight_thinker', 'ひらめき はかせ', '💡'),
  islandBadge('nature', 'nature_ranger', 'しぜん レンジャー', '🌿'),
  {
    id: 'all_islands',
    name: 'しまめぐり',
    description: 'ぜんぶの しまを 1かいずつ クリア',
    icon: '🗺️',
    category: 'island',
    progress: (ctx) => count(SUBJECTS.filter((subject) => (ctx.subjectClears[subject] ?? 0) > 0).length, SUBJECTS.length),
  },
  {
    id: 'island_master',
    name: 'しまの マスター',
    description: 'どこかの しまで ランク「マスター」',
    icon: '👑',
    category: 'island',
    progress: (ctx) => count(Math.max(...SUBJECTS.map((subject) => ctx.subjectClears[subject] ?? 0)), 25),
  },
  {
    id: 'difficulty_climber',
    name: 'レベルアップたんけん',
    description: 'おすすめレベルを 1だん あげた',
    icon: '🧗',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.difficultyUps, 1),
  },
  {
    id: 'challenge_clear',
    name: 'チャレンジせいは',
    description: 'チャレンジミッションを ぜんもん せいかい',
    icon: '🏆',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.challengeClears, 1),
  },
  {
    id: 'boss_first',
    name: 'ボス たいじ',
    description: 'はじめて ボスを たおした',
    icon: '⚔️',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.bossWins, 1),
  },
  {
    id: 'boss_10',
    name: 'ボスハンター',
    description: 'ボスを 10たい たおした',
    icon: '🐉',
    category: 'legend',
    progress: (ctx) => count(ctx.stats.bossWins, 10),
  },
  {
    id: 'lesson_20',
    name: 'ものしり はかせ',
    description: 'レッスンを 20 よんだ',
    icon: '🎓',
    category: 'habit',
    progress: (ctx) => count(ctx.stats.lessonsDone, 20),
  },
  {
    id: 'combo_10',
    name: 'コンボ 10',
    description: '10もん れんぞく せいかい',
    icon: '⚡',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.bestCombo, 10),
  },
  {
    id: 'combo_25',
    name: 'コンボ 25',
    description: '25もん れんぞく せいかい',
    icon: '🔥',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.bestCombo, 25),
  },
  {
    id: 'perfect_10',
    name: 'かんぺき10かい',
    description: 'ぜんもん せいかいを 10かい',
    icon: '💎',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.perfectCount, 10),
  },
  {
    id: 'correct_100',
    name: 'せいかい 100',
    description: 'これまでに 100もん せいかい',
    icon: '🎯',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.totalCorrect, 100),
  },
  {
    id: 'correct_500',
    name: 'せいかい 500',
    description: 'これまでに 500もん せいかい',
    icon: '🏹',
    category: 'skill',
    progress: (ctx) => count(ctx.stats.totalCorrect, 500),
  },
  {
    id: 'three_day_streak',
    name: '3にちれんぞく',
    description: '3にち れんぞくで がくしゅう',
    icon: '📅',
    category: 'habit',
    progress: (ctx) => count(Math.max(ctx.streakDays, ctx.stats.bestStreakDays), 3),
  },
  {
    id: 'streak_7',
    name: '1しゅうかん れんぞく',
    description: '7にち れんぞくで がくしゅう',
    icon: '🌈',
    category: 'habit',
    progress: (ctx) => count(Math.max(ctx.streakDays, ctx.stats.bestStreakDays), 7),
  },
  {
    id: 'streak_30',
    name: '30にち れんぞく',
    description: '30にち れんぞくで がくしゅう',
    icon: '🌕',
    category: 'habit',
    progress: (ctx) => count(Math.max(ctx.streakDays, ctx.stats.bestStreakDays), 30),
  },
  {
    id: 'early_bird',
    name: 'あさの ひばり',
    description: 'あさ（5〜9じ）に ミッションを 3かい',
    icon: '🐤',
    category: 'habit',
    progress: (ctx) => count(ctx.stats.morningMissions, 3),
  },
  {
    id: 'quest_10',
    name: 'クエスト ハンター',
    description: 'きょうの クエストを あわせて 10こ たっせい',
    icon: '🗝️',
    category: 'habit',
    progress: (ctx) => count(ctx.stats.questsCompleted, 10),
  },
  {
    id: 'missions_30',
    name: 'ぼうけん 30かい',
    description: 'ミッションを あわせて 30かい クリア',
    icon: '🧭',
    category: 'legend',
    progress: (ctx) => count(totalClears(ctx), 30),
  },
  {
    id: 'missions_100',
    name: 'ぼうけん 100かい',
    description: 'ミッションを あわせて 100かい クリア',
    icon: '🚀',
    category: 'legend',
    progress: (ctx) => count(totalClears(ctx), 100),
  },
  {
    id: 'level_10',
    name: 'Lv.10 とうたつ',
    description: 'たんけんか レベル 10',
    icon: '🎖️',
    category: 'legend',
    progress: (ctx) => count(ctx.level, 10),
  },
  {
    id: 'correct_1000',
    name: 'せいかい 1000',
    description: 'これまでに 1000もん せいかい',
    icon: '🌠',
    category: 'legend',
    progress: (ctx) => count(ctx.stats.totalCorrect, 1000),
  },
];

export const badgeById: Record<string, BadgeDef> = Object.fromEntries(badgeMaster.map((badge) => [badge.id, badge]));

export function isBadgeUnlocked(badge: BadgeDef, ctx: BadgeContext): boolean {
  const { value, target } = badge.progress(ctx);
  return value >= target;
}

/** いま あたらしく かくとく できる バッジ id */
export function findNewBadges(current: string[], ctx: BadgeContext): string[] {
  const owned = new Set(current);
  return badgeMaster.filter((badge) => !owned.has(badge.id) && isBadgeUnlocked(badge, ctx)).map((badge) => badge.id);
}

/* ------------------------------------------------------------------ */
/* きょうの クエスト                                                    */
/* ------------------------------------------------------------------ */

export type QuestDef = {
  id: string;
  title: string;
  icon: string;
  target: number;
  progress: (counters: DailyQuestCounters) => number;
};

function islandQuest(subject: Subject): QuestDef {
  return {
    id: `island_${subject}`,
    title: `${subjectInfo[subject].island}を クリア`,
    icon: subjectInfo[subject].emoji,
    target: 1,
    progress: (counters) => (counters.subjects.includes(subject) ? 1 : 0),
  };
}

const questPool: QuestDef[] = [
  { id: 'missions_2', title: 'ミッションを 2かい クリア', icon: '🚩', target: 2, progress: (c) => c.missions },
  { id: 'missions_3', title: 'ミッションを 3かい クリア', icon: '🚩', target: 3, progress: (c) => c.missions },
  { id: 'correct_8', title: '8もん せいかい する', icon: '⭕', target: 8, progress: (c) => c.correct },
  { id: 'correct_12', title: '12もん せいかい する', icon: '⭕', target: 12, progress: (c) => c.correct },
  { id: 'perfect_1', title: 'ぜんもん せいかいを 1かい', icon: '🌟', target: 1, progress: (c) => c.perfect },
  { id: 'combo_4', title: '4もん れんぞく せいかい', icon: '⚡', target: 4, progress: (c) => c.maxCombo },
  { id: 'combo_6', title: '6もん れんぞく せいかい', icon: '⚡', target: 6, progress: (c) => c.maxCombo },
  { id: 'two_islands', title: '2つの しまを クリア', icon: '🗺️', target: 2, progress: (c) => c.subjects.length },
  { id: 'review_1', title: 'ふくしゅうミッションを 1かい', icon: '🔁', target: 1, progress: (c) => c.reviewMissions },
  { id: 'lesson_1', title: 'レッスンを 1つ よむ', icon: '📖', target: 1, progress: (c) => c.lessons },
  { id: 'lesson_2', title: 'レッスンを 2つ よむ', icon: '📖', target: 2, progress: (c) => c.lessons },
  { id: 'boss_1', title: 'ボスに 1かい いどむ', icon: '👑', target: 1, progress: (c) => c.bosses },
  ...SUBJECTS.map(islandQuest),
];

const questById: Record<string, QuestDef> = Object.fromEntries(questPool.map((quest) => [quest.id, quest]));

export function getQuestDef(id: string): QuestDef | undefined {
  return questById[id];
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** ひづけから きまる きょうの クエスト（おなじ ひは いつも おなじ） */
export function getDailyQuests(date: string): QuestDef[] {
  const picked: QuestDef[] = [];
  const usedFamilies = new Set<string>();
  let seed = hashString(`quest:${date}`);
  let guard = 0;

  while (picked.length < DAILY_QUEST_COUNT && guard < 100) {
    guard += 1;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const quest = questPool[seed % questPool.length];
    const family = quest.id.split('_')[0];
    if (usedFamilies.has(family)) continue;
    usedFamilies.add(family);
    picked.push(quest);
  }

  return picked;
}

export function createEmptyCounters(): DailyQuestCounters {
  return { missions: 0, correct: 0, perfect: 0, maxCombo: 0, subjects: [], reviewMissions: 0, lessons: 0, bosses: 0 };
}

export function createDailyQuestState(date: string): DailyQuestState {
  return { date, counters: createEmptyCounters(), claimed: [], chestClaimed: false };
}

export function ensureDailyQuestState(state: DailyQuestState | null | undefined, date: string): DailyQuestState {
  if (!state || state.date !== date) return createDailyQuestState(date);
  return state;
}

export function applyMissionToCounters(
  counters: DailyQuestCounters,
  mission: {
    subject: Subject;
    correct: number;
    total: number;
    maxCombo: number;
    mode: 'learn' | 'review' | 'challenge';
    kind?: 'adaptive' | 'practice' | 'boss';
  },
): DailyQuestCounters {
  return {
    ...counters,
    missions: counters.missions + 1,
    correct: counters.correct + mission.correct,
    perfect: counters.perfect + (mission.total > 0 && mission.correct === mission.total ? 1 : 0),
    maxCombo: Math.max(counters.maxCombo, mission.maxCombo),
    subjects: counters.subjects.includes(mission.subject) ? counters.subjects : [...counters.subjects, mission.subject],
    reviewMissions: counters.reviewMissions + (mission.mode === 'review' ? 1 : 0),
    bosses: counters.bosses + (mission.kind === 'boss' ? 1 : 0),
  };
}

export type QuestStatus = {
  quest: QuestDef;
  value: number;
  done: boolean;
  claimed: boolean;
};

export function getQuestStatuses(state: DailyQuestState): QuestStatus[] {
  return getDailyQuests(state.date).map((quest) => {
    const value = Math.min(quest.progress(state.counters), quest.target);
    return { quest, value, done: value >= quest.target, claimed: state.claimed.includes(quest.id) };
  });
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
