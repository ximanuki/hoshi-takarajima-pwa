import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DailyQuestCard } from '../components/DailyQuestCard';
import { Hud } from '../components/Hud';
import { WorldMap } from '../components/world/WorldMap';
import { getSkillLabel, SUBJECTS, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { audioManager } from '../utils/audioManager';
import { hamcheeSrc, type PokoMood } from '../utils/hamchee';
import { getIslandStars, getNextStep } from '../utils/practice';
import { speak } from '../utils/speech';

const GREETINGS: Record<'morning' | 'day' | 'night', string[]> = {
  morning: ['おはよう！ きょうも ぼうけんに いこう！', 'あさの うみは きもちいいね！', 'おはよう！ ほしを あつめに いこう！'],
  day: ['こんにちは！ どの しまに いく？', 'いい てんき！ ぼうけん びより！', 'こんにちは！ たからを さがそう！'],
  night: ['こんばんは！ ほしが きれいだね。', 'よるの うみを わたろう！', 'こんばんは！ すこしだけ ぼうけんしよう。'],
};

function dayPart(date: Date): 'morning' | 'day' | 'night' {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'day';
  return 'night';
}

const KIND_LABEL = { lesson: '📖 まなぶ', practice: '⚔️ れんしゅう', boss: '👑 ボス' } as const;

export function WorldPage() {
  const navigate = useNavigate();
  const nodeProgress = useAppStore((state) => state.nodeProgress);
  const lastIsland = useAppStore((state) => state.lastIsland);
  const startMission = useAppStore((state) => state.startMission);

  const islandStars = useMemo(
    () => Object.fromEntries(SUBJECTS.map((subject) => [subject, getIslandStars(subject, nodeProgress)])) as Record<
      Subject,
      { earned: number; max: number }
    >,
    [nodeProgress],
  );
  const next = useMemo(() => getNextStep(nodeProgress, lastIsland), [lastIsland, nodeProgress]);

  const now = new Date();
  const part = dayPart(now);
  const greeting = GREETINGS[part][now.getDate() % GREETINGS[part].length];
  const mood: PokoMood = part === 'night' ? 'sleepy' : 'happy';

  const onSelectIsland = (subject: Subject) => {
    audioManager.playSfx('tap');
    navigate(`/island/${subject}`);
  };

  const onContinue = () => {
    audioManager.playSfx('tap');
    if (next.kind === 'lesson') {
      navigate(`/lesson/${next.skillId}`);
      return;
    }
    startMission(next.subject, { skillId: next.skillId, kind: next.kind });
    navigate('/play');
  };

  return (
    <div className="screen">
      <Hud title={<span>⭐ ほしのたからじま</span>} />

      <div className="world-greeting">
        <div className="mascot-badge">
          <img src={hamcheeSrc(mood)} alt="はむちー" width={512} height={512} />
        </div>
        <button className="bubble" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => speak(greeting)}>
          {greeting}
        </button>
      </div>

      <WorldMap islandStars={islandStars} boatAt={lastIsland} onSelect={onSelectIsland} />

      <div className="world-actions">
        <button className="btn btn-primary btn-xl btn-block" onClick={onContinue}>
          ⛵ つづきから ぼうけん
        </button>
        <p className="muted on-night" style={{ textAlign: 'center', fontSize: '0.85rem' }}>
          {subjectInfo[next.subject].emoji} {getSkillLabel(next.skillId)} の {KIND_LABEL[next.kind]}
        </p>

        <DailyQuestCard />

        <div className="quick-links">
          <Link className="btn btn-cream" to="/treasure" onClick={() => audioManager.playSfx('tap')}>
            🏆 たからべや
          </Link>
          <Link className="btn btn-cream" to="/parent" onClick={() => audioManager.playSfx('tap')}>
            👪 おとなの へや
          </Link>
        </div>
      </div>
    </div>
  );
}
