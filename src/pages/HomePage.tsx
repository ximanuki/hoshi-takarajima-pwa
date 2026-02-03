import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function HomePage() {
  const { streakDays, recentResults } = useAppStore((state) => ({
    streakDays: state.streakDays,
    recentResults: state.recentResults,
  }));

  const last = recentResults[0];

  return (
    <section className="stack">
      <div className="hero-card">
        <p className="eyebrow">きょうのぼうけん</p>
        <h1>ミッションを えらんで ほしを あつめよう！</h1>
        <p>れんぞく {streakDays} にち たっせいちゅう ✨</p>
        <Link className="primary-btn" to="/mission">
          はじめる
        </Link>
      </div>

      <div className="card">
        <h2>さいきんの きろく</h2>
        {last ? (
          <p>
            {last.subject === 'math' ? 'さんすう' : 'こくご'}: {last.correct}/{last.total} せいかい
          </p>
        ) : (
          <p>まだ きろくが ありません。さいしょの ぼうけんへ！</p>
        )}
      </div>

      <div className="card mascot">
        <p>あいぼう「ポコ」: まいにち 5ぷんで つよくなれるよ！</p>
      </div>
    </section>
  );
}
