import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { hamcheeSrc } from '../utils/hamchee';
import { subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { getMisconceptionFeedback, getMisconceptionLabel } from '../utils/misconceptions';
import { audioManager } from '../utils/audioManager';
import { badgeById, getLevelTitle, getQuestDef } from '../utils/progression';

const modeLabel = {
  learn: 'まなびミッション',
  review: 'ふくしゅうミッション',
  challenge: 'チャレンジミッション',
} as const;

const CONFETTI_COLORS = ['#ff7a45', '#f6b81f', '#22ad97', '#6aa8ff', '#ff6fb1', '#8fdc6e'];

function starCount(accuracy: number): number {
  if (accuracy >= 1) return 3;
  if (accuracy >= 0.6) return 2;
  return 1;
}

function headline(accuracy: number): string {
  if (accuracy >= 1) return 'パーフェクト！';
  if (accuracy >= 0.8) return 'すばらしい！';
  if (accuracy >= 0.6) return 'よく がんばったね！';
  return 'ナイスチャレンジ！';
}

export function ResultPage() {
  const navigate = useNavigate();
  const result = useAppStore((state) => state.latestResult);
  const startMission = useAppStore((state) => state.startMission);
  const playedFor = useRef<string | null>(null);
  const [dismissedLevelUpFor, setDismissedLevelUpFor] = useState<string | null>(null);

  const leveledUp = Boolean(result && result.levelAfter && result.levelBefore && result.levelAfter > result.levelBefore);
  const levelUpOpen = Boolean(result && leveledUp && dismissedLevelUpFor !== result.date);
  const closeLevelUp = () => setDismissedLevelUpFor(result?.date ?? null);
  const celebrate = Boolean(result && result.accuracy >= 0.8);

  const confetti = useMemo(() => {
    if (!celebrate) return [];
    return Array.from({ length: 36 }, (_, index) => ({
      id: index,
      left: (index * 37 + 7) % 100,
      delay: ((index * 13) % 20) * 0.06,
      duration: 2.2 + (index % 6) * 0.25,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      drift: ((index % 7) - 3) * 18,
      spin: 360 + (index % 5) * 120,
    }));
  }, [celebrate]);

  useEffect(() => {
    if (!result) return;
    if (playedFor.current === result.date) return;
    playedFor.current = result.date;
    audioManager.playSfx('clear');
  }, [result]);

  if (!result) {
    return (
      <section className="card stack">
        <h1>けっかが ありません</h1>
        <Link className="primary-btn" to="/mission" onClick={() => audioManager.playSfx('tap')}>
          ぼうけんマップへ
        </Link>
      </section>
    );
  }

  const info = subjectInfo[result.subject];
  const stars = starCount(result.accuracy);
  const newBadges = (result.newBadges ?? []).map((id) => badgeById[id]).filter(Boolean);
  const completedQuests = (result.completedQuests ?? []).map((id) => getQuestDef(id)).filter(Boolean);

  const onRetry = () => {
    audioManager.playSfx('tap');
    startMission(result.subject);
    navigate('/play');
  };

  return (
    <section className="stack">
      {confetti.length > 0 ? (
        <div className="confetti" aria-hidden="true">
          {confetti.map((piece) => (
            <span
              className="confetti-piece"
              key={piece.id}
              style={
                {
                  left: `${piece.left}%`,
                  background: piece.color,
                  animationDelay: `${piece.delay}s`,
                  animationDuration: `${piece.duration}s`,
                  '--drift': `${piece.drift}px`,
                  '--spin': `${piece.spin}deg`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}

      <article className="hero-card result-hero">
        <p className="eyebrow">
          {info.emoji} {info.island} ・ {modeLabel[result.mode]}
        </p>
        <div className="result-stars" aria-label={`ほし ${stars}つ`}>
          {[0, 1, 2].map((index) => (
            <span className={index < stars ? '' : 'off'} key={index} style={{ animationDelay: `${0.2 + index * 0.18}s` }}>
              ⭐
            </span>
          ))}
        </div>
        <h1>{headline(result.accuracy)}</h1>
        <p className="result-score">
          {result.correct}
          <span style={{ fontSize: '0.5em', opacity: 0.6 }}> / {result.total}</span>
        </p>
        <div className="reward-row">
          <span className="reward-pill gold">⭐ +{result.earnedStars}</span>
          <span className="reward-pill mint">XP +{result.earnedXp}</span>
          {result.bestComboInMission && result.bestComboInMission >= 3 ? (
            <span className="reward-pill">🔥 コンボ {result.bestComboInMission}</span>
          ) : null}
        </div>
        {result.afterDifficulty !== result.beforeDifficulty ? (
          <p className="muted">
            おすすめレベル {result.beforeDifficulty} → {result.afterDifficulty}
            {result.afterDifficulty > result.beforeDifficulty ? ' 📈' : ''}
          </p>
        ) : null}
      </article>

      {newBadges.length > 0 || completedQuests.length > 0 ? (
        <section className="card">
          <h2>🎁 ゲットしたもの</h2>
          <div className="unlock-list">
            {newBadges.map((badge, index) => (
              <div className="unlock-item" key={badge.id} style={{ animationDelay: `${0.3 + index * 0.15}s` }}>
                <span className="unlock-icon" aria-hidden="true">
                  {badge.icon}
                </span>
                <div>
                  <p>あたらしい バッジ「{badge.name}」</p>
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    {badge.description}
                  </p>
                </div>
              </div>
            ))}
            {completedQuests.map((quest, index) =>
              quest ? (
                <div className="unlock-item" key={quest.id} style={{ animationDelay: `${0.4 + index * 0.15}s` }}>
                  <span className="unlock-icon" aria-hidden="true">
                    📜
                  </span>
                  <div>
                    <p>クエスト たっせい！「{quest.title}」</p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      ホームで ほしを うけとろう
                    </p>
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </section>
      ) : null}

      {result.topMisconceptions && result.topMisconceptions.length > 0 ? (
        <section className="card result-detail">
          <h2>🔍 つぎに きを つけること</h2>
          <p className="muted">{result.topMisconceptions.map((item) => `${getMisconceptionLabel(item.tag)}（${item.count}）`).join(' / ')}</p>
          {result.recommendedFocusTag ? <p>👉 {getMisconceptionFeedback(result.recommendedFocusTag)}</p> : null}
        </section>
      ) : null}

      <div className="stack">
        <button className="primary-btn btn-lg btn-block" onClick={onRetry}>
          {info.emoji} もういちど {info.label}
        </button>
        <div className="inline-actions">
          <Link className="ghost-btn" to="/mission" onClick={() => audioManager.playSfx('tap')}>
            🧭 マップへ
          </Link>
          <Link className="ghost-btn" to="/" onClick={() => audioManager.playSfx('tap')}>
            🏝️ ホームへ
          </Link>
        </div>
      </div>

      {levelUpOpen && result.levelAfter ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="levelup-title" onClick={closeLevelUp}>
          <div className="overlay-card" onClick={(event) => event.stopPropagation()}>
            <img src={hamcheeSrc('cheer')} alt="" width={140} height={140} />
            <p className="eyebrow" id="levelup-title">
              レベルアップ！
            </p>
            <p className="overlay-level">Lv.{result.levelAfter}</p>
            <p>{getLevelTitle(result.levelAfter)}</p>
            <button className="primary-btn btn-block" onClick={closeLevelUp} autoFocus>
              やったー！
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
