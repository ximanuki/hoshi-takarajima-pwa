import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { getDueReviewCount } from '../utils/mission';

export function HomePage() {
  const streakDays = useAppStore((state) => state.streakDays);
  const recentResults = useAppStore((state) => state.recentResults);
  const mathDifficulty = useAppStore((state) => state.adaptiveBySubject.math.targetDifficulty);
  const japaneseDifficulty = useAppStore((state) => state.adaptiveBySubject.japanese.targetDifficulty);
  const skillProgress = useAppStore((state) => state.skillProgress);

  const dueReviews = useMemo(
    () => ({
      math: getDueReviewCount('math', skillProgress),
      japanese: getDueReviewCount('japanese', skillProgress),
    }),
    [skillProgress],
  );

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
        <h2>おすすめレベル</h2>
        <p>さんすう Lv.{mathDifficulty}（ふくしゅう {dueReviews.math}）</p>
        <p>こくご Lv.{japaneseDifficulty}（ふくしゅう {dueReviews.japanese}）</p>
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
        <p>あいぼう「ポコ」: まちがいは たから！ つぎで もっと できるよ！</p>
      </div>
    </section>
  );
}
