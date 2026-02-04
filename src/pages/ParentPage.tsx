import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useAppStore } from '../store/useAppStore';
import type { AnswerTrace, MisconceptionTag } from '../types';
import { getMisconceptionLabel } from '../utils/misconceptions';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

const LOOKAHEAD_ANSWERS_FOR_RECURRENCE = 15;

function calcRecurrenceRate(logs: AnswerTrace[]): number {
  const errors = logs
    .map((trace, index) => ({ trace, index }))
    .filter(({ trace }) => !trace.correct && trace.errorTag);

  if (errors.length === 0) return 0;

  let recurrent = 0;
  for (const current of errors) {
    const found = logs
      .slice(current.index + 1, current.index + 1 + LOOKAHEAD_ANSWERS_FOR_RECURRENCE)
      .some(
        (next) =>
          next.subject === current.trace.subject &&
          next.errorTag !== undefined &&
          next.errorTag === current.trace.errorTag,
      );
    if (found) recurrent += 1;
  }

  return recurrent / errors.length;
}

function calcRetryFirstSuccessRate(logs: AnswerTrace[]): number {
  const errors = logs
    .map((trace, index) => ({ trace, index }))
    .filter(({ trace }) => !trace.correct && trace.errorTag);

  if (errors.length === 0) return 0;

  let opportunities = 0;
  let successes = 0;

  for (const current of errors) {
    const retry = logs
      .slice(current.index + 1)
      .find((next) => next.subject === current.trace.subject && next.skillId === current.trace.skillId);

    if (!retry) continue;
    opportunities += 1;
    if (retry.correct) successes += 1;
  }

  return opportunities === 0 ? 0 : successes / opportunities;
}

function getTopErrorTag(logs: AnswerTrace[]): MisconceptionTag | null {
  const counts = logs.reduce<Partial<Record<MisconceptionTag, number>>>((acc, trace) => {
    if (!trace.errorTag || trace.correct) return acc;
    acc[trace.errorTag] = (acc[trace.errorTag] ?? 0) + 1;
    return acc;
  }, {});

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? (top[0] as MisconceptionTag) : null;
}

export function ParentPage() {
  const recentResults = useAppStore((state) => state.recentResults);
  const diagnosticLogs = useAppStore((state) => state.diagnosticLogs);
  const recent = useMemo(() => recentResults.slice(0, 7).reverse(), [recentResults]);
  const recurrenceRate = useMemo(() => calcRecurrenceRate(diagnosticLogs), [diagnosticLogs]);
  const retryFirstSuccessRate = useMemo(() => calcRetryFirstSuccessRate(diagnosticLogs), [diagnosticLogs]);
  const topErrorTag = useMemo(() => getTopErrorTag(diagnosticLogs), [diagnosticLogs]);

  const labels = recent.map((result) => result.date.slice(5, 10));
  const accuracy = recent.map((result) => Math.round((result.correct / result.total) * 100));
  const durationMin = recent.map((result) => Number((result.durationSec / 60).toFixed(1)));

  return (
    <section className="stack">
      <h1>保護者ダッシュボード</h1>
      <div className="card">
        <p>直近7回の正答率（%）</p>
        {recent.length > 0 ? (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: '正答率',
                  data: accuracy,
                  borderColor: '#0f6e6f',
                  backgroundColor: 'rgba(15, 110, 111, 0.2)',
                  tension: 0.35,
                  fill: true,
                },
              ],
            }}
            options={{ responsive: true, plugins: { legend: { display: false } } }}
          />
        ) : (
          <p>まだ学習記録がありません。</p>
        )}
      </div>

      <div className="card">
        <p>学習時間（分）: {durationMin.join(' / ') || '-'}</p>
      </div>

      <div className="card">
        <p>つまずき再発率（直近ログ）: {Math.round(recurrenceRate * 100)}%</p>
        <p>再挑戦の初回成功率: {Math.round(retryFirstSuccessRate * 100)}%</p>
        <p>最多つまずき: {topErrorTag ? getMisconceptionLabel(topErrorTag) : '-'}</p>
      </div>
    </section>
  );
}
