import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Hud } from '../components/Hud';
import { islandPaths } from '../data/islandPaths';
import { getSkillLabel, SUBJECTS, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { badgeMaster, getLevelTitle, type BadgeContext } from '../utils/progression';

type Tab = 'stickers' | 'badges' | 'records';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'stickers', label: '🌟 ステッカー' },
  { id: 'badges', label: '🏅 バッジ' },
  { id: 'records', label: '📊 きろく' },
];

export function TreasurePage() {
  const stickers = useAppStore((state) => state.stickers);
  const badges = useAppStore((state) => state.badges);
  const stats = useAppStore((state) => state.stats);
  const subjectClears = useAppStore((state) => state.subjectClears);
  const streakDays = useAppStore((state) => state.streakDays);
  const level = useAppStore((state) => state.level);
  const stars = useAppStore((state) => state.stars);
  const [tab, setTab] = useState<Tab>('stickers');

  const ctx: BadgeContext = useMemo(() => ({ stats, subjectClears, streakDays, level }), [level, stats, streakDays, subjectClears]);
  const owned = useMemo(() => new Set(badges), [badges]);
  const ownedStickers = useMemo(() => new Set(stickers), [stickers]);
  const totalStickers = SUBJECTS.reduce((sum, subject) => sum + islandPaths[subject].length, 0);
  const accuracy = stats.totalAnswered > 0 ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  return (
    <div className="screen">
      <Hud backTo="/" title="たからべや" />

      <div className="tabs" role="tablist" aria-label="たからの しゅるい">
        {TABS.map((item) => (
          <button
            aria-selected={tab === item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            key={item.id}
            onClick={() => setTab(item.id)}
            role="tab"
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'stickers' ? (
        <>
          <p className="muted on-night" style={{ textAlign: 'center' }}>
            ボスを たおすと ステッカーが もらえるよ（{stickers.length} / {totalStickers}）
          </p>
          {SUBJECTS.map((subject) => {
            const info = subjectInfo[subject];
            const stages = islandPaths[subject];
            const got = stages.filter((stage) => ownedStickers.has(stage.skillId)).length;
            return (
              <section className="panel shelf" key={subject} style={{ '--h': info.hue } as CSSProperties}>
                <div className="shelf-head">
                  <h2>
                    {info.emoji} {info.island}
                  </h2>
                  <span className="muted">
                    {got}/{stages.length}
                  </span>
                </div>
                <div className="shelf-grid">
                  {stages.map((stage) =>
                    ownedStickers.has(stage.skillId) ? (
                      <span className="sticker" key={stage.skillId} title={getSkillLabel(stage.skillId)}>
                        {stage.sticker}
                      </span>
                    ) : (
                      <span className="sticker empty" key={stage.skillId} aria-label="まだ ない">
                        ？
                      </span>
                    ),
                  )}
                </div>
              </section>
            );
          })}
        </>
      ) : null}

      {tab === 'badges' ? (
        <div className="badge-grid">
          {badgeMaster.map((badge) => {
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
                  <div className="meter thin" style={{ width: '100%' }} aria-label={`${value} / ${target}`}>
                    <div className="meter-fill star" style={{ width: `${(value / target) * 100}%` }} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      {tab === 'records' ? (
        <>
          <div className="panel">
            <p className="muted">いまの しょうごう</p>
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
              { label: 'よんだ レッスン', value: stats.lessonsDone },
              { label: 'たおした ボス', value: stats.bossWins },
              { label: 'さいちょう れんぞく', value: `${Math.max(stats.bestStreakDays, streakDays)}にち` },
              { label: 'たっせい クエスト', value: stats.questsCompleted },
            ].map((tile) => (
              <div className="stat-tile" key={tile.label}>
                <span className="stat-value">{tile.value}</span>
                <span className="stat-label">{tile.label}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
