import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PokoIllustration } from '../components/PokoIllustration';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { getDueReviewCount } from '../utils/mission';

const subjectLabels: Record<Subject, string> = {
  math: 'さんすう',
  japanese: 'こくご',
  life: 'くらし',
  insight: 'ひらめき',
};

const homeSubjects: Subject[] = ['math', 'japanese', 'life', 'insight'];

export function HomePage() {
  const streakDays = useAppStore((state) => state.streakDays);
  const recentResults = useAppStore((state) => state.recentResults);
  const adaptiveBySubject = useAppStore((state) => state.adaptiveBySubject);
  const skillProgress = useAppStore((state) => state.skillProgress);

  const dueReviews = useMemo(
    () =>
      Object.fromEntries(homeSubjects.map((subject) => [subject, getDueReviewCount(subject, skillProgress)])) as Record<Subject, number>,
    [skillProgress],
  );

  const last = recentResults[0];
  const mascotMood = last ? (last.accuracy >= 0.9 ? 'cheer' : last.accuracy >= 0.65 ? 'happy' : 'normal') : 'happy';
  const mascotComment = last
    ? `${subjectLabels[last.subject]}で ${last.correct}/${last.total} せいかい！ つぎも いっしょに がんばろう！`
    : 'きょうも ぼうけんスタート！ はじめの 1もんを いっしょに やってみよう。';

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
        {homeSubjects.map((subject) => (
          <p key={subject}>
            {subjectLabels[subject]} Lv.{adaptiveBySubject[subject].targetDifficulty}（ふくしゅう {dueReviews[subject]}）
          </p>
        ))}
      </div>

      <div className="card">
        <h2>さいきんの きろく</h2>
        {last ? (
          <p>
            {subjectLabels[last.subject]}: {last.correct}/{last.total} せいかい
          </p>
        ) : (
          <p>まだ きろくが ありません。さいしょの ぼうけんへ！</p>
        )}
      </div>

      <div className="card mascot">
        <h2>あいぼう はむちー</h2>
        <PokoIllustration mood={mascotMood} comment={mascotComment} showCaption={false} />
      </div>
    </section>
  );
}
