import type { Subject } from '../types';

export type PathStage = {
  skillId: string;
  /** ボスを たおすと もらえる ステッカー */
  sticker: string;
};

// しまごとの みちの じゅんばん（やさしい → むずかしい）
export const islandPaths: Record<Subject, PathStage[]> = {
  math: [
    { skillId: 'add_within10', sticker: '🍎' },
    { skillId: 'sub_within10', sticker: '🍪' },
    { skillId: 'compare_numbers', sticker: '⚖️' },
    { skillId: 'shapes_basic', sticker: '🔷' },
    { skillId: 'add_within20', sticker: '🧮' },
    { skillId: 'sub_within20', sticker: '🎈' },
    { skillId: 'word_math', sticker: '📝' },
    { skillId: 'multiplication_intro', sticker: '🍡' },
    { skillId: 'division_intro', sticker: '🍬' },
    { skillId: 'fractions_basic', sticker: '🍰' },
    { skillId: 'measurement_time_money', sticker: '⏱️' },
  ],
  japanese: [
    { skillId: 'vocabulary_picture', sticker: '🖼️' },
    { skillId: 'hiragana_order', sticker: '🔤' },
    { skillId: 'character_recognition', sticker: '✏️' },
    { skillId: 'katakana_reading', sticker: '📺' },
    { skillId: 'onomatopoeia', sticker: '🔔' },
    { skillId: 'word_context', sticker: '💬' },
    { skillId: 'kanji_intro', sticker: '⛰️' },
    { skillId: 'reading_short', sticker: '📚' },
    { skillId: 'expression_choice', sticker: '💐' },
    { skillId: 'opposite_words', sticker: '🔁' },
    { skillId: 'sentence_context', sticker: '🧩' },
  ],
  life: [
    { skillId: 'clock_hour', sticker: '🕐' },
    { skillId: 'money_value', sticker: '🪙' },
    { skillId: 'safety_road', sticker: '🚦' },
    { skillId: 'life_routine', sticker: '🪥' },
    { skillId: 'manners', sticker: '🙋' },
    { skillId: 'clock_half', sticker: '🕧' },
    { skillId: 'money_sum', sticker: '👛' },
    { skillId: 'calendar_days', sticker: '📅' },
    { skillId: 'eco_habit', sticker: '♻️' },
    { skillId: 'cooking_step', sticker: '🍳' },
    { skillId: 'clock_quarter', sticker: '⏰' },
    { skillId: 'money_change', sticker: '🧾' },
    { skillId: 'safety_disaster', sticker: '⛑️' },
  ],
  insight: [
    { skillId: 'pattern_symbol', sticker: '🔺' },
    { skillId: 'pattern_number', sticker: '🔢' },
    { skillId: 'odd_one_out', sticker: '🧐' },
    { skillId: 'number_puzzle', sticker: '🎲' },
    { skillId: 'word_chain', sticker: '🔗' },
    { skillId: 'observation_compare', sticker: '🔍' },
    { skillId: 'logic_condition', sticker: '🗝️' },
    { skillId: 'rule_transform', sticker: '🪄' },
    { skillId: 'order_logic', sticker: '🪜' },
    { skillId: 'story_inference', sticker: '🕵️' },
    { skillId: 'route_optimization', sticker: '🗺️' },
    { skillId: 'strategy_choice', sticker: '♟️' },
    { skillId: 'riddle_wordplay', sticker: '❓' },
  ],
  nature: [
    { skillId: 'animals_life', sticker: '🐘' },
    { skillId: 'plants_growth', sticker: '🌻' },
    { skillId: 'seasons', sticker: '🍁' },
    { skillId: 'bugs_water', sticker: '🦋' },
    { skillId: 'weather_sky', sticker: '🌈' },
    { skillId: 'body_health', sticker: '🫀' },
  ],
};

export function findStage(skillId: string): { subject: Subject; index: number; stage: PathStage } | undefined {
  for (const [subject, stages] of Object.entries(islandPaths) as Array<[Subject, PathStage[]]>) {
    const index = stages.findIndex((stage) => stage.skillId === skillId);
    if (index >= 0) return { subject, index, stage: stages[index] };
  }
  return undefined;
}
