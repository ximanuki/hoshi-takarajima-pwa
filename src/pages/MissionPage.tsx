import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { getDueReviewCount, getSubjectMastery } from '../utils/mission';

const missionCards: Array<{ subject: Subject; title: string; desc: string }> = [
  { subject: 'math', title: 'さんすうのしま', desc: 'たしざん・ひきざんをクリアしよう' },
  { subject: 'japanese', title: 'こくごのしま', desc: 'ことば・よみとりクイズにちょうせん' },
  { subject: 'life', title: 'くらしのしま', desc: 'とけい・おかね・あんぜんを まなぼう' },
  { subject: 'insight', title: 'ひらめきのしま', desc: 'はっけん・すいり・なぞに ちょうせん' },
];

export function MissionPage() {
  const navigate = useNavigate();
  const startMission = useAppStore((state) => state.startMission);
  const adaptiveBySubject = useAppStore((state) => state.adaptiveBySubject);
  const skillProgress = useAppStore((state) => state.skillProgress);

  const stats = useMemo(
    () =>
      Object.fromEntries(
        missionCards.map((mission) => [
          mission.subject,
          {
            dueReview: getDueReviewCount(mission.subject, skillProgress),
            mastery: getSubjectMastery(mission.subject, skillProgress),
          },
        ]),
      ) as Record<Subject, { dueReview: number; mastery: number }>,
    [skillProgress],
  );

  const onStart = (subject: Subject) => {
    startMission(subject);
    navigate('/play');
  };

  const difficultyBySubject = useMemo(
    () =>
      Object.fromEntries(
        missionCards.map((mission) => [mission.subject, adaptiveBySubject[mission.subject].targetDifficulty]),
      ) as Record<Subject, number>,
    [adaptiveBySubject],
  );

  return (
    <section className="stack">
      <h1>どのしまに いく？</h1>
      {missionCards.map((mission) => (
        <article className="card mission-card" key={mission.subject}>
          <h2>{mission.title}</h2>
          <p>{mission.desc}</p>
          <p>おすすめレベル: {difficultyBySubject[mission.subject]}</p>
          <p>ふくしゅう: {stats[mission.subject].dueReview} / しゅうじゅくど: {stats[mission.subject].mastery}%</p>
          <button className="primary-btn" onClick={() => onStart(mission.subject)}>
            このミッションであそぶ
          </button>
        </article>
      ))}
    </section>
  );
}
