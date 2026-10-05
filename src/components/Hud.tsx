import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';

type Props = {
  title?: ReactNode;
  /** もどりさき。わたさないと もどるボタンを ださない */
  backTo?: string;
  showStats?: boolean;
};

export function Hud({ title, backTo, showStats = true }: Props) {
  const navigate = useNavigate();
  const level = useAppStore((state) => state.level);
  const stars = useAppStore((state) => state.stars);
  const streakDays = useAppStore((state) => state.streakDays);

  return (
    <header className="hud on-night">
      {backTo ? (
        <button
          className="round-btn ghost"
          onClick={() => {
            audioManager.playSfx('tap');
            navigate(backTo);
          }}
          aria-label="もどる"
        >
          ‹
        </button>
      ) : null}
      {title ? <h1 className="hud-title">{title}</h1> : null}
      {showStats ? (
        <div className="hud-pills">
          <span className="pill level" aria-label={`レベル ${level}`}>
            Lv.{level}
          </span>
          <span className="pill" aria-label={`ほし ${stars}こ`}>
            ⭐ {stars}
          </span>
          <span className="pill" aria-label={`れんぞく ${streakDays}にち`}>
            🔥 {streakDays}
          </span>
        </div>
      ) : null}
    </header>
  );
}
