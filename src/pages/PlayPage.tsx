import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { questionMetaById } from '../data/question_meta';
import { useAppStore } from '../store/useAppStore';
import { getMisconceptionFeedback } from '../utils/misconceptions';
import { audioManager } from '../utils/audioManager';

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
  const [correctStreak, setCorrectStreak] = useState(0);
  const [comboBurst, setComboBurst] = useState(false);
  const comboTimerRef = useRef<number | null>(null);

  const progress = useMemo(() => {
    if (!mission) return { now: 0, total: 0 };
    return { now: mission.currentIndex + 1, total: mission.questions.length };
  }, [mission]);

  const comboState = useMemo(() => {
    if (correctStreak < 3) {
      return {
        nextTarget: 3,
        progress: Math.round((correctStreak / 3) * 100),
      };
    }

    const nextTarget = correctStreak % 2 === 0 ? correctStreak + 1 : correctStreak + 2;
    return {
      nextTarget,
      progress: correctStreak % 2 === 0 ? 50 : 100,
    };
  }, [correctStreak]);

  useEffect(
    () => () => {
      if (comboTimerRef.current !== null) {
        window.clearTimeout(comboTimerRef.current);
      }
    },
    [],
  );

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
      audioManager.playSfx(correct ? 'correct' : 'wrong');

      if (correct) {
        setCorrectStreak((prev) => {
          const next = prev + 1;
          const hitCombo = next >= 3 && (next - 3) % 2 === 0;
          if (hitCombo) {
            audioManager.playSfx('combo');
            setComboBurst(true);
            if (comboTimerRef.current !== null) {
              window.clearTimeout(comboTimerRef.current);
            }
            comboTimerRef.current = window.setTimeout(() => {
              setComboBurst(false);
              comboTimerRef.current = null;
            }, 650);
          }
          return next;
        });
      } else {
        setCorrectStreak(0);
        setComboBurst(false);
      }

      setFeedback({
        correct,
        message: correct ? 'せいかい！ そのちょうし！' : errorTag ? getMisconceptionFeedback(errorTag) : 'もういちど みてみよう',
      });
      return;
    }

    audioManager.playSfx('tap');
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

      <div className={`card combo-card ${correctStreak >= 3 ? 'active' : ''} ${comboBurst ? 'burst' : ''}`}>
        <p className="eyebrow">れんぞくボーナス</p>
        <h2>COMBO x{correctStreak}</h2>
        <p>
          {correctStreak >= 3
            ? `つぎのコンボまで あと ${Math.max(0, comboState.nextTarget - correctStreak)}`
            : '3れんぞく せいかいで コンボ はっせい！'}
        </p>
        <div className="combo-track">
          <div className="combo-fill" style={{ width: `${comboState.progress}%` }} />
        </div>
      </div>

      <article className="card">
        <h1>{question.prompt}</h1>
        <p>むずかしさ: {question.difficulty}</p>
        <QuestionIllustration question={question} />
        <div className="choices">
          {question.choices.map((choice, index) => (
            <button
              className={`choice-btn ${selected === index ? 'selected' : ''}`}
              key={choice}
              disabled={Boolean(feedback)}
              onClick={() => {
                audioManager.playSfx('tap');
                setSelected(index);
              }}
            >
              {choice}
            </button>
          ))}
        </div>

        <div className="inline-actions">
          <button
            className="ghost-btn"
            onClick={() => {
              audioManager.playSfx('tap');
              setShowHint((v) => !v);
            }}
          >
            ヒント
          </button>
          <button className="primary-btn" onClick={onNext} disabled={selected === null}>
            {!feedback ? 'こたえる' : progress.now === progress.total ? 'けっかへ' : 'つぎへ'}
          </button>
        </div>

        {feedback ? (
          <p className={`hint answer-feedback ${feedback.correct ? 'correct' : 'wrong'} ${comboBurst ? 'combo' : ''}`}>
            {feedback.correct ? '🎉 ' : '📝 '}
            {feedback.message}
          </p>
        ) : null}
        {showHint ? <p className="hint">💡 {question.hint}</p> : null}
      </article>
    </section>
  );
}
