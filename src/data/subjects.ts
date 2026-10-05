import type { Subject } from '../types';

export const SUBJECTS: Subject[] = ['math', 'japanese', 'life', 'insight', 'nature'];

export type SubjectInfo = {
  label: string;
  island: string;
  desc: string;
  emoji: string;
  /** CSS 色相（0-360）。しまの カードや バーの いろに つかう */
  hue: number;
};

export const subjectInfo: Record<Subject, SubjectInfo> = {
  math: {
    label: 'さんすう',
    island: 'ドーナツじま',
    desc: 'たしざん・ひきざん・かたち',
    emoji: '🍩',
    hue: 330,
  },
  japanese: {
    label: 'こくご',
    island: 'キャンディじま',
    desc: 'もじ・ことば・よみとり',
    emoji: '🍭',
    hue: 280,
  },
  life: {
    label: 'くらし',
    island: 'クッキーじま',
    desc: 'とけい・おかね・マナー',
    emoji: '🍪',
    hue: 28,
  },
  insight: {
    label: 'ひらめき',
    island: 'カップケーキじま',
    desc: 'なぞとき・すいり・しりとり',
    emoji: '🧁',
    hue: 200,
  },
  nature: {
    label: 'しぜん',
    island: 'いちごじま',
    desc: 'いきもの・きせつ・そら・からだ',
    emoji: '🍓',
    hue: 152,
  },
};

export function isSubject(value: unknown): value is Subject {
  return typeof value === 'string' && (SUBJECTS as string[]).includes(value);
}

export function createSubjectRecord<T>(make: (subject: Subject) => T): Record<Subject, T> {
  return Object.fromEntries(SUBJECTS.map((subject) => [subject, make(subject)])) as Record<Subject, T>;
}

export const skillLabels: Record<string, string> = {
  add_within10: 'たしざん（10まで）',
  add_within20: 'たしざん（20まで）',
  sub_within10: 'ひきざん（10まで）',
  sub_within20: 'ひきざん（20まで）',
  compare_numbers: 'かずの おおきさ',
  word_math: 'ぶんしょうだい',
  expression_choice: 'しきを えらぶ',
  multiplication_intro: 'かけざんの はじめ',
  division_intro: 'わけっこ',
  fractions_basic: 'ぶんすう',
  measurement_time_money: 'じかんと おかね',
  shapes_basic: 'かたち',
  character_recognition: 'もじ',
  hiragana_order: 'ひらがなの じゅんばん',
  katakana_reading: 'カタカナ',
  kanji_intro: 'かんじ',
  vocabulary_picture: 'ことばと え',
  opposite_words: 'はんたいことば',
  word_context: 'ことばの いみ',
  sentence_context: 'ぶんの つながり',
  reading_short: 'よみとり',
  onomatopoeia: 'ようすを あらわす ことば',
  clock_hour: 'とけい（ちょうど）',
  clock_half: 'とけい（はん）',
  clock_quarter: 'とけい（15ふん）',
  money_value: 'おかねの かち',
  money_sum: 'おかねの けいさん',
  money_change: 'おつり',
  safety_road: 'みちの あんぜん',
  safety_disaster: 'ぼうさい',
  life_routine: 'せいかつ しゅうかん',
  cooking_step: 'おりょうり',
  calendar_days: 'カレンダー',
  manners: 'マナー',
  eco_habit: 'エコ',
  pattern_number: 'かずの きまり',
  pattern_symbol: 'かたちの きまり',
  odd_one_out: 'なかまはずれ',
  rule_transform: 'へんしん ルール',
  logic_condition: 'もしも すいり',
  route_optimization: 'ちかみち',
  observation_compare: 'くらべて はっけん',
  riddle_wordplay: 'なぞなぞ',
  strategy_choice: 'さくせん',
  story_inference: 'おはなし すいり',
  number_puzzle: 'かずの パズル',
  order_logic: 'じゅんばん すいり',
  word_chain: 'しりとり・ことばあそび',
  animals_life: 'どうぶつ',
  plants_growth: 'しょくぶつ',
  seasons: 'きせつ',
  weather_sky: 'てんき・そら',
  body_health: 'からだ',
  bugs_water: 'むし・みずべ',
};

export function getSkillLabel(skillId: string): string {
  return skillLabels[skillId] ?? skillId;
}
