import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { questionMetaById } from '../data/question_meta';
import { useAppStore } from '../store/useAppStore';
import { getMisconceptionFeedback } from '../utils/misconceptions';

const modeLabel = {
  learn: 'まなび',
  review: 'ふくしゅう',
  challenge: 'チャレンジ',
} as const;

export function PlayPage() {
  const navigate = useNavigate();
  const mission = useAppStore((state) => state.mission);
  const submitAnswer = useAppStore((state) => state.submitAnswer);
  const goNextQuestion = useAppStore((state) => state.goNextQuestion);
  const finishMission = useAppStore((state) => state.finishMission);
  const [selected, setSelected] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; message: string } | null>(null);

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
    if (!feedback) {
      submitAnswer(selected);
      const correct = selected === question.answerIndex;
      const errorTag = questionMetaById[question.id]?.wrongChoiceTags?.[selected];
      setFeedback({
        correct,
        message: correct ? 'せいかい！ そのちょうし！' : errorTag ? getMisconceptionFeedback(errorTag) : 'もういちど みてみよう',
      });
      return;
    }

    const isLast = mission.currentIndex >= mission.questions.length - 1;
    setShowHint(false);
    setSelected(null);
    setFeedback(null);
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
        <p>
          モード: {modeLabel[mission.plan.mode]} / ねらいレベル: {mission.plan.targetDifficulty}
        </p>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(progress.now / progress.total) * 100}%` }} />
        </div>
      </div>

      <article className="card">
        <h1>{question.prompt}</h1>
        <p>むずかしさ: {question.difficulty}</p>
        <div className="choices">
          {question.choices.map((choice, index) => (
            <button
              className={`choice-btn ${selected === index ? 'selected' : ''}`}
              key={choice}
              disabled={Boolean(feedback)}
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
            {!feedback ? 'こたえる' : progress.now === progress.total ? 'けっかへ' : 'つぎへ'}
          </button>
        </div>

        {feedback ? <p className="hint">{feedback.correct ? '🎉 ' : '📝 '}{feedback.message}</p> : null}
        {showHint ? <p className="hint">💡 {question.hint}</p> : null}
      </article>
    </section>
  );
}
