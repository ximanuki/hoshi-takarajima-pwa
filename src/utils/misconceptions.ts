import type { MisconceptionTag } from '../types';

const LABELS: Record<MisconceptionTag, string> = {
  unknown_guess: 'あわてて えらんだ',
  attention_slip: 'うっかり まちがい',
  math_counting_slip: 'かぞえまちがい',
  math_operation_confusion: '＋と−の こんらん',
  math_place_value_confusion: 'くらいの こんらん',
  math_carry_confusion: 'くりあがりの つまずき',
  math_borrow_confusion: 'くりさがりの つまずき',
  jp_sound_confusion: 'おとの こんらん',
  jp_dakuten_confusion: 'てんてん・まるの こんらん',
  jp_particle_confusion: 'じょしの つかいかた',
  jp_vocab_meaning_confusion: 'ことばの いみ',
  jp_antonym_confusion: 'はんたいことば',
};

const FEEDBACK: Record<MisconceptionTag, string> = {
  unknown_guess: 'あわてずに よんでみよう',
  attention_slip: 'もういちど ゆっくり みてみよう',
  math_counting_slip: 'かずを いちどずつ かぞえよう',
  math_operation_confusion: '＋と−を よくみよう',
  math_place_value_confusion: 'くらいを たしかめよう',
  math_carry_confusion: 'くりあがりを たしかめよう',
  math_borrow_confusion: 'くりさがりを たしかめよう',
  jp_sound_confusion: 'こえにだして よんでみよう',
  jp_dakuten_confusion: 'てんてん・まるを みよう',
  jp_particle_confusion: 'ぶんの つながりを みよう',
  jp_vocab_meaning_confusion: 'ことばの いみを たしかめよう',
  jp_antonym_confusion: 'はんたいことばを かんがえよう',
};

export function getMisconceptionLabel(tag: MisconceptionTag): string {
  return LABELS[tag];
}

export function getMisconceptionFeedback(tag: MisconceptionTag): string {
  return FEEDBACK[tag];
}

