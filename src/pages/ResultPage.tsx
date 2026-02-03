import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

const modeLabel = {
  learn: 'まなびミッション',
  review: 'ふくしゅうミッション',
  challenge: 'チャレンジミッション',
} as const;

export function ResultPage() {
  const result = useAppStore((state) => state.latestResult);

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
