import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { hamcheeSrc } from '../utils/hamchee';
import { questionMetaById } from '../data/question_meta';
import { getSkillLabel, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { getMisconceptionFeedback } from '../utils/misconceptions';
import { audioManager } from '../utils/audioManager';
import { isSpeechSupported, speak, stopSpeaking } from '../utils/speech';

const modeLabel = {
  learn: 'まなび',
  review: 'ふくしゅう',
  challenge: 'チャレンジ',
} as const;

const CHOICE_MARKERS = ['あ', 'い', 'う', 'え'];

const correctMessages = ['せいかい！ そのちょうし！', 'すごい！ ばっちり！', 'やったね！ さすが！', 'おみごと！', 'ナイス！ いいね！'];

function isComboMilestone(streak: number): boolean {
  return streak >= 3 && (streak - 3) % 2 === 0;
}

export function PlayPage() {
  const navigate = useNavigate();
  const mission = useAppStore((state) => state.mission);
  const comboStreak = useAppStore((state) => state.comboStreak);
  const readAloud = useAppStore((state) => state.settings.readAloud);
  const submitAnswer = useAppStore((state) => state.submitAnswer);
  const goNextQuestion = useAppStore((state) => state.goNextQuestion);
  const finishMission = useAppStore((state) => state.finishMission);
  const abandonMission = useAppStore((state) => state.abandonMission);
  const [selected, setSelected] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; title: string; message: string } | null>(null);
  const [comboBurst, setComboBurst] = useState(false);
  const comboTimerRef = useRef<number | null>(null);
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const question = mission?.questions[mission.currentIndex];

  useEffect(
    () => () => {
      if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
      stopSpeaking();
    },
    [],
  );

  useEffect(() => {
    if (!question || !readAloud) return;
    speak(question.prompt);
  }, [question, readAloud]);

  useEffect(() => {
    if (feedback) feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [feedback]);

  const onSubmitOrNext = useCallback(() => {
    if (!mission || !question || selected === null) return;

    if (!feedback) {
      submitAnswer(selected);
      const correct = selected === question.answerIndex;
      const errorTag = questionMetaById[question.id]?.wrongChoiceTags?.[selected];
      audioManager.playSfx(correct ? 'correct' : 'wrong');

      if (correct) {
        const streak = useAppStore.getState().comboStreak;
        if (isComboMilestone(streak)) {
          audioManager.playSfx('combo');
          setComboBurst(true);
          if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
          comboTimerRef.current = window.setTimeout(() => {
            setComboBurst(false);
            comboTimerRef.current = null;
          }, 650);
        }
        const title = correctMessages[(mission.currentIndex + streak) % correctMessages.length];
        setFeedback({ correct: true, title, message: streak >= 3 ? `${streak}もん れんぞく せいかい！` : 'つぎも この ちょうしで いこう！' });
        if (readAloud) speak(title);
      } else {
        setComboBurst(false);
        const answer = question.choices[question.answerIndex];
        setFeedback({
          correct: false,
          title: `こたえは「${answer}」`,
          message: errorTag ? getMisconceptionFeedback(errorTag) : 'もういちど みてみよう',
        });
        if (readAloud) speak(`こたえは ${answer}`);
      }
      return;
    }

    audioManager.playSfx('tap');
    const isLast = mission.currentIndex >= mission.questions.length - 1;
    setShowHint(false);
    setSelected(null);
    setFeedback(null);
    if (isLast) {
      stopSpeaking();
      finishMission();
      navigate('/result');
      return;
    }

    goNextQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feedback, finishMission, goNextQuestion, mission, navigate, question, readAloud, selected, submitAnswer]);

  useEffect(() => {
    if (!question) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      const index = Number(event.key) - 1;
      if (!feedback && Number.isInteger(index) && index >= 0 && index < question.choices.length) {
        audioManager.playSfx('tap');
        setSelected(index);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        onSubmitOrNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback, onSubmitOrNext, question]);

  if (!mission || !question) {
    return (
      <section className="card stack">
        <h1>ミッションが ありません</h1>
        <p className="muted">しまを えらんでから はじめよう！</p>
        <Link className="primary-btn" to="/mission">
          ぼうけんマップへ
        </Link>
      </section>
    );
  }

  const onQuit = () => {
    if (!window.confirm('ミッションを やめる？ ここまでの きろくは のこらないよ。')) return;
    stopSpeaking();
    abandonMission();
    navigate('/mission');
  };

  const info = subjectInfo[mission.subject];
  const answeredCorrect = (index: number) => {
    const answer = mission.answers[index];
    if (answer === undefined) return null;
    return answer === mission.questions[index].answerIndex;
  };

  const choiceState = (index: number): string => {
    if (!feedback) return selected === index ? 'selected' : '';
    if (index === question.answerIndex) return 'correct';
    if (index === selected) return 'wrong';
    return 'dim';
  };

  return (
    <section className="stack">
      <div className="play-header">
        <button className="icon-btn" onClick={onQuit} aria-label="ミッションを やめる">
          ✕
        </button>
        <div
          className="play-progress"
          role="progressbar"
          aria-label="しんこう"
          aria-valuemin={0}
          aria-valuemax={mission.questions.length}
          aria-valuenow={mission.currentIndex + 1}
        >
          {mission.questions.map((item, index) => {
            const result = answeredCorrect(index);
            const state = result === null ? (index === mission.currentIndex ? 'current' : '') : result ? 'correct' : 'wrong';
            return <span className={`play-progress-dot ${state}`} key={item.id} />;
          })}
        </div>
      </div>

      <div className="play-meta">
        <span className="tag" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          {info.emoji} {getSkillLabel(question.skillId)} ・ {modeLabel[mission.plan.mode]}
        </span>
        <span className={`combo-chip ${comboStreak >= 3 ? 'hot' : ''} ${comboBurst ? 'burst' : ''}`} aria-live="polite">
          {comboStreak >= 3 ? '🔥' : '⚡'} コンボ {comboStreak}
        </span>
      </div>

      <article className="card question-card">
        <div className="question-top">
          <h1 className="question-prompt">{question.prompt}</h1>
          {isSpeechSupported() ? (
            <button className="icon-btn" onClick={() => speak(question.prompt)} aria-label="もんだいを よみあげる">
              🔊
            </button>
          ) : null}
        </div>
        <p className="difficulty-dots" aria-label={`むずかしさ ${question.difficulty}`}>
          {'★'.repeat(question.difficulty)}
          <span style={{ opacity: 0.25 }}>{'★'.repeat(Math.max(0, 5 - question.difficulty))}</span>
        </p>

        <QuestionIllustration question={question} />

        <div className={`choices ${question.choices.every((choice) => choice.length <= 8) ? 'three' : ''}`} role="group" aria-label="こたえの せんたくし">
          {question.choices.map((choice, index) => {
            const state = choiceState(index);
            return (
              <button
                className={`choice-btn ${state}`}
                key={`${question.id}-${index}`}
                disabled={Boolean(feedback)}
                aria-pressed={selected === index}
                onClick={() => {
                  audioManager.playSfx('tap');
                  setSelected(index);
                }}
                style={{ position: 'relative' }}
              >
                <span className="choice-marker" aria-hidden="true">
                  {CHOICE_MARKERS[index]}
                </span>
                <span>{choice}</span>
                <span className="choice-result" aria-hidden="true">
                  {state === 'correct' ? '⭕' : state === 'wrong' ? '❌' : ''}
                </span>
              </button>
            );
          })}
        </div>

        {feedback ? (
          <div className={`feedback-panel ${feedback.correct ? 'correct' : 'wrong'}`} ref={feedbackRef} role="status">
            <img src={hamcheeSrc(feedback.correct ? 'cheer' : 'normal')} alt="" width={64} height={64} />
            <div>
              <p className="feedback-title">
                {feedback.correct ? '🎉 ' : '📝 '}
                {feedback.title}
              </p>
              <p className="feedback-text">{feedback.message}</p>
            </div>
          </div>
        ) : null}

        {showHint || (feedback && !feedback.correct) ? <p className="hint">💡 {question.hint}</p> : null}
      </article>

      <div className="play-footer">
        <button
          className="ghost-btn"
          onClick={() => {
            audioManager.playSfx('tap');
            setShowHint((value) => !value);
          }}
          disabled={Boolean(feedback)}
          aria-pressed={showHint}
        >
          💡 ヒント
        </button>
        <button className={feedback ? 'gold-btn' : 'primary-btn'} onClick={onSubmitOrNext} disabled={selected === null}>
          {!feedback ? 'こたえる' : mission.currentIndex + 1 === mission.questions.length ? 'けっかを みる' : 'つぎへ ›'}
        </button>
      </div>
      <p className="visually-hidden">{info.island}</p>
    </section>
  );
}
