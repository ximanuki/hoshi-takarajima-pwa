import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Hud } from '../components/Hud';
import { bosses } from '../data/bosses';
import { islandPaths } from '../data/islandPaths';
import { getLesson } from '../data/lessons';
import { getSkillLabel, isSubject, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import type { NodeKind, NodeStars } from '../types';
import { audioManager } from '../utils/audioManager';
import { hamcheeSrc } from '../utils/hamchee';
import { emptyNodeStars, getIslandStars, getNextStepInIsland, isStageUnlocked } from '../utils/practice';

const ZIGZAG = [0, 64, 96, 64, 0, -64, -96, -64];

function Stars({ count, max = 3 }: { count: number; max?: number }) {
  return (
    <span className="stars-row" aria-label={`ほし ${count}`}>
      {Array.from({ length: max }, (_, index) => (
        <span className={index < count ? '' : 'off'} key={index}>
          ⭐
        </span>
      ))}
    </span>
  );
}

export function IslandPage() {
  const { subject: rawSubject } = useParams();
  const navigate = useNavigate();
  const nodeProgress = useAppStore((state) => state.nodeProgress);
  const stickers = useAppStore((state) => state.stickers);
  const startMission = useAppStore((state) => state.startMission);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const currentRef = useRef<HTMLDivElement | null>(null);

  const subject = isSubject(rawSubject) ? rawSubject : null;
  const stages = useMemo(() => (subject ? islandPaths[subject] : []), [subject]);
  const next = useMemo(() => (subject ? getNextStepInIsland(subject, nodeProgress) : null), [nodeProgress, subject]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  if (!subject || !next) return <Navigate to="/" replace />;

  const info = subjectInfo[subject];
  const boss = bosses[subject];
  const totals = getIslandStars(subject, nodeProgress);
  const starsOf = (skillId: string): NodeStars => nodeProgress[skillId] ?? emptyNodeStars();

  const onNode = (kind: NodeKind, skillId: string) => {
    audioManager.playSfx('tap');
    setOpenStage(null);
    if (kind === 'lesson') {
      navigate(`/lesson/${skillId}`);
      return;
    }
    startMission(subject, { skillId, kind });
    navigate('/play');
  };

  const onRandom = () => {
    audioManager.playSfx('tap');
    startMission(subject);
    navigate('/play');
  };

  const sheetStage = openStage !== null ? stages[openStage] : null;
  const sheetStars = sheetStage ? starsOf(sheetStage.skillId) : null;

  return (
    <div className="screen">
      <Hud backTo="/" title={info.island} />

      <section className="island-banner" data-emoji={info.emoji} style={{ '--h': info.hue } as CSSProperties}>
        <p style={{ fontSize: '0.85rem' }}>{info.desc}</p>
        <div className="meter" aria-label={`ほし ${totals.earned} / ${totals.max}`}>
          <div className="meter-fill star" style={{ width: `${(totals.earned / totals.max) * 100}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>
            ★ {totals.earned} / {totals.max}
          </span>
          <button className="btn btn-cream btn-sm" onClick={onRandom}>
            🎲 おまかせ こうかい
          </button>
        </div>
      </section>

      <div className="path">
        {stages.map((stage, index) => {
          const stars = starsOf(stage.skillId);
          const unlocked = isStageUnlocked(index, index > 0 ? starsOf(stages[index - 1].skillId) : undefined);
          const isCurrent = index === next.stageIndex;
          const cleared = stickers.includes(stage.skillId);
          const total = Math.min(3, Math.round((stars.lesson / 3 + stars.practice + stars.boss) / 7 * 3));
          return (
            <div
              className="path-stop"
              key={stage.skillId}
              ref={isCurrent ? currentRef : undefined}
              style={{ '--offset': `${ZIGZAG[index % ZIGZAG.length]}px` } as CSSProperties}
            >
              <button
                aria-label={`${index + 1}. ${getSkillLabel(stage.skillId)}${unlocked ? '' : '（まだ とじている）'}`}
                className={`path-node ${unlocked ? '' : 'locked'} ${cleared ? 'cleared' : ''} ${isCurrent && unlocked ? 'current' : ''}`}
                disabled={!unlocked}
                onClick={() => {
                  audioManager.playSfx('tap');
                  setOpenStage(index);
                }}
                style={{ '--h': info.hue } as CSSProperties}
              >
                <span aria-hidden="true">{cleared || unlocked ? stage.sticker : '❔'}</span>
                {!unlocked ? (
                  <span className="lock" aria-hidden="true">
                    🔒
                  </span>
                ) : null}
              </button>
              {isCurrent && unlocked ? <img className="path-here" src={hamcheeSrc('cheer')} alt="" width={64} height={64} /> : null}
              <span className="path-label">{getSkillLabel(stage.skillId)}</span>
              {unlocked ? <Stars count={total} /> : null}
            </div>
          );
        })}
      </div>

      {sheetStage && sheetStars ? (
        <>
          <div className="sheet-backdrop" onClick={() => setOpenStage(null)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="stage-sheet-title">
            <div className="sheet-grip" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '2.4rem' }} aria-hidden="true">
                {sheetStage.sticker}
              </span>
              <div>
                <h2 id="stage-sheet-title">{getSkillLabel(sheetStage.skillId)}</h2>
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  {getLesson(sheetStage.skillId)?.goal}
                </p>
              </div>
            </div>

            <button className="node-action lesson" onClick={() => onNode('lesson', sheetStage.skillId)}>
              <span className="na-icon" aria-hidden="true">
                📖
              </span>
              <span>
                <span className="na-title">まなぶ</span>
                <span className="na-sub">はむちーと やりかたを しろう</span>
              </span>
              <span>{sheetStars.lesson > 0 ? '✅' : 'NEW'}</span>
            </button>

            <button className="node-action practice" onClick={() => onNode('practice', sheetStage.skillId)}>
              <span className="na-icon" aria-hidden="true">
                ⭐
              </span>
              <span>
                <span className="na-title">れんしゅう</span>
                <span className="na-sub">5もんで ほしあつめ</span>
              </span>
              <Stars count={sheetStars.practice} />
            </button>

            <button
              className="node-action boss"
              disabled={sheetStars.practice < 1}
              onClick={() => onNode('boss', sheetStage.skillId)}
            >
              <span className="na-icon" aria-hidden="true">
                {sheetStars.practice < 1 ? '🔒' : boss.sprite}
              </span>
              <span>
                <span className="na-title">なかよしチャレンジ</span>
                <span className="na-sub">
                  {sheetStars.practice < 1 ? 'れんしゅうで ★1 とると ひらくよ' : `${boss.name}と なかよしに なって ステッカーを ゲット！`}
                </span>
              </span>
              <Stars count={sheetStars.boss} />
            </button>

            <button className="btn btn-cream btn-sm" onClick={() => setOpenStage(null)}>
              とじる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
