import { questionBank } from './questions';
import type { MisconceptionTag, Question } from '../types';

export interface QuestionMeta {
  wrongChoiceTags?: [MisconceptionTag?, MisconceptionTag?, MisconceptionTag?];
  remediationHintByTag?: Partial<Record<MisconceptionTag, string>>;
}

const defaultHintByTag: Record<MisconceptionTag, string> = {
  unknown_guess: 'あわてずに よんでみよう',
  attention_slip: 'もういちど ていねいに',
  math_counting_slip: 'かずを いちどずつ かぞえよう',
  math_operation_confusion: '＋と−を よくみよう',
  math_place_value_confusion: 'くらいに きをつけよう',
  math_carry_confusion: 'くりあがりを かくにん',
  math_borrow_confusion: 'くりさがりを かくにん',
  jp_sound_confusion: 'おとを こえにだしてみよう',
  jp_dakuten_confusion: 'てんてん・まるを みなおそう',
  jp_particle_confusion: 'ぶんの つながりを みよう',
  jp_vocab_meaning_confusion: 'ことばの いみを たしかめよう',
  jp_antonym_confusion: 'はんたいことばを かんがえよう',
};

function tagBySkill(question: Question): MisconceptionTag {
  if (question.subject === 'math') {
    if (question.skillId === 'compare_numbers') return 'math_place_value_confusion';
    if (question.skillId === 'word_math') return 'math_operation_confusion';
    if (question.skillId.startsWith('sub_')) return 'math_operation_confusion';
    if (question.skillId.startsWith('add_')) return 'math_counting_slip';
    return 'attention_slip';
  }

  if (question.skillId === 'opposite_words') return 'jp_antonym_confusion';
  if (question.skillId === 'character_recognition' || question.skillId === 'hiragana_order') return 'jp_sound_confusion';
  if (question.skillId === 'sentence_context') return 'jp_particle_confusion';
  return 'jp_vocab_meaning_confusion';
}

function buildDefaultMeta(question: Question): QuestionMeta {
  const tag = tagBySkill(question);
  return {
    wrongChoiceTags: [tag, tag, tag],
    remediationHintByTag: {
      [tag]: defaultHintByTag[tag],
    },
  };
}

const curatedOverrides: Record<string, QuestionMeta> = {
  m88: {
    wrongChoiceTags: ['math_counting_slip', 'math_operation_confusion', 'math_place_value_confusion'],
  },
  m89: {
    wrongChoiceTags: ['math_place_value_confusion', 'math_operation_confusion', 'math_counting_slip'],
  },
  j145: {
    wrongChoiceTags: ['jp_antonym_confusion', 'jp_vocab_meaning_confusion', 'jp_antonym_confusion'],
  },
  j146: {
    wrongChoiceTags: ['jp_vocab_meaning_confusion', 'jp_antonym_confusion', 'jp_antonym_confusion'],
  },
};

export const questionMetaById: Record<string, QuestionMeta> = Object.fromEntries(
  questionBank.map((question) => {
    const override = curatedOverrides[question.id];
    return [question.id, override ?? buildDefaultMeta(question)];
  }),
) as Record<string, QuestionMeta>;

