import { Link } from 'react-router-dom';
import { questionBank } from '../data/questions';
import { SUBJECTS, createSubjectRecord, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import type { ThemePreference } from '../types';
import { isSpeechSupported, speak } from '../utils/speech';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'じどう' },
  { value: 'light', label: '☀️ ひる' },
  { value: 'dark', label: '🌙 よる' },
];

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearProgress = useAppStore((state) => state.clearProgress);
  const speechSupported = isSpeechSupported();
  const subjectCounts = questionBank.reduce(
    (counts, question) => {
      counts[question.subject] += 1;
      return counts;
    },
    createSubjectRecord(() => 0),
  );

  const onReset = () => {
    if (!window.confirm('ほんとうに がくしゅうきろくを けしますか？')) return;
    clearProgress();
  };

  return (
    <section className="stack">
      <div>
        <p className="eyebrow">じぶんに あわせよう</p>
        <h1>せってい</h1>
      </div>

      <article className="card settings-group">
        <h2>🔈 おと</h2>
        <label className="field-row">
          <span>サウンド</span>
          <input
            className="switch"
            checked={settings.soundEnabled}
            type="checkbox"
            onChange={(event) => updateSettings({ soundEnabled: event.target.checked })}
          />
        </label>

        <label className="field-stack">
          <span>BGM おんりょう: {Math.round(settings.bgmVolume * 100)}%</span>
          <input
            max={1}
            min={0}
            step={0.1}
            type="range"
            value={settings.bgmVolume}
            onChange={(event) => updateSettings({ bgmVolume: Number(event.target.value) })}
          />
        </label>

        <label className="field-stack">
          <span>こうかおん: {Math.round(settings.sfxVolume * 100)}%</span>
          <input
            max={1}
            min={0}
            step={0.1}
            type="range"
            value={settings.sfxVolume}
            onChange={(event) => updateSettings({ sfxVolume: Number(event.target.value) })}
          />
        </label>
      </article>

      <article className="card settings-group">
        <h2>👀 みやすさ・よみあげ</h2>
        <label className="field-row">
          <span>
            もんだいを よみあげる
            <small>{speechSupported ? 'もんだいが でたら じどうで よむよ' : 'この きかいでは つかえません'}</small>
          </span>
          <input
            className="switch"
            checked={settings.readAloud}
            disabled={!speechSupported}
            type="checkbox"
            onChange={(event) => {
              updateSettings({ readAloud: event.target.checked });
              if (event.target.checked) speak('もんだいを よみあげるよ');
            }}
          />
        </label>

        <label className="field-row">
          <span>
            もじを おおきく
            <small>ちいさい がめんでも よみやすく</small>
          </span>
          <input
            className="switch"
            checked={settings.largeText}
            type="checkbox"
            onChange={(event) => updateSettings({ largeText: event.target.checked })}
          />
        </label>

        <div className="field-row">
          <span>
            がめんの いろ
            <small>よるは めに やさしい いろに</small>
          </span>
          <div className="segmented" role="group" aria-label="がめんの いろ">
            {THEME_OPTIONS.map((option) => (
              <button
                aria-pressed={settings.theme === option.value}
                key={option.value}
                onClick={() => updateSettings({ theme: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </article>

      <article className="card stack">
        <h2>👪 おうちの かた・かいはつ</h2>
        <div className="link-list">
          <Link className="link-row" to="/parent">
            保護者ダッシュボード <span aria-hidden="true">›</span>
          </Link>
          <Link className="link-row" to="/settings/audio-lab">
            BGM比較ラボ <span aria-hidden="true">›</span>
          </Link>
          <Link className="link-row" to="/illustrations">
            SVGプレビュー <span aria-hidden="true">›</span>
          </Link>
        </div>
        <button className="danger-btn" onClick={onReset}>
          データをリセット
        </button>
      </article>

      <article className="card stack" style={{ gap: 6 }}>
        <h2>📚 もんだいデータ</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {SUBJECTS.map((subject) => `${subjectInfo[subject].emoji}${subjectInfo[subject].label} ${subjectCounts[subject]}`).join(' / ')}
          {' '}/ ごうけい {questionBank.length}もん
        </p>
        <p className="muted" style={{ fontSize: '0.75rem' }}>
          編集元: docs/question_bank_master.md → src/data/questions.generated.ts
        </p>
      </article>
    </section>
  );
}
