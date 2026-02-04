import { questionMetaById } from '../data/question_meta';
import type { AnswerTrace, MisconceptionTag, Question, Subject } from '../types';

const DEFAULT_GUESS_THRESHOLD_MS = 900;
const MIN_GUESS_THRESHOLD_MS = 700;
const MAX_GUESS_THRESHOLD_MS = 1400;
const MIN_SAMPLES_FOR_DYNAMIC_THRESHOLD = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function parseChoiceAsNumber(choice: string | undefined): number | null {
  if (!choice) return null;
  const stripped = choice.replace(/[^\d.-]/g, '');
  if (stripped.length === 0) return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getGuessThresholdMs(params: {
  subject: Subject;
  difficulty: number;
  diagnosticLogs: AnswerTrace[];
}): number {
  const { subject, difficulty, diagnosticLogs } = params;
  const samples = diagnosticLogs
    .filter((trace) => trace.correct && trace.subject === subject && trace.difficulty === difficulty)
    .map((trace) => trace.latencyMs)
    .filter((latencyMs) => latencyMs > 0);

  if (samples.length < MIN_SAMPLES_FOR_DYNAMIC_THRESHOLD) {
    return DEFAULT_GUESS_THRESHOLD_MS;
  }

  const baseline = median(samples);
  return Math.round(clamp(baseline * 0.35, MIN_GUESS_THRESHOLD_MS, MAX_GUESS_THRESHOLD_MS));
}

export function inferErrorTag(params: {
  question: Question;
  selectedIndex: number;
  correct: boolean;
  latencyMs: number;
  guessThresholdMs: number;
}): MisconceptionTag | undefined {
  const { question, selectedIndex, correct, latencyMs, guessThresholdMs } = params;
  if (correct) return undefined;

  const metaTag = questionMetaById[question.id]?.wrongChoiceTags?.[selectedIndex];
  if (metaTag) return metaTag;

  if (latencyMs < guessThresholdMs) return 'unknown_guess';

  if (question.subject === 'math') {
    const selectedValue = parseChoiceAsNumber(question.choices[selectedIndex]);
    const correctValue = parseChoiceAsNumber(question.choices[question.answerIndex]);

    if (selectedValue !== null && correctValue !== null && Math.abs(selectedValue - correctValue) === 1) {
      return 'math_counting_slip';
    }

    if (question.skillId === 'compare_numbers') return 'math_place_value_confusion';
    if (question.skillId === 'word_math') return 'math_operation_confusion';
    if (question.skillId.startsWith('sub_')) return 'math_operation_confusion';
    if (question.skillId.startsWith('add_')) return 'math_counting_slip';
    return 'attention_slip';
  }

  if (question.skillId === 'opposite_words') return 'jp_antonym_confusion';
  if (question.skillId === 'character_recognition' || question.skillId === 'hiragana_order') return 'jp_sound_confusion';
  if (question.skillId === 'sentence_context') return 'jp_particle_confusion';
  if (question.skillId === 'vocabulary_picture' || question.skillId === 'word_context') {
    return 'jp_vocab_meaning_confusion';
  }

  return 'attention_slip';
}

