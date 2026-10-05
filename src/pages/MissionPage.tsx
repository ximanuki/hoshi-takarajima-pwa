import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUBJECTS, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { getDueReviewCount, getSubjectMastery } from '../utils/mission';
import { MAX_ISLAND_RANK, getIslandRank } from '../utils/progression';
import { audioManager } from '../utils/audioManager';

export function MissionPage() {
  const navigate = useNavigate();
  const startMission = useAppStore((state) => state.startMission);
  const adaptiveBySubject = useAppStore((state) => state.adaptiveBySubject);
  const skillProgress = useAppStore((state) => state.skillProgress);
  const subjectClears = useAppStore((state) => state.subjectClears);

  const stats = useMemo(
    () =>
      Object.fromEntries(
        SUBJECTS.map((subject) => [
          subject,
          {
            dueReview: getDueReviewCount(subject, skillProgress),
            mastery: getSubjectMastery(subject, skillProgress),
          },
        ]),
      ) as Record<Subject, { dueReview: number; mastery: number }>,
    [skillProgress],
  );

  const onStart = (subject: Subject) => {
    audioManager.playSfx('tap');
    startMission(subject);
    navigate('/play');
  };

  return (
    <section className="stack">
      <div>
        <p className="eyebrow">ぼうけんマップ</p>
        <h1>どの しまに いく？</h1>
      </div>

      <div className="island-map">
        {SUBJECTS.map((subject) => {
          const info = subjectInfo[subject];
          const clears = subjectClears[subject] ?? 0;
          const rank = getIslandRank(clears);
          const { dueReview, mastery } = stats[subject];

          return (
            <article
              className={`island-card ${clears === 0 && subject === 'nature' ? 'new-island' : ''}`}
              data-emoji={info.emoji}
              key={subject}
              style={{ '--h': info.hue } as CSSProperties}
            >
              <div className="island-head">
                <span className="island-emoji" aria-hidden="true">
                  {info.emoji}
                </span>
                <div className="island-title">
                  <h2>{info.island}</h2>
                  <p>{info.desc}</p>
                </div>
              </div>

              <div className="island-rank">
                <span className="rank-stars" aria-label={`ランク ${rank.rank} / ${MAX_ISLAND_RANK}`}>
                  {Array.from({ length: MAX_ISLAND_RANK }, (_, index) => (
                    <span className={index < rank.rank ? '' : 'off'} key={index}>
                      ⭐
                    </span>
                  ))}
                </span>
                <span>
                  ランク「{rank.name}」
                  {rank.nextAt !== null ? `・あと ${rank.nextAt - clears}かい` : ''}
                </span>
              </div>

              <div className="meter thin" aria-label={`しゅうじゅくど ${mastery}%`}>
                <div className="meter-fill" style={{ width: `${mastery}%` }} />
              </div>

              <div className="island-stats">
                <span className="tag">🎯 しゅうじゅくど {mastery}%</span>
                <span className="tag">📈 おすすめ Lv.{adaptiveBySubject[subject].targetDifficulty}</span>
                <span className="tag">🚩 クリア {clears}</span>
                {dueReview > 0 ? <span className="tag alert">🔁 ふくしゅう {dueReview}</span> : null}
              </div>

              <button className="primary-btn btn-block" onClick={() => onStart(subject)}>
                この しまで あそぶ
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
