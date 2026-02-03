import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function PlayPage() {
  const navigate = useNavigate();
  const mission = useAppStore((state) => state.mission);
  const submitAnswer = useAppStore((state) => state.submitAnswer);
  const goNextQuestion = useAppStore((state) => state.goNextQuestion);
  const finishMission = useAppStore((state) => state.finishMission);
  const [selected, setSelected] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);

  const progress = useMemo(() => {
    if (!mission) return { now: 0, total: 0 };
    return { now: mission.currentIndex + 1, total: mission.questions.length };
  }, [mission]);

  if (!mission) {
    return (
      <section className="card">
        <h1>ミッションがありません</h1>
        <p>ミッションをえらんでから はじめよう！</p>
        <Link className="primary-btn" to="/mission">
          ミッションへ
        </Link>
      </section>
    );
  }

  const question = mission.questions[mission.currentIndex];

  const onNext = () => {
    if (selected === null) return;
    submitAnswer(selected);
    setShowHint(false);
    setSelected(null);

    const isLast = mission.currentIndex >= mission.questions.length - 1;
    if (isLast) {
      finishMission();
      navigate('/result');
      return;
    }

    goNextQuestion();
  };

  return (
    <section className="stack">
      <div className="card">
        <p>
          しんこう: {progress.now}/{progress.total}
        </p>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(progress.now / progress.total) * 100}%` }} />
        </div>
      </div>

      <article className="card">
        <h1>{question.prompt}</h1>
        <div className="choices">
          {question.choices.map((choice, index) => (
            <button
              className={`choice-btn ${selected === index ? 'selected' : ''}`}
              key={choice}
              onClick={() => setSelected(index)}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="inline-actions">
          <button className="ghost-btn" onClick={() => setShowHint((v) => !v)}>
            ヒント
          </button>
          <button className="primary-btn" onClick={onNext} disabled={selected === null}>
            {progress.now === progress.total ? 'けっかへ' : 'つぎへ'}
          </button>
        </div>

        {showHint ? <p className="hint">💡 {question.hint}</p> : null}
      </article>
    </section>
  );
}
