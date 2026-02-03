import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';

const missionCards: Array<{ subject: Subject; title: string; desc: string; reward: string }> = [
  { subject: 'math', title: 'さんすうのしま', desc: 'たしざん・ひきざんをクリアしよう', reward: 'クリアで ⭐ +1〜3' },
  { subject: 'japanese', title: 'ことばのしま', desc: 'ひらがな・ことばクイズにちょうせん', reward: 'クリアで ⭐ +1〜3' },
];

export function MissionPage() {
  const navigate = useNavigate();
  const startMission = useAppStore((state) => state.startMission);

  const onStart = (subject: Subject) => {
    startMission(subject);
    navigate('/play');
  };

  return (
    <section className="stack">
      <h1>どのしまに いく？</h1>
      {missionCards.map((mission) => (
        <article className="card mission-card" key={mission.subject}>
          <h2>{mission.title}</h2>
          <p>{mission.desc}</p>
          <p>{mission.reward}</p>
          <button className="primary-btn" onClick={() => onStart(mission.subject)}>
            このミッションであそぶ
          </button>
        </article>
      ))}
    </section>
  );
}
