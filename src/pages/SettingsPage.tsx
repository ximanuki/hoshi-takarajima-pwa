import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const clearProgress = useAppStore((state) => state.clearProgress);

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

      <div className="card inline-actions">
        <Link className="ghost-btn" to="/parent">
          保護者画面へ
        </Link>
        <button className="danger-btn" onClick={onReset}>
          データをリセット
        </button>
      </div>
    </section>
  );
}
