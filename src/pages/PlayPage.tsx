import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QuestionIllustration } from '../components/QuestionIllustration';
import { bosses } from '../data/bosses';
import { questionMetaById } from '../data/question_meta';
import { getSkillLabel, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import { audioManager } from '../utils/audioManager';
import { hamcheeSrc } from '../utils/hamchee';
import { getMisconceptionFeedback } from '../utils/misconceptions';
import { answerLine, PRAISE_LINES } from '../data/voiceLines';
import { isSpeechSupported, speak, stopSpeaking } from '../utils/speech';

const ANSWER_KEYS = ['あ', 'い', 'う', 'え'];

type Feedback = { correct: boolean; title: string; message: string };

export function PlayPage() {
  const navigate = useNavigate();
  const mission = useAppStore((state) => state.mission);
  const comboStreak = useAppStore((state) => state.comboStreak);
  const readAloud = useAppStore((state) => state.settings.readAloud);
  const submitAnswer = useAppStore((state) => state.submitAnswer);
  const queueRetry = useAppStore((state) => state.queueRetry);
  const goNextQuestion = useAppStore((state) => state.goNextQuestion);
  const finishMission = useAppStore((state) => state.finishMission);
  const abandonMission = useAppStore((state) => state.abandonMission);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [bossAnim, setBossAnim] = useState<'hit' | 'taunt' | null>(null);
  const [poppedSlot, setPoppedSlot] = useState<number | null>(null);
  const animTimer = useRef<number | null>(null);

  const question = mission?.questions[mission.currentIndex];

  useEffect(
    () => () => {
      if (animTimer.current !== null) window.clearTimeout(animTimer.current);
      stopSpeaking();
    },
    [],
  );

  useEffect(() => {
    if (question && readAloud) speak(question.prompt);
  }, [question, readAloud]);

  const flash = (anim: 'hit' | 'taunt') => {
    setBossAnim(anim);
    if (animTimer.current !== null) window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setBossAnim(null), 650);
  };

  const onSubmitOrNext = useCallback(() => {
    if (!mission || !question || selected === null) return;
    const mainCount = mission.mainCount ?? mission.questions.length;
    const isRetry = mission.currentIndex >= mainCount;

    if (!feedback) {
      submitAnswer(selected);
      const correct = selected === question.answerIndex;
      audioManager.playSfx(correct ? 'correct' : 'wrong');

      if (correct) {
        const streak = useAppStore.getState().comboStreak;
        if (streak >= 3 && (streak - 3) % 2 === 0) audioManager.playSfx('combo');
        if (mission.kind === 'boss') flash('hit');
        if (!isRetry) setPoppedSlot(mission.currentIndex);
        const title = PRAISE_LINES[(mission.currentIndex + streak) % PRAISE_LINES.length];
        setFeedback({
          correct: true,
          title: `🎉 ${title}`,
          message: streak >= 3 ? `🔥 ${streak}もん れんぞく せいかい！` : isRetry ? 'こんどは できたね！' : 'その ちょうし！',
        });
        if (readAloud) speak(title);
      } else {
        if (!isRetry) queueRetry();
        if (mission.kind === 'boss') flash('taunt');
        const answer = question.choices[question.answerIndex];
        const errorTag = questionMetaById[question.id]?.wrongChoiceTags?.[selected];
        setFeedback({
          correct: false,
          title: `こたえは「${answer}」`,
          message: `${errorTag ? getMisconceptionFeedback(errorTag) : 'もういちど みてみよう'}${isRetry ? '' : '。あとで もう1かい でるよ！'}`,
        });
        if (readAloud) speak(answerLine(answer));
      }
      return;
    }

    audioManager.playSfx('tap');
    setSelected(null);
    setFeedback(null);
    setShowHint(false);
    setPoppedSlot(null);
    const latest = useAppStore.getState().mission;
    if (!latest || latest.currentIndex >= latest.questions.length - 1) {
      stopSpeaking();
      finishMission();
      navigate('/result');
      return;
    }
    goNextQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feedback, finishMission, goNextQuestion, mission, navigate, question, queueRetry, readAloud, selected, submitAnswer]);

  useEffect(() => {
    if (!question) return;
    const onKey = (event: KeyboardEvent) => {
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
      <div className="screen">
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <h1>ミッションが ないよ</h1>
          <Link className="btn btn-primary" to="/">
            マップへ もどる
          </Link>
        </div>
      </div>
    );
  }

  const info = subjectInfo[mission.subject];
  const kind = mission.kind ?? 'adaptive';
  const mainCount = mission.mainCount ?? mission.questions.length;
  const isRetry = mission.currentIndex >= mainCount;
  const answeredCount = mission.answers.filter((answer) => answer !== undefined).length;
  const hits = mission.questions.reduce((sum, item, index) => sum + (mission.answers[index] === item.answerIndex ? 1 : 0), 0);
  const mainCorrect = (index: number) => mission.answers[index] !== undefined && mission.answers[index] === mission.questions[index].answerIndex;
  const boss = bosses[mission.subject];
  const hp = Math.max(0, mainCount - hits);
  const progress = Math.min(1, answeredCount / mission.questions.length);
  const tiles = question.choices.length === 3 && question.choices.every((choice) => [...choice].length <= 4);

  const onQuit = () => {
    if (!window.confirm('ぼうけんを やめる？ ここまでの きろくは のこらないよ。')) return;
    stopSpeaking();
    const back = mission.skillId ? `/island/${mission.subject}` : '/';
    abandonMission();
    navigate(back);
  };

  const answerState = (index: number): string => {
    if (!feedback) return selected === index ? 'selected' : '';
    if (index === question.answerIndex) return 'correct';
    if (index === selected) return 'wrong';
    return 'dim';
  };

  return (
    <div className="screen">
      <div className="play-top">
        <button className="round-btn ghost" onClick={onQuit} aria-label="やめる">
          ✕
        </button>
        <div
          className="play-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={mission.questions.length}
          aria-valuenow={answeredCount}
          aria-label="すすみぐあい"
        >
          <div className={`play-bar-fill ${isRetry ? 'retry' : ''}`} style={{ width: `${progress * 100}%` }} />
        </div>
        {comboStreak >= 3 ? <span className="pill">🔥{comboStreak}</span> : null}
      </div>

      {kind === 'boss' ? (
        <div className="boss-arena" aria-live="polite">
          <span className={`boss-sprite ${hp === 0 ? 'down' : bossAnim ?? ''}`} aria-hidden="true">
            {boss.sprite}
            {bossAnim === 'hit' ? <span className="boss-damage">💗</span> : null}
          </span>
          <div className="boss-info">
            <span className="boss-name">
              {boss.name}
              {bossAnim === 'taunt' ? ` 「${boss.taunt}」` : hp === 0 ? ` 「${boss.befriend}」` : ''}
            </span>
            <span className="friend-hearts" aria-label={`なかよし ハート ${mainCount - hp} / ${mainCount}`}>
              {Array.from({ length: mainCount }, (_, index) => (
                <span className={index < mainCount - hp ? '' : 'off'} key={index}>
                  💗
                </span>
              ))}
            </span>
          </div>
        </div>
      ) : (
        <div className="star-meter">
          <span style={{ fontSize: '0.9rem' }}>
            {info.emoji} {mission.skillId ? getSkillLabel(mission.skillId) : `${info.label} おまかせ`}
          </span>
          <span className="star-slots" aria-label="あつめた ほし">
            {Array.from({ length: mainCount }, (_, index) => (
              <span className={`${mainCorrect(index) ? '' : 'off'} ${poppedSlot === index ? 'pop' : ''}`} key={index}>
                ⭐
              </span>
            ))}
          </span>
        </div>
      )}

      <article className="panel question-panel">
        {isRetry ? <span className="retry-tag">🔁 もういちど チャレンジ</span> : null}
        <div className="question-head">
          <h1 className="question-text">{question.prompt}</h1>
          {isSpeechSupported() ? (
            <button className="round-btn" onClick={() => speak(question.prompt)} aria-label="もんだいを よみあげる">
              🔊
            </button>
          ) : null}
        </div>
        <QuestionIllustration question={question} />
      </article>

      <div className={`answers ${tiles ? 'tiles' : ''}`} role="group" aria-label="こたえ">
        {question.choices.map((choice, index) => (
          <button
            aria-pressed={selected === index}
            className={`answer ${answerState(index)}`}
            disabled={Boolean(feedback)}
            key={`${mission.currentIndex}-${index}`}
            onClick={() => {
              audioManager.playSfx('tap');
              setSelected(index);
            }}
          >
            <span className="answer-key" aria-hidden="true">
              {ANSWER_KEYS[index]}
            </span>
            <span>{choice}</span>
          </button>
        ))}
      </div>

      {showHint && !feedback ? <p className="hint-box">💡 {question.hint}</p> : null}

      {feedback ? (
        <>
          <div className="sheet-spacer" />
          <div className={`feedback-sheet ${feedback.correct ? 'good' : 'bad'}`} role="status">
            <div className="feedback-head">
              <img src={hamcheeSrc(feedback.correct ? 'cheer' : 'normal')} alt="" width={72} height={72} />
              <div>
                <p className="feedback-title">{feedback.title}</p>
                <p className="feedback-text">{feedback.message}</p>
                {!feedback.correct ? <p className="feedback-text">💡 {question.hint}</p> : null}
              </div>
            </div>
            <button className={`btn btn-xl btn-block ${feedback.correct ? 'btn-mint' : 'btn-star'}`} onClick={onSubmitOrNext} autoFocus>
              つぎへ ›
            </button>
          </div>
        </>
      ) : (
        <div className="play-actions">
          <button
            className="btn btn-cream"
            onClick={() => {
              audioManager.playSfx('tap');
              setShowHint((value) => !value);
            }}
            aria-pressed={showHint}
          >
            💡
          </button>
          <button className="btn btn-primary btn-xl" onClick={onSubmitOrNext} disabled={selected === null}>
            こたえる
          </button>
        </div>
      )}
    </div>
  );
}
