import { useEffect, useRef } from 'react';
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
        <Link className="primary-btn" to="/mission">
          ミッションへ
        </Link>
      </section>
    );
  }

  return (
    <section className="stack">
      <article className="hero-card">
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
        <Link className="primary-btn" to="/mission">
          つぎのミッション
        </Link>
        <Link className="ghost-btn" to="/collection">
          バッジをみる
        </Link>
      </div>
    </section>
  );
}
