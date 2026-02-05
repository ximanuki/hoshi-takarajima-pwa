import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { getMisconceptionFeedback, getMisconceptionLabel } from '../utils/misconceptions';
import { audioManager } from '../utils/audioManager';

const modeLabel = {
  learn: 'まなびミッション',
  review: 'ふくしゅうミッション',
  challenge: 'チャレンジミッション',
} as const;

export function ResultPage() {
  const result = useAppStore((state) => state.latestResult);
  const lastPlayedResultDate = useRef<string | null>(null);
  const celebrationTier = useMemo(() => {
    if (!result) return null;
    if (result.accuracy >= 0.95) return 'high' as const;
    if (result.accuracy >= 0.8) return 'mid' as const;
    return null;
  }, [result]);

  const celebrationStars = useMemo(() => {
    if (!celebrationTier) return [];
    const count = celebrationTier === 'high' ? 16 : 10;
    return Array.from({ length: count }, (_, index) => {
      const left = ((index * 41 + 11) % 88) + 6;
      const delay = ((index * 17) % 12) * 0.09;
      const duration = 1.95 + (index % 5) * 0.18;
      return { id: index, left, delay, duration };
    });
  }, [celebrationTier]);

  useEffect(() => {
    if (!result) return;
    if (lastPlayedResultDate.current === result.date) return;
    lastPlayedResultDate.current = result.date;
    audioManager.playSfx('clear');
  }, [result]);

  if (!result) {
    return (
      <section className="card">
        <h1>けっかが ありません</h1>
        <Link className="primary-btn" to="/mission" onClick={() => audioManager.playSfx('tap')}>
          ミッションへ
        </Link>
      </section>
    );
  }

  return (
    <section className="stack">
      <article className={`hero-card result-hero ${celebrationTier ? 'celebrating' : ''}`}>
        {celebrationTier ? (
          <div className={`celebration-layer ${celebrationTier === 'high' ? 'high' : ''}`} aria-hidden="true">
            {celebrationStars.map((star) => (
              <span
                className="celebration-star"
                key={star.id}
                style={
                  {
                    left: `${star.left}%`,
                    animationDelay: `${star.delay}s`,
                    animationDuration: `${star.duration}s`,
                  } as CSSProperties
                }
              >
                ⭐
              </span>
            ))}
          </div>
        ) : null}
        <p className="eyebrow">ミッションクリア！</p>
        <h1>
          {result.correct}/{result.total} せいかい
        </h1>
        <p>{modeLabel[result.mode]}</p>
        <p>せいとうりつ: {Math.round(result.accuracy * 100)}% / たいかんむずかしさ: {result.avgDifficulty}</p>
        <p>
          おすすめレベル: {result.beforeDifficulty} → {result.afterDifficulty}
        </p>
        <p>⭐ +{result.earnedStars} / XP +{result.earnedXp}</p>
        {result.topMisconceptions && result.topMisconceptions.length > 0 ? (
          <div>
            <p>こんかいの つまずき:</p>
            <p>{result.topMisconceptions.map((item) => `${getMisconceptionLabel(item.tag)}(${item.count})`).join(' / ')}</p>
            {result.recommendedFocusTag ? <p>つぎは: {getMisconceptionFeedback(result.recommendedFocusTag)}</p> : null}
          </div>
        ) : null}
      </article>

      <div className="card inline-actions">
        <Link className="primary-btn" to="/mission" onClick={() => audioManager.playSfx('tap')}>
          つぎのミッション
        </Link>
        <Link className="ghost-btn" to="/collection" onClick={() => audioManager.playSfx('tap')}>
          バッジをみる
        </Link>
      </div>
    </section>
  );
}
