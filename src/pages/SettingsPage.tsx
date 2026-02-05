import { Link } from 'react-router-dom';
import { questionBank } from '../data/questions';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';

const subjectLabels: Record<Subject, string> = {
  math: 'さんすう',
  japanese: 'こくご',
  life: 'くらし',
  insight: 'ひらめき',
};

export function SettingsPage() {
  const soundEnabled = useAppStore((state) => state.settings.soundEnabled);
  const bgmVolume = useAppStore((state) => state.settings.bgmVolume);
  const sfxVolume = useAppStore((state) => state.settings.sfxVolume);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearProgress = useAppStore((state) => state.clearProgress);
  const subjectCounts = questionBank.reduce<Record<Subject, number>>(
    (counts, question) => ({
      ...counts,
      [question.subject]: counts[question.subject] + 1,
    }),
    { math: 0, japanese: 0, life: 0, insight: 0 },
  );

  const onReset = () => {
    if (!window.confirm('ほんとうに がくしゅうきろくを けしますか？')) return;
    clearProgress();
  };

  return (
    <section className="stack">
      <h1>せってい</h1>

      <article className="card">
        <label className="field-row">
          <span>サウンド</span>
          <input
            checked={soundEnabled}
            type="checkbox"
            onChange={(event) => updateSettings({ soundEnabled: event.target.checked })}
          />
        </label>

        <label className="field-stack">
          <span>BGM おんりょう: {Math.round(bgmVolume * 100)}%</span>
          <input
            max={1}
            min={0}
            step={0.1}
            type="range"
            value={bgmVolume}
            onChange={(event) => updateSettings({ bgmVolume: Number(event.target.value) })}
          />
        </label>

        <label className="field-stack">
          <span>こうかおん: {Math.round(sfxVolume * 100)}%</span>
          <input
            max={1}
            min={0}
            step={0.1}
            type="range"
            value={sfxVolume}
            onChange={(event) => updateSettings({ sfxVolume: Number(event.target.value) })}
          />
        </label>
      </article>

      <div className="card inline-actions">
        <Link className="ghost-btn" to="/parent">
          保護者画面へ
        </Link>
        <Link className="ghost-btn" to="/illustrations">
          SVGプレビューへ
        </Link>
        <button className="danger-btn" onClick={onReset}>
          データをリセット
        </button>
      </div>

      <article className="card">
        <h2>もんだいデータの 参照元</h2>
        <p>編集元: docs/question_bank_master.md</p>
        <p>アプリ参照: src/data/questions.generated.ts （src/data/questions.ts けいゆ）</p>
        <p>SVG描画: src/components/QuestionIllustration.tsx / src/utils/questionVisuals.ts</p>
        <p>辞書データ: src/data/illustrationDictionary.ts</p>
        <p>
          もんだい数:
          {' '}
          {(Object.keys(subjectLabels) as Subject[])
            .map((subject) => `${subjectLabels[subject]} ${subjectCounts[subject]}`)
            .join(' / ')}
          {' '}
          / ごうけい {questionBank.length}
        </p>
      </article>
    </section>
  );
}
