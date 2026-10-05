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
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hud } from '../components/Hud';
import { ParentGate } from '../components/ParentGate';
import { VoiceCredit } from '../components/VoiceCredit';
import { questionBank } from '../data/questions';
import { createSubjectRecord } from '../data/subjects';
import { Line } from 'react-chartjs-2';
import { SUBJECTS, getSkillLabel, subjectInfo } from '../data/subjects';
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

function ParentDashboard() {
  const recentResults = useAppStore((state) => state.recentResults);
  const diagnosticLogs = useAppStore((state) => state.diagnosticLogs);
  const skillProgress = useAppStore((state) => state.skillProgress);
  const subjectAccuracy = useMemo(
    () =>
      SUBJECTS.map((subject) => {
        const logs = diagnosticLogs.filter((trace) => trace.subject === subject);
        const correct = logs.filter((trace) => trace.correct).length;
        return { subject, total: logs.length, rate: logs.length > 0 ? Math.round((correct / logs.length) * 100) : null };
      }),
    [diagnosticLogs],
  );
  const weakSkills = useMemo(
    () =>
      Object.entries(skillProgress)
        .filter(([, progress]) => progress.seenCount >= 3)
        .sort((a, b) => a[1].mastery - b[1].mastery)
        .slice(0, 3),
    [skillProgress],
  );
  const recent = useMemo(() => recentResults.slice(0, 7).reverse(), [recentResults]);
  const recurrenceRate = useMemo(() => calcRecurrenceRate(diagnosticLogs), [diagnosticLogs]);
  const retryFirstSuccessRate = useMemo(() => calcRetryFirstSuccessRate(diagnosticLogs), [diagnosticLogs]);
  const topErrorTag = useMemo(() => getTopErrorTag(diagnosticLogs), [diagnosticLogs]);

  const labels = recent.map((result) => result.date.slice(5, 10));
  const accuracy = recent.map((result) => Math.round((result.correct / result.total) * 100));
  const durationMin = recent.map((result) => Number((result.durationSec / 60).toFixed(1)));

  return (
    <>
      <h2 className="on-night">学習のようす</h2>
      <div className="panel">
        <p>直近7回の正答率（%）</p>
        {recent.length > 0 ? (
          <Line
            data={{
              labels,
              datasets: [
                {
                  label: '正答率',
                  data: accuracy,
                  borderColor: '#22c29e',
                  backgroundColor: 'rgba(34, 194, 158, 0.2)',
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

      <div className="panel">
        <p>学習時間（分）: {durationMin.join(' / ') || '-'}</p>
      </div>

      <div className="panel" style={{ display: 'grid', gap: 8 }}>
        <h2>教科別の正答率（直近{diagnosticLogs.length}問）</h2>
        {subjectAccuracy.map((item) => (
          <div key={item.subject} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                {subjectInfo[item.subject].emoji} {subjectInfo[item.subject].label}
              </span>
              <span className="muted">{item.rate === null ? '未学習' : `${item.rate}%（${item.total}問）`}</span>
            </div>
            <div className="meter thin" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${item.rate ?? 0}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ display: 'grid', gap: 6 }}>
        <h2>伸びしろのあるスキル</h2>
        {weakSkills.length > 0 ? (
          weakSkills.map(([skillId, progress]) => (
            <p key={skillId}>
              {getSkillLabel(skillId)}: 習熟度 {Math.round(progress.mastery)}%
            </p>
          ))
        ) : (
          <p className="muted">各スキルを3問以上解くと表示されます。</p>
        )}
      </div>

      <div className="panel">
        <p>つまずき再発率（直近ログ）: {Math.round(recurrenceRate * 100)}%</p>
        <p>再挑戦の初回成功率: {Math.round(retryFirstSuccessRate * 100)}%</p>
        <p>最多つまずき: {topErrorTag ? getMisconceptionLabel(topErrorTag) : '-'}</p>
      </div>
    </>
  );
}

// いちど ゲートを とおったら、この タブを とじるまで もう きかない
let gatePassed = false;

function ParentSettings() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearProgress = useAppStore((state) => state.clearProgress);
  const subjectCounts = questionBank.reduce(
    (counts, question) => {
      counts[question.subject] += 1;
      return counts;
    },
    createSubjectRecord(() => 0),
  );

  const onReset = () => {
    if (!window.confirm('学習記録をすべて消去します。よろしいですか？')) return;
    clearProgress();
  };

  return (
    <>
      <h2 className="on-night">設定</h2>
      <section className="panel settings-list">
        <label className="field-row">
          <span>効果音</span>
          <input
            className="switch"
            checked={settings.soundEnabled}
            onChange={(event) => updateSettings({ soundEnabled: event.target.checked })}
            type="checkbox"
          />
        </label>
        <label className="field-stack">
          <span>効果音の音量: {Math.round(settings.sfxVolume * 100)}%</span>
          <input
            max={1}
            min={0}
            onChange={(event) => updateSettings({ sfxVolume: Number(event.target.value) })}
            step={0.1}
            type="range"
            value={settings.sfxVolume}
          />
        </label>
        <label className="field-row">
          <span>
            問題の自動読み上げ
            <small>もち子さんの音声（未生成の文はブラウザの音声）で読み上げます</small>
          </span>
          <input
            className="switch"
            checked={settings.readAloud}
            onChange={(event) => updateSettings({ readAloud: event.target.checked })}
            type="checkbox"
          />
        </label>
        <label className="field-row">
          <span>文字を大きくする</span>
          <input
            className="switch"
            checked={settings.largeText}
            onChange={(event) => updateSettings({ largeText: event.target.checked })}
            type="checkbox"
          />
        </label>
      </section>

      <section className="panel" style={{ display: 'grid', gap: 10 }}>
        <Link className="link-row" to="/illustrations">
          問題イラストのプレビュー（開発用） <span aria-hidden="true">›</span>
        </Link>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          問題数: {SUBJECTS.map((subject) => `${subjectInfo[subject].label} ${subjectCounts[subject]}`).join(' / ')}{' '}
          / 合計 {questionBank.length}
        </p>
        <button className="btn btn-danger btn-sm" onClick={onReset}>
          学習データをリセット
        </button>
      </section>
      <VoiceCredit />
    </>
  );
}

export function ParentPage() {
  const [passed, setPassed] = useState(gatePassed);

  return (
    <div className="screen">
      <Hud backTo="/" title="おとなの へや" showStats={false} />
      {passed ? (
        <>
          <ParentDashboard />
          <ParentSettings />
        </>
      ) : (
        <ParentGate
          onPass={() => {
            gatePassed = true;
            setPassed(true);
          }}
        />
      )}
    </div>
  );
}
