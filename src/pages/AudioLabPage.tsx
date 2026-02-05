import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { audioManager } from '../utils/audioManager';
import { AudioLabPlayer, type AudioLabEngine } from '../utils/audioLabPlayer';

const engineLabel: Record<AudioLabEngine, string> = {
  none: '停止中',
  asset: '1) 音源ファイル ループ方式',
  tone: '2) Tone.js シーケンサー方式',
};

export function AudioLabPage() {
  const player = useMemo(() => new AudioLabPlayer(), []);
  const [engine, setEngine] = useState<AudioLabEngine>('none');
  const [volume, setVolume] = useState(0.65);
  const [toneLoading, setToneLoading] = useState(false);

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

  const onPlayTone = async () => {
    setToneLoading(true);
    await player.playTone();
    setEngine(player.getEngine());
    setToneLoading(player.isToneLoading());
  };

  const onStop = () => {
    player.stop();
    setEngine(player.getEngine());
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
        <p>Step 2: Tone.jsシーケンサー（動的生成）を再生</p>
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
          <button className="ghost-btn" disabled={toneLoading} onClick={() => void onPlayTone()}>
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
