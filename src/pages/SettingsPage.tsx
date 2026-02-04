import { Link } from 'react-router-dom';
import { questionBank } from '../data/questions';
import { useAppStore } from '../store/useAppStore';

export function SettingsPage() {
  const soundEnabled = useAppStore((state) => state.settings.soundEnabled);
  const bgmVolume = useAppStore((state) => state.settings.bgmVolume);
  const sfxVolume = useAppStore((state) => state.settings.sfxVolume);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearProgress = useAppStore((state) => state.clearProgress);
  const mathCount = questionBank.filter((question) => question.subject === 'math').length;
  const japaneseCount = questionBank.filter((question) => question.subject === 'japanese').length;

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
        <button className="danger-btn" onClick={onReset}>
          データをリセット
        </button>
      </div>

      <article className="card">
        <h2>もんだいデータの 参照元</h2>
        <p>ファイル: src/data/questions.ts</p>
        <p>
          もんだい数: さんすう {mathCount} / こくご {japaneseCount} / ごうけい {questionBank.length}
        </p>
      </article>
    </section>
  );
}
