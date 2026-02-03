import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { getDueReviewCount, getSubjectMastery } from '../utils/mission';

const missionCards: Array<{ subject: Subject; title: string; desc: string }> = [
  { subject: 'math', title: 'さんすうのしま', desc: 'たしざん・ひきざんをクリアしよう' },
  { subject: 'japanese', title: 'ことばのしま', desc: 'ひらがな・ことばクイズにちょうせん' },
];

export function MissionPage() {
  const navigate = useNavigate();
  const startMission = useAppStore((state) => state.startMission);
  const mathDifficulty = useAppStore((state) => state.adaptiveBySubject.math.targetDifficulty);
  const japaneseDifficulty = useAppStore((state) => state.adaptiveBySubject.japanese.targetDifficulty);
  const skillProgress = useAppStore((state) => state.skillProgress);

  const stats = useMemo(
    () => ({
      math: {
        dueReview: getDueReviewCount('math', skillProgress),
        mastery: getSubjectMastery('math', skillProgress),
      },
      japanese: {
        dueReview: getDueReviewCount('japanese', skillProgress),
        mastery: getSubjectMastery('japanese', skillProgress),
      },
    }),
    [skillProgress],
  );

  const onStart = (subject: Subject) => {
    startMission(subject);
    navigate('/play');
  };

  const difficultyBySubject: Record<Subject, number> = {
    math: mathDifficulty,
    japanese: japaneseDifficulty,
  };

  return (
    <section className="stack">
      <h1>どのしまに いく？</h1>
      {missionCards.map((mission) => (
        <article className="card mission-card" key={mission.subject}>
          <h2>{mission.title}</h2>
          <p>{mission.desc}</p>
          <p>おすすめレベル: {difficultyBySubject[mission.subject]}</p>
          <p>ふくしゅう: {stats[mission.subject].dueReview} / しゅくじゅくど: {stats[mission.subject].mastery}%</p>
          <button className="primary-btn" onClick={() => onStart(mission.subject)}>
            このミッションであそぶ
          </button>
        </article>
      ))}
    </section>
  );
}
