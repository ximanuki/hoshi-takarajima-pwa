import type { Question } from '../types';

export type ClockVisual = {
  kind: 'clock';
  hour: number;
  minute: 0 | 15 | 30 | 45;
  label: string;
};

export type MoneyItem = {
  value: number;
  count: number;
  kind: 'coin' | 'bill';
};

export type MoneyVisual = {
  kind: 'money';
  mode: 'value' | 'sum' | 'change';
  items: MoneyItem[];
  total: number;
  price?: number;
  paid?: number;
};

export type FractionVisual = {
  kind: 'fraction';
  numerator: number;
  denominator: number;
  label: string;
};

export type RouteOption = {
  name: string;
  segments: number[];
  distance: number;
};

export type RouteVisual = {
  kind: 'route';
  options: RouteOption[];
  bestRoute: string;
};

export type QuestionVisual = ClockVisual | MoneyVisual | FractionVisual | RouteVisual;

function normalizeHour(hour: number): number {
  const normalized = hour % 12;
  return normalized === 0 ? 12 : normalized;
}

function parseYen(value: string): number | null {
  const match = value.trim().match(/^(\d+)えん$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
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

function parseMoneyItems(prompt: string): MoneyItem[] {
  const items: MoneyItem[] = [];
  const matches = prompt.matchAll(/(\d+)えん(だま|さつ)\s*(\d+)まい/g);
  for (const match of matches) {
    const value = Number(match[1]);
    const count = Number(match[3]);
    if (!Number.isFinite(value) || !Number.isFinite(count)) continue;
    if (count <= 0) continue;
    items.push({
      value,
      count,
      kind: match[2] === 'さつ' ? 'bill' : 'coin',
    });
  }
  return items;
}

function parseMoneyChange(prompt: string): { price: number; paid: number } | null {
  const match = prompt.match(/(\d+)えん(?:の\s*[^。]+?)?\s*を\s*(\d+)えんで\s*(?:かいました|しはらいました)/);
  if (!match) return null;

  const price = Number(match[1]);
  const paid = Number(match[2]);
  if (!Number.isFinite(price) || !Number.isFinite(paid)) return null;
  return { price, paid };
}

function parseMoneyVisual(question: Question): MoneyVisual | undefined {
  const answer = question.choices[question.answerIndex];
  if (!answer) return undefined;

  const answerYen = parseYen(answer);
  const items = parseMoneyItems(question.prompt);

  if (question.skillId === 'money_change') {
    const parsed = parseMoneyChange(question.prompt);
    if (!parsed) return undefined;
    const total = answerYen ?? Math.max(0, parsed.paid - parsed.price);
    return {
      kind: 'money',
      mode: 'change',
      items: [],
      total,
      price: parsed.price,
      paid: parsed.paid,
    };
  }

  if (items.length === 0) return undefined;
  const computed = items.reduce((sum, item) => sum + item.value * item.count, 0);
  const total = answerYen ?? computed;

  return {
    kind: 'money',
    mode: question.skillId === 'money_value' ? 'value' : 'sum',
    items,
    total,
  };
}

function parseFractionVisual(question: Question): FractionVisual | undefined {
  const answer = question.choices[question.answerIndex];
  if (!answer) return undefined;

  const promptSplit = question.prompt.match(/(\d+)とうぶん/);
  const answerSplit = answer.match(/(\d+)\s*\/\s*(\d+)/);

  const denominatorFromPrompt = promptSplit ? Number(promptSplit[1]) : null;
  const numeratorFromAnswer = answerSplit ? Number(answerSplit[1]) : null;
  const denominatorFromAnswer = answerSplit ? Number(answerSplit[2]) : null;

  const denominator = denominatorFromPrompt ?? denominatorFromAnswer ?? null;
  const numerator = numeratorFromAnswer ?? 1;

  if (!denominator || !Number.isFinite(denominator) || denominator < 2) return undefined;
  if (!Number.isFinite(numerator) || numerator < 1 || numerator > denominator) return undefined;

  return {
    kind: 'fraction',
    numerator,
    denominator,
    label: `${numerator}/${denominator}`,
  };
}

function parseRouteOptions(prompt: string): RouteOption[] {
  const routePart = prompt.split('。')[0]?.trim();
  if (!routePart) return [];

  const options: RouteOption[] = [];
  const chunks = routePart
    .split('、')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  for (const chunk of chunks) {
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace <= 0) continue;

    const name = chunk.slice(0, lastSpace).trim();
    const expression = chunk.slice(lastSpace + 1).trim().replace(/ほ/g, '');
    if (!/^\d+(?:\+\d+)*$/.test(expression)) continue;

    const segments = expression.split('+').map((value) => Number(value));
    if (segments.some((value) => !Number.isFinite(value) || value <= 0)) continue;

    options.push({
      name,
      segments,
      distance: segments.reduce((sum, value) => sum + value, 0),
    });
  }

  return options;
}

function canonicalRouteName(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/^みち/, '')
    .replace(/^ルート/, '')
    .replace(/^コース/, '')
    .replace(/みち$/, '');
}

function parseRouteVisual(question: Question): RouteVisual | undefined {
  const options = parseRouteOptions(question.prompt);
  if (options.length < 2) return undefined;

  const answer = question.choices[question.answerIndex];
  if (!answer) return undefined;

  const answerKey = canonicalRouteName(answer);
  const answerMatch = options.find((option) => canonicalRouteName(option.name) === answerKey);
  const shortest = [...options].sort((a, b) => a.distance - b.distance)[0];

  return {
    kind: 'route',
    options,
    bestRoute: answerMatch?.name ?? shortest.name,
  };
}

export function getQuestionVisual(question: Question): QuestionVisual | undefined {
  if (question.subject === 'life' && question.skillId.startsWith('clock_')) {
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

  if (question.subject === 'life' && question.skillId.startsWith('money_')) {
    return parseMoneyVisual(question);
  }

  if (question.skillId === 'fractions_basic') {
    return parseFractionVisual(question);
  }

  if (question.skillId === 'route_optimization') {
    return parseRouteVisual(question);
  }

  return undefined;
}
