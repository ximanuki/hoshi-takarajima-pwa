import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { SUBJECTS, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import {
  MAX_ISLAND_RANK,
  badgeCategoryLabels,
  badgeMaster,
  getIslandRank,
  getLevelTitle,
  type BadgeCategory,
  type BadgeContext,
} from '../utils/progression';

type Tab = 'badges' | 'islands' | 'records';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'badges', label: '🏅 バッジ' },
  { id: 'islands', label: '🏝️ しま' },
  { id: 'records', label: '📊 きろく' },
];

const CATEGORY_ORDER: BadgeCategory[] = ['start', 'island', 'skill', 'habit', 'legend'];

export function CollectionPage() {
  const badges = useAppStore((state) => state.badges);
  const stats = useAppStore((state) => state.stats);
  const subjectClears = useAppStore((state) => state.subjectClears);
  const streakDays = useAppStore((state) => state.streakDays);
  const level = useAppStore((state) => state.level);
  const stars = useAppStore((state) => state.stars);
  const [tab, setTab] = useState<Tab>('badges');

  const ctx: BadgeContext = useMemo(() => ({ stats, subjectClears, streakDays, level }), [level, stats, streakDays, subjectClears]);
  const owned = useMemo(() => new Set(badges), [badges]);
  const ownedCount = badgeMaster.filter((badge) => owned.has(badge.id)).length;
  const accuracy = stats.totalAnswered > 0 ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  return (
    <section className="stack">
      <div>
        <p className="eyebrow">たからばこ</p>
        <h1>コレクション</h1>
      </div>

      <div className="tabs" role="tablist" aria-label="コレクションの しゅるい">
        {TABS.map((item) => (
          <button
            className={`tab ${tab === item.id ? 'active' : ''}`}
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'badges' ? (
        <>
          <div className="card flat level-card">
            <div className="level-row">
              <strong>あつめた バッジ</strong>
              <span>
                {ownedCount} / {badgeMaster.length}
              </span>
            </div>
            <div className="meter" aria-hidden="true">
              <div className="meter-fill gold" style={{ width: `${(ownedCount / badgeMaster.length) * 100}%` }} />
            </div>
          </div>

          {CATEGORY_ORDER.map((category) => (
            <section className="stack" key={category} aria-labelledby={`badge-cat-${category}`}>
              <h2 id={`badge-cat-${category}`}>{badgeCategoryLabels[category]}</h2>
              <div className="badge-grid">
                {badgeMaster
                  .filter((badge) => badge.category === category)
                  .map((badge) => {
                    const unlocked = owned.has(badge.id);
                    const { value, target } = badge.progress(ctx);
                    return (
                      <article className={`badge-card ${unlocked ? '' : 'locked'}`} key={badge.id}>
                        <span className="badge-icon" aria-hidden="true">
                          {unlocked ? badge.icon : '？'}
                        </span>
                        <p className="badge-title">{unlocked ? badge.name : '？？？'}</p>
                        <p className="badge-desc">{badge.description}</p>
                        {unlocked ? null : (
                          <>
                            <div className="meter thin" aria-hidden="true">
                              <div className="meter-fill gold" style={{ width: `${(value / target) * 100}%` }} />
                            </div>
                            <p className="badge-desc">
                              {value} / {target}
                            </p>
                          </>
                        )}
                      </article>
                    );
                  })}
              </div>
            </section>
          ))}
        </>
      ) : null}

      {tab === 'islands' ? (
        <div className="rank-list">
          {SUBJECTS.map((subject) => {
            const info = subjectInfo[subject];
            const clears = subjectClears[subject] ?? 0;
            const rank = getIslandRank(clears);
            return (
              <div className="rank-row" key={subject} style={{ '--h': info.hue } as CSSProperties}>
                <span className="island-emoji" aria-hidden="true">
                  {info.emoji}
                </span>
                <div className="stack" style={{ gap: 4 }}>
                  <div className="level-row">
                    <strong>{info.island}</strong>
                    <span className="rank-stars" aria-label={`ランク ${rank.rank}`}>
                      {Array.from({ length: MAX_ISLAND_RANK }, (_, index) => (
                        <span className={index < rank.rank ? '' : 'off'} key={index}>
                          ⭐
                        </span>
                      ))}
                    </span>
                  </div>
                  <div className="meter thin" aria-hidden="true">
                    <div className="meter-fill" style={{ width: `${rank.progress * 100}%` }} />
                  </div>
                  <span style={{ fontSize: '0.78rem' }}>
                    ランク「{rank.name}」・クリア {clears}かい
                    {rank.nextAt !== null ? `（つぎの ランクまで あと ${rank.nextAt - clears}かい）` : '（さいこう ランク！）'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === 'records' ? (
        <>
          <div className="card flat">
            <p className="eyebrow">いまの しょうごう</p>
            <h2>
              Lv.{level} {getLevelTitle(level)}
            </h2>
          </div>
          <div className="stat-grid">
            {[
              { label: 'あつめた ほし', value: `⭐${stars}` },
              { label: 'せいかいした もんだい', value: stats.totalCorrect },
              { label: 'せいとうりつ', value: `${accuracy}%` },
              { label: 'さいこう コンボ', value: `🔥${stats.bestCombo}` },
              { label: 'ぜんもん せいかい', value: stats.perfectCount },
              { label: 'さいちょう れんぞく', value: `${Math.max(stats.bestStreakDays, streakDays)}にち` },
              { label: 'たっせい クエスト', value: stats.questsCompleted },
              { label: 'クリアした ミッション', value: SUBJECTS.reduce((sum, subject) => sum + (subjectClears[subject] ?? 0), 0) },
            ].map((tile) => (
              <div className="stat-tile" key={tile.label}>
                <span className="stat-value">{tile.value}</span>
                <span className="stat-label">{tile.label}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
