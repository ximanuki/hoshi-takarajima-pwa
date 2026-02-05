import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { audioManager } from '../utils/audioManager';
import { AudioLabPlayer, type AudioLabEngine, type TonePresetId, type ToneSfxId } from '../utils/audioLabPlayer';

const engineLabel: Record<AudioLabEngine, string> = {
  none: '停止中',
  asset: '1) 音源ファイル ループ方式',
  tone: '2) Tone.js シーケンサー方式',
};

const sfxLabel: Record<ToneSfxId, string> = {
  tap: 'タップ',
  correct: 'せいかい',
  miss: 'ざんねん',
  clear: 'クリア',
};

export function AudioLabPage() {
  const player = useMemo(() => new AudioLabPlayer(), []);
  const tonePresets = player.getTonePresets();
  const [engine, setEngine] = useState<AudioLabEngine>('none');
  const [volume, setVolume] = useState(0.65);
  const [toneLoading, setToneLoading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<TonePresetId>(player.getCurrentTonePreset());
  const selectedPresetMeta = tonePresets.find((preset) => preset.id === selectedPreset) ?? tonePresets[0];

  useEffect(() => {
    audioManager.setBgmSuppressed(true);
    return () => {
      void player.destroy();
      audioManager.setBgmSuppressed(false);
    };
  }, [player]);

  const onPlayAsset = async () => {
    await player.playAsset();
    setEngine(player.getEngine());
  };

  const onPlayTone = async (presetId: TonePresetId) => {
    setToneLoading(true);
    setSelectedPreset(presetId);
    await player.playTone(presetId);
    setEngine(player.getEngine());
    setToneLoading(player.isToneLoading());
  };

  const onStop = () => {
    player.stop();
    setEngine(player.getEngine());
  };

  const onPlaySfx = async (sfxId: ToneSfxId) => {
    await player.playToneSfx(sfxId, selectedPreset);
  };

  const onVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    player.setVolume(nextVolume);
  };

  return (
    <section className="stack">
      <h1>BGM ひかくラボ</h1>

      <article className="card stack">
        <h2>ステップで ひかく</h2>
        <p>Step 1: 音源ファイル（固定ループ）を再生</p>
        <p>Step 2: Tone.jsシーケンサー（Lo-fi / Jersey / UK Garage / Future Garage / UK Dubstep / Ambient）を再生</p>
        <p>どちらも同じ音量で聞き比べできます。現在: {engineLabel[engine]}</p>
      </article>

      <article className="card stack">
        <label className="field-stack">
          <span>ラボ音量: {Math.round(volume * 100)}%</span>
          <input
            max={1}
            min={0}
            step={0.05}
            type="range"
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
          />
        </label>

        <div className="inline-actions">
          <button className="primary-btn" onClick={() => void onPlayAsset()}>
            1) 音源ループを再生
          </button>
          <button className="ghost-btn" disabled={toneLoading} onClick={() => void onPlayTone(selectedPreset)}>
            {toneLoading ? 'Tone.js を準備中…' : '2) Tone.jsシーケンサーを再生'}
          </button>
          <button className="danger-btn" onClick={onStop}>
            停止
          </button>
        </div>

        <p className="audio-lab-note">
          メモ: ここではホームBGMを自動停止して、比較音だけを鳴らします。Tone.js初回は少し読み込みます。
        </p>
      </article>

      <article className="card stack">
        <h2>Tone.js {tonePresets.length}パターン（全曲32小節ループ）</h2>
        <div className="audio-lab-preset-grid">
          {tonePresets.map((preset) => (
            <button
              key={preset.id}
              className={`audio-lab-preset-btn ${selectedPreset === preset.id ? 'active' : ''}`}
              disabled={toneLoading}
              onClick={() => void onPlayTone(preset.id)}
            >
              <span>{preset.name}</span>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
      </article>

      <article className="card stack">
        <h2>プリセット専用効果音: {selectedPresetMeta.name}</h2>
        <div className="audio-lab-sfx-grid">
          {(Object.keys(sfxLabel) as ToneSfxId[]).map((sfxId) => (
            <button key={sfxId} className="ghost-btn" disabled={toneLoading} onClick={() => void onPlaySfx(sfxId)}>
              {sfxLabel[sfxId]}
            </button>
          ))}
        </div>
        <p className="audio-lab-note">各BGMごとに音色を作り分けた効果音です。曲を切り替えると効果音の質感も変わります。</p>
      </article>

      <article className="card audio-lab-grid">
        <div>
          <h2>1) 音源ファイル方式</h2>
          <p>長所: 音のクオリティを作り込みやすい / 本番に近い確認がしやすい</p>
          <p>短所: 音源制作が必要 / 曲差分を増やすとアセット管理が増える</p>
        </div>
        <div>
          <h2>2) Tone.jsシーケンサー方式</h2>
          <p>長所: コードで分岐・動的変化を作りやすい / エフェクト構成を段階的に強化できる</p>
          <p>短所: チューニング工数が必要 / 実楽器っぽさは音源方式より作り込みが必要</p>
        </div>
      </article>

      <div className="card inline-actions">
        <Link className="ghost-btn" to="/settings">
          せっていにもどる
        </Link>
      </div>
    </section>
  );
}
