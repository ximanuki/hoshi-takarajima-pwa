import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { bosses } from '../data/bosses';
import { getSkillLabel, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';
import { hamcheeSrc } from '../utils/hamchee';
import { getMisconceptionFeedback } from '../utils/misconceptions';
import { badgeById, getLevelTitle, getQuestDef } from '../utils/progression';

const CONFETTI_COLORS = ['#ff7eb6', '#ffd45c', '#5fd0b8', '#8fd3ff', '#b9a3ff', '#ffa77f'];
const CONFETTI_SHAPES = ['♥', '★', '✦', '♥', '●'];

function accuracyStars(accuracy: number): number {
  if (accuracy >= 1) return 3;
  if (accuracy >= 0.6) return 2;
  return 1;
}

function ChestSvg() {
  // リボンつきの プレゼントばこ
  return (
    <svg className="chest-svg" viewBox="0 0 160 150" aria-hidden="true">
      <g className="chest-glow">
        {Array.from({ length: 12 }, (_, index) => (
          <path
            d="M 80 80 L 74 0 L 86 0 Z"
            fill={index % 2 === 0 ? '#ffd45c' : '#ffb3d6'}
            key={index}
            opacity={0.75}
            transform={`rotate(${index * 30} 80 80)`}
          />
        ))}
      </g>
      <rect x={24} y={70} width={112} height={70} rx={14} fill="#ff9fc9" stroke="#6a3d73" strokeWidth={4} />
      <rect x={70} y={70} width={20} height={70} fill="#fff4cc" stroke="#6a3d73" strokeWidth={3} />
      <circle cx={48} cy={100} r={5} fill="#fff" opacity={0.8} />
      <circle cx={112} cy={118} r={4} fill="#fff" opacity={0.8} />
      <g className="lid">
        <rect x={16} y={50} width={128} height={26} rx={10} fill="#ffb3d6" stroke="#6a3d73" strokeWidth={4} />
        <rect x={70} y={50} width={20} height={26} fill="#fff4cc" stroke="#6a3d73" strokeWidth={3} />
        <path d="M 80 50 C 60 20, 34 34, 52 50 Z" fill="#fff4cc" stroke="#6a3d73" strokeWidth={3} strokeLinejoin="round" />
        <path d="M 80 50 C 100 20, 126 34, 108 50 Z" fill="#fff4cc" stroke="#6a3d73" strokeWidth={3} strokeLinejoin="round" />
        <circle cx={80} cy={48} r={7} fill="#ffd45c" stroke="#6a3d73" strokeWidth={3} />
      </g>
    </svg>
  );
}

export function ResultPage() {
  const navigate = useNavigate();
  const result = useAppStore((state) => state.latestResult);
  const startMission = useAppStore((state) => state.startMission);
  const playedFor = useRef<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [dismissedLevelUpFor, setDismissedLevelUpFor] = useState<string | null>(null);

  const opened = Boolean(result && openedFor === result.date);
  const leveledUp = Boolean(result?.levelAfter && result.levelBefore && result.levelAfter > result.levelBefore);
  const levelUpOpen = Boolean(result && opened && leveledUp && dismissedLevelUpFor !== result.date);

  const confetti = useMemo(
    () =>
      Array.from({ length: 40 }, (_, index) => ({
        id: index,
        left: (index * 37 + 7) % 100,
        delay: ((index * 13) % 20) * 0.05,
        duration: 2.2 + (index % 6) * 0.25,
        color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        shape: CONFETTI_SHAPES[index % CONFETTI_SHAPES.length],
        drift: ((index % 7) - 3) * 18,
        spin: 360 + (index % 5) * 120,
      })),
    [],
  );

  useEffect(() => {
    if (!result || playedFor.current === result.date) return;
    playedFor.current = result.date;
    audioManager.playSfx('clear');
  }, [result]);

  if (!result) {
    return (
      <div className="screen">
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <h1>けっかが ないよ</h1>
          <Link className="btn btn-primary" to="/">
            マップへ
          </Link>
        </div>
      </div>
    );
  }

  const info = subjectInfo[result.subject];
  const kind = result.kind ?? 'adaptive';
  const stars = kind === 'adaptive' ? accuracyStars(result.accuracy) : result.nodeStars ?? 0;
  const boss = bosses[result.subject];
  const title =
    kind === 'boss'
      ? result.bossDefeated
        ? `${boss.name}と なかよしに なった！`
        : `${boss.name}は ${boss.escape}`
      : result.accuracy >= 1
        ? 'パーフェクト！'
        : result.accuracy >= 0.6
          ? 'よく できました！'
          : 'ナイス チャレンジ！';
  const celebrate = result.accuracy >= 0.8 || Boolean(result.bossDefeated);
  const newBadges = (result.newBadges ?? []).map((id) => badgeById[id]).filter(Boolean);
  const quests = (result.completedQuests ?? []).map((id) => getQuestDef(id)).filter((quest) => quest !== undefined);
  const backTo = result.skillId ? `/island/${result.subject}` : '/';

  const onOpen = () => {
    if (opened) return;
    audioManager.playSfx('gift');
    setOpenedFor(result.date);
  };

  const onRetry = () => {
    audioManager.playSfx('tap');
    if (result.skillId && kind !== 'adaptive') startMission(result.subject, { skillId: result.skillId, kind });
    else startMission(result.subject);
    navigate('/play');
  };

  const rewards: Array<{ key: string; icon: string; text: string; sticker?: boolean }> = [
    { key: 'stars', icon: '⭐', text: `ほし +${result.earnedStars} ・ XP +${result.earnedXp}` },
    ...(result.newSticker
      ? [{ key: 'sticker', icon: result.newSticker, text: 'あたらしい ステッカー！ たからべやに かざったよ', sticker: true }]
      : []),
    ...(result.unlockedNextSkill
      ? [{ key: 'unlock', icon: '🔓', text: `つぎの ステージ「${getSkillLabel(result.unlockedNextSkill)}」が ひらいた！` }]
      : []),
    ...newBadges.map((badge) => ({ key: `badge-${badge.id}`, icon: badge.icon, text: `バッジ「${badge.name}」` })),
    ...quests.map((quest) => ({ key: `quest-${quest.id}`, icon: '📜', text: `クエスト たっせい「${quest.title}」` })),
    ...(result.recommendedFocusTag
      ? [{ key: 'focus', icon: '💡', text: `つぎは: ${getMisconceptionFeedback(result.recommendedFocusTag)}` }]
      : []),
  ];

  return (
    <div className="screen">
      {celebrate && opened ? (
        <div className="confetti" aria-hidden="true">
          {confetti.map((piece) => (
            <span
              className="confetti-piece"
              key={piece.id}
              style={
                {
                  left: `${piece.left}%`,
                  color: piece.color,
                  animationDelay: `${piece.delay}s`,
                  animationDuration: `${piece.duration}s`,
                  '--drift': `${piece.drift}px`,
                  '--spin': `${piece.spin}deg`,
                } as CSSProperties
              }
            >
              {piece.shape}
            </span>
          ))}
        </div>
      ) : null}

      <section className="result-stage">
        <p className="muted on-night">
          {info.emoji} {result.skillId ? getSkillLabel(result.skillId) : `${info.label} おまかせ`}
        </p>
        <div className="result-big-stars" aria-label={`ほし ${stars}つ`}>
          {[0, 1, 2].map((index) => (
            <span className={index < stars ? '' : 'off'} key={index} style={{ animationDelay: `${0.2 + index * 0.2}s` }}>
              ⭐
            </span>
          ))}
        </div>
        <h1 className="result-title">{title}</h1>
        <p className="result-score">
          {result.correct} / {result.total} もん せいかい
        </p>
      </section>

      <section className="chest-stage">
        <button className={`chest-btn ${opened ? 'open' : 'closed'}`} onClick={onOpen} aria-label="プレゼントを あける">
          <ChestSvg />
        </button>
        {!opened ? <p className="chest-hint">👆 タップして プレゼントを あけよう！</p> : null}
      </section>

      {opened ? (
        <div className="reward-list">
          {rewards.map((reward, index) => (
            <div
              className={`reward-item ${reward.sticker ? 'reward-sticker' : ''}`}
              key={reward.key}
              style={{ animationDelay: `${0.3 + index * 0.15}s` }}
            >
              <span className="ri-icon">{reward.icon}</span>
              <span>{reward.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10 }}>
        <button
          className="btn btn-primary btn-xl btn-block"
          onClick={() => {
            if (!opened) {
              onOpen();
              return;
            }
            audioManager.playSfx('tap');
            navigate(backTo);
          }}
        >
          {opened ? (result.skillId ? 'みちに もどる ›' : 'マップに もどる ›') : '🎁 あける'}
        </button>
        {opened ? (
          <button className="btn btn-cream btn-block" onClick={onRetry}>
            🔁 もういちど
          </button>
        ) : null}
      </div>

      {levelUpOpen && result.levelAfter ? (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="levelup-title"
          onClick={() => setDismissedLevelUpFor(result.date)}
        >
          <div className="overlay-card" onClick={(event) => event.stopPropagation()}>
            <img src={hamcheeSrc('cheer')} alt="" width={140} height={140} />
            <p id="levelup-title">レベルアップ！</p>
            <p className="overlay-level">Lv.{result.levelAfter}</p>
            <p>{getLevelTitle(result.levelAfter)}</p>
            <button className="btn btn-primary btn-block" onClick={() => setDismissedLevelUpFor(result.date)} autoFocus>
              やったー！
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
