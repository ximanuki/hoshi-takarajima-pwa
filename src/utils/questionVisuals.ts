import type { Question } from '../types';

export type ClockVisual = {
  kind: 'clock';
  hour: number;
  minute: 0 | 15 | 30 | 45;
  label: string;
};

export type QuestionVisual = ClockVisual;

function normalizeHour(hour: number): number {
  const normalized = hour % 12;
  return normalized === 0 ? 12 : normalized;
}

function parseClockAnswer(answer: string): { hour: number; minute: 0 | 15 | 30 | 45 } | null {
  const trimmed = answer.trim();

  const half = trimmed.match(/^(\d+)じはん$/);
  if (half) {
    const hour = Number(half[1]);
    if (Number.isInteger(hour) && hour >= 1 && hour <= 12) {
      return { hour: normalizeHour(hour), minute: 30 };
    }
  }

  const quarter = trimmed.match(/^(\d+)じ(15|45)ふん$/);
  if (quarter) {
    const hour = Number(quarter[1]);
    const minute = Number(quarter[2]) as 15 | 45;
    if (Number.isInteger(hour) && hour >= 1 && hour <= 12) {
      return { hour: normalizeHour(hour), minute };
    }
  }

  const hourOnly = trimmed.match(/^(\d+)じ$/);
  if (hourOnly) {
    const hour = Number(hourOnly[1]);
    if (Number.isInteger(hour) && hour >= 1 && hour <= 12) {
      return { hour: normalizeHour(hour), minute: 0 };
    }
  }

  return null;
}

function formatClockLabel(hour: number, minute: 0 | 15 | 30 | 45): string {
  if (minute === 0) return `${hour}じ`;
  if (minute === 30) return `${hour}じはん`;
  return `${hour}じ${minute}ふん`;
}

export function getQuestionVisual(question: Question): QuestionVisual | undefined {
  if (question.subject !== 'life') return undefined;
  if (!question.skillId.startsWith('clock_')) return undefined;

  const answer = question.choices[question.answerIndex];
  if (!answer) return undefined;

  const parsed = parseClockAnswer(answer);
  if (!parsed) return undefined;

  return {
    kind: 'clock',
    hour: parsed.hour,
    minute: parsed.minute,
    label: formatClockLabel(parsed.hour, parsed.minute),
  };
}
