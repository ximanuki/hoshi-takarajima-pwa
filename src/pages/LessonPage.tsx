import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { findStage } from '../data/islandPaths';
import { getLesson } from '../data/lessons';
import { getSkillLabel, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';
import { hamcheeSrc } from '../utils/hamchee';
import { skillQuestions } from '../utils/practice';
import { isSpeechSupported, speak, stopSpeaking } from '../utils/speech';

type Card =
  | { type: 'goal' }
  | { type: 'step'; text: string; visual?: string }
  | { type: 'example' }
  | { type: 'tip' }
  | { type: 'quiz' }
  | { type: 'done' };

const ANSWER_KEYS = ['あ', 'い', 'う'];

export function LessonPage() {
  const { skillId = '' } = useParams();
  const navigate = useNavigate();
  const readAloud = useAppStore((state) => state.settings.readAloud);
  const completeLesson = useAppStore((state) => state.completeLesson);
  const startMission = useAppStore((state) => state.startMission);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [quizPick, setQuizPick] = useState<number | null>(null);
  const completedRef = useRef(false);

  const lesson = getLesson(skillId);
  const found = findStage(skillId);

  const quiz = useMemo(() => {
    const pool = skillQuestions(skillId);
    if (pool.length === 0) return undefined;
    const minDifficulty = Math.min(...pool.map((question) => question.difficulty));
    const easiest = pool.filter((question) => question.difficulty === minDifficulty);
    return easiest[Math.floor(Math.random() * easiest.length)];
  }, [skillId]);

  const cards = useMemo<Card[]>(() => {
    if (!lesson) return [];
    return [
      { type: 'goal' },
      ...lesson.steps.map((step) => ({ type: 'step' as const, ...step })),
      { type: 'example' },
      { type: 'tip' },
      ...(quiz ? [{ type: 'quiz' as const }] : []),
      { type: 'done' },
    ];
  }, [lesson, quiz]);

  const card = cards[index];

  const speechFor = (target: Card | undefined): string => {
    if (!lesson || !target) return '';
    switch (target.type) {
      case 'goal':
        return `きょうの めあて。${lesson.goal}`;
      case 'step':
        return target.text;
      case 'example':
        return `れいだい。${lesson.example.question}`;
      case 'tip':
        return `コツ。${lesson.tip}`;
      case 'quiz':
        return quiz ? `ミニクイズ。${quiz.prompt}` : '';
      case 'done':
        return 'レッスン クリア！ よく がんばったね！';
    }
  };

  useEffect(() => {
    if (!readAloud) return;
    const text = speechFor(card);
    if (text) speak(text);
    // card が かわった ときだけ よむ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, readAloud]);

  useEffect(() => () => stopSpeaking(), []);

  if (!lesson || !found || !card) return <Navigate to="/" replace />;

  const quizCorrect = quiz !== undefined && quizPick === quiz.answerIndex;
  const canAdvance = card.type !== 'quiz' || quizPick !== null;

  const goNext = () => {
    audioManager.playSfx('tap');
    const nextIndex = Math.min(index + 1, cards.length - 1);
    if (cards[nextIndex]?.type === 'done' && !completedRef.current) {
      completedRef.current = true;
      completeLesson(skillId, quizCorrect);
      audioManager.playSfx('clear');
    }
    setRevealed(false);
    setIndex(nextIndex);
  };

  const onClose = () => {
    stopSpeaking();
    navigate(`/island/${found.subject}`);
  };

  const onPractice = () => {
    audioManager.playSfx('tap');
    stopSpeaking();
    startMission(found.subject, { skillId, kind: 'practice' });
    navigate('/play');
  };

  return (
    <div className="screen">
      <div className="lesson-top">
        <button className="round-btn ghost" onClick={onClose} aria-label="レッスンを とじる">
          ✕
        </button>
        <div className="segments" aria-label={`${index + 1} / ${cards.length}`}>
          {cards.map((_, cardIndex) => (
            <span className={cardIndex <= index ? 'on' : ''} key={cardIndex} />
          ))}
        </div>
      </div>

      <p className="muted on-night" style={{ textAlign: 'center' }}>
        {subjectInfo[found.subject].emoji} {getSkillLabel(skillId)} の レッスン
      </p>

      <article className="panel lesson-card" key={index}>
        {card.type === 'goal' ? (
          <>
            <img className="lesson-mascot" src={hamcheeSrc('cheer')} alt="" width={96} height={96} />
            <span className="lesson-kicker">きょうの めあて</span>
            <p className="lesson-text">{lesson.goal}</p>
          </>
        ) : null}

        {card.type === 'step' ? (
          <>
            <p className="lesson-text">{card.text}</p>
            {card.visual ? <div className="lesson-visual">{card.visual}</div> : null}
          </>
        ) : null}

        {card.type === 'example' ? (
          <>
            <span className="lesson-kicker">れいだい</span>
            <p className="lesson-text">{lesson.example.question}</p>
            {revealed ? (
              <div className="lesson-reveal">
                <strong>{lesson.example.answer}</strong>
                <span>{lesson.example.why}</span>
              </div>
            ) : (
              <button
                className="btn btn-star"
                onClick={() => {
                  audioManager.playSfx('tap');
                  setRevealed(true);
                  if (readAloud) speak(`こたえは ${lesson.example.answer}。${lesson.example.why}`);
                }}
              >
                👀 こたえを みる
              </button>
            )}
          </>
        ) : null}

        {card.type === 'tip' ? (
          <>
            <img className="lesson-mascot" src={hamcheeSrc('happy')} alt="" width={96} height={96} />
            <span className="lesson-kicker">はむちーの コツ</span>
            <p className="lesson-text">{lesson.tip}</p>
          </>
        ) : null}

        {card.type === 'quiz' && quiz ? (
          <>
            <span className="lesson-kicker">ミニクイズ</span>
            <p className="lesson-text">{quiz.prompt}</p>
            <QuestionIllustration question={quiz} />
            <div className="answers">
              {quiz.choices.map((choice, choiceIndex) => {
                const state =
                  quizPick === null ? '' : choiceIndex === quiz.answerIndex ? 'correct' : choiceIndex === quizPick ? 'wrong' : 'dim';
                return (
                  <button
                    className={`answer ${state}`}
                    disabled={quizPick !== null}
                    key={choiceIndex}
                    onClick={() => {
                      setQuizPick(choiceIndex);
                      const ok = choiceIndex === quiz.answerIndex;
                      audioManager.playSfx(ok ? 'correct' : 'wrong');
                      if (readAloud) speak(ok ? 'せいかい！' : `おしい！ こたえは ${quiz.choices[quiz.answerIndex]}`);
                    }}
                  >
                    <span className="answer-key">{ANSWER_KEYS[choiceIndex]}</span>
                    <span>{choice}</span>
                  </button>
                );
              })}
            </div>
            {quizPick !== null ? (
              <p className="lesson-reveal">{quizCorrect ? '🎉 せいかい！ ばっちりだね！' : `📝 こたえは「${quiz.choices[quiz.answerIndex]}」。${quiz.hint}`}</p>
            ) : null}
          </>
        ) : null}

        {card.type === 'done' ? (
          <>
            <img className="lesson-mascot" src={hamcheeSrc('cheer')} alt="" width={120} height={120} style={{ width: 120 }} />
            <span className="lesson-kicker">レッスン クリア！</span>
            <p className="lesson-text">つぎは れんしゅうで ためしてみよう！</p>
          </>
        ) : null}
      </article>

      {card.type === 'done' ? (
        <div className="stack" style={{ display: 'grid', gap: 10 }}>
          <button className="btn btn-primary btn-xl btn-block" onClick={onPractice}>
            ⚔️ れんしゅうへ
          </button>
          <button className="btn btn-cream btn-block" onClick={onClose}>
            みちに もどる
          </button>
        </div>
      ) : (
        <div className="lesson-footer">
          {isSpeechSupported() ? (
            <button className="round-btn" style={{ width: 60, height: 60 }} onClick={() => speak(speechFor(card))} aria-label="もういちど きく">
              🔊
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary btn-xl" onClick={goNext} disabled={!canAdvance}>
            つぎへ ›
          </button>
        </div>
      )}
    </div>
  );
}
