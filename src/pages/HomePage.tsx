import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DailyQuestCard } from '../components/DailyQuestCard';
import { hamcheeSrc } from '../utils/hamchee';
import type { PokoMood } from '../utils/hamchee';
import { SUBJECTS, subjectInfo } from '../data/subjects';
import { useAppStore } from '../store/useAppStore';
import type { Subject } from '../types';
import { audioManager } from '../utils/audioManager';
import { getDueReviewCount } from '../utils/mission';
import { getLevelTitle, levelProgress } from '../utils/progression';
import { isSpeechSupported, speak } from '../utils/speech';
type DayPart = 'morning' | 'daytime' | 'night';
type PerformanceBand = 'no_data' | 'excellent' | 'good' | 'retry';

const dayPartOpeners: Record<DayPart, string[]> = {
  morning: [
    'おはよう！ あさの ひととき、はむちー と ぼうけんしよう。',
    'おはようございます！ きょうも ちいさな いっぽ から。',
    'おはよう〜！ あたまが すっきり してる じかんだね。',
    'おはよう！ あさは ひらめき が うまれやすいよ。',
    'おはよう！ きょうの たからさがし、いっしょに いくよ。',
    'おはよう！ ひとつ やるだけで きょうが すすむよ。',
    'おはよう！ はむちー、まるっと じゅんび かんりょう！',
    'おはよう！ まずは かるく 1ミッション から はじめよう。',
  ],
  daytime: [
    'こんにちは！ いまの ペース、いい かんじ。',
    'こんにちは〜！ ひとやすみ がてら 1もん どう？',
    'こんにちは！ ここで ひとつ すすめると きもちいいよ。',
    'こんにちは！ はむちー と ちょこっと れんしゅう しよう。',
    'こんにちは！ つみかさねると ぐんぐん のびるね。',
    'こんにちは！ いまの タイミング、やるき スイッチ に ぴったり。',
    'こんにちは！ きょうの ほし、まだ ふやせるよ。',
    'こんにちは！ いっしょに つぎの ステップ へ いこう。',
  ],
  night: [
    'こんばんは！ よるの しずかな じかん、しゅうちゅう しやすいね。',
    'こんばんは〜！ ねるまえに ちょこっと ぼうけん しよう。',
    'こんばんは！ きょうの しめくくり に 1ミッション どう？',
    'こんばんは！ はむちー と ゆったり ふくしゅう しよう。',
    'こんばんは！ きょうの がんばり を もうひとつ。',
    'こんばんは！ すこしだけ すすめる のも だいせいこう だよ。',
    'こんばんは！ よるの ひらめき も だいじな たから。',
    'こんばんは！ あしたに つながる いっぽ を つくろう。',
  ],
};

const performanceSegments: Record<
  PerformanceBand,
  { tone: string[]; actions: string[]; closers: string[] }
> = {
  no_data: {
    tone: [
      'さいしょの 1もん が いちばん だいじ！',
      'スタート できたら もう かち だよ。',
      'はじめる きもち、すごく すてき！',
      'きょうの いっぽ が あしたの じしん になるよ。',
      'いまから でも ぜんぜん おそくないよ。',
      'ためしに 1もん、きっと いい ながれに なるよ。',
      'はむちーは いつでも スタート を おうえん！',
      'ちいさく はじめる のが いちばん つよいよ。',
    ],
    actions: [
      'まずは かんたんな ミッション を ひとつ えらぼう。',
      'すきな しまから かるく すすんでみよう。',
      'タイマーなしで のんびり 1セット いこう。',
      'ヒントを つかいながら きがるに ためそう。',
      'とくいな もんだい から きもちよく はじめよう。',
      'こたえたら すぐ つぎへ、テンポよく いこう。',
      'きょうは ウォームアップ だけでも じゅうぶん。',
      'はむちー と 1もん ずつ ていねいに すすめよう。',
    ],
    closers: [
      'いっしょに たのしく いこうね！',
      'きょうの ほし、ぜったい ふやせるよ！',
      'ゆっくり でも しっかり すすんでるよ！',
      'はむちー が ずっと となりで みまもるよ。',
      'だいじなのは つづけること、いこう！',
      'それじゃ さっそく スタート！',
      'きょうも いいひ に しよう！',
      'まずは ひとつ、やってみよう！',
    ],
  },
  excellent: {
    tone: [
      'すごい！ キラキラ せいとうりつ だね！',
      'ぜっこうちょう！ ばっちり きまってる！',
      'おみごと！ のりに のってるね！',
      'さいこう！ さすがの しゅうちゅうりょく！',
      'しっかり つみあがってる、ほんとに すごい！',
      'はむちー びっくりの ハイスコア！',
      'きょうの きみ、めちゃくちゃ つよい！',
      'いいリズム！ この まま のばせるよ！',
    ],
    actions: [
      'つぎは ちょい むず を 1セット ためしてみよう。',
      'この いきおいで もう 1ミッション いけそう！',
      'チャレンジもーどで ほしを ねらおう。',
      'にがて しま を 1つ せめると さらに つよくなるよ。',
      'テンポそのままに つぎへ すすもう。',
      'ふくしゅう を さっと かたづけて コンボを つなごう。',
      'いまの しゅうちゅうで もうひと のび いこう。',
      'ごほうびかんかく で もう ひとつ だけ どう？',
    ],
    closers: [
      'この いきおい、さいこう！',
      'きらっと つぎも クリアしよう！',
      'はむちー だいこうふん！',
      'そのちょうしで ほしを あつめよう！',
      'いいながれ、まだまだ つづくよ！',
      'いまの きれあじ すてき！',
      'つぎも きっと いける！',
      'よし、もう ひとふんばり！',
    ],
  },
  good: {
    tone: [
      'いいね！ しっかり すすんでるよ。',
      'とっても じゅんちょう！',
      'いいペース！ そのまま いこう。',
      'ちゃんと ちから が ついてきてるね。',
      'ナイス！ あとちょっとで もっと のびる！',
      'きょうも かくじつに せいちょうちゅう！',
      'じゅうぶん いい てごたえ だよ！',
      'はむちー うれしくて ほっぺ ぷくぷく！',
    ],
    actions: [
      'つぎは ふくしゅう を 1セット やってみよう。',
      'ヒントを ひとつ つかって せいど を あげよう。',
      'ていねいに よみなおして 1もんずつ いこう。',
      'とくい しま と にがて しま を 1つずつ ためそう。',
      'こたえるまえに 3びょう かくにん してみよう。',
      'きょうは しつを だいじに すすめよう。',
      'つぎの ミッションで きろく こうしん ねらえるよ。',
      'いいながれ だから もう ひとつ いってみよう。',
    ],
    closers: [
      'コツコツが いちばん つよい！',
      'いまの ちょうしで ばっちり！',
      'はむちー が いっぱい ほめたい！',
      'じぶんの ペースで いこうね。',
      'きょうの がんばり、ちゃんと たまってるよ！',
      'つぎで さらに きらり と ひかるよ！',
      'このまま いけば だいじょうぶ！',
      'さあ、つぎへ いこう！',
    ],
  },
  retry: {
    tone: [
      'だいじょうぶ、まちがいは せいちょうの タネ！',
      'うまく いかない ときも ちゃんと すすんでるよ。',
      'いまは ならしてる ところ、ぜんぜん OK！',
      'つまずきは レベルアップの まえぶれ だよ。',
      'あせらなくて だいじょうぶ、いっしょに いこう。',
      'むずかしいのに ちょうせん してるの えらい！',
      'いまは ためどき、つぎで きっと ひらくよ。',
      'はむちー は いつでも みかただよ。',
    ],
    actions: [
      'つぎは かんたん むずかしさで じしん を もどそう。',
      'ヒントを つかって 1もん ていねいに やってみよう。',
      'にがて な ところだけ 2もん しぼって れんしゅう しよう。',
      'こたえの りゆう を こえに だして かくにんしよう。',
      'いったん ひとやすみして ふくしゅう から いこう。',
      'せいかいより かんがえること を だいじに いこう。',
      'まずは 1もん クリア を めざそう。',
      'つぎの 1かい を かるく ためしてみよう。',
    ],
    closers: [
      'いっぽずつ ぜったい つよくなるよ。',
      'きょうの がんばり、ちゃんと みえてるよ。',
      'だいじょうぶ、はむちー と いっしょ！',
      'つぎは きっと もっと うまくいく！',
      'あせらず いこう、いい かんじだよ。',
      'できるところから つみあげよう！',
      'きょうも じゅうぶん すばらしい！',
      'いまの がんばりが たからもの！',
    ],
  },
};

function pickBySeed<T>(items: T[], seed: number): T {
  return items[seed % items.length];
}

function mixSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt + 17, 2654435761)) >>> 0;
}

function getDayPart(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour <= 10) return 'morning';
  if (hour >= 11 && hour <= 17) return 'daytime';
  return 'night';
}

function getPerformanceBand(accuracy: number | null): PerformanceBand {
  if (accuracy === null) return 'no_data';
  if (accuracy >= 0.9) return 'excellent';
  if (accuracy >= 0.7) return 'good';
  return 'retry';
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getTimeSlotSeed(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const quarter = Math.floor(date.getMinutes() / 15);
  return y * 1000000 + m * 10000 + d * 100 + h * 4 + quarter;
}

function createSessionSeed(): number {
  if (typeof globalThis !== 'undefined' && 'crypto' in globalThis && typeof globalThis.crypto?.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0];
  }
  return 7919;
}

function buildMoodPool(dayPart: DayPart, band: PerformanceBand): PokoMood[] {
  if (band === 'excellent') return dayPart === 'night' ? ['cheer', 'happy', 'sleepy', 'sleepy', 'normal'] : ['cheer', 'cheer', 'happy', 'normal', 'sleepy'];
  if (band === 'good') return dayPart === 'night' ? ['happy', 'normal', 'sleepy', 'sleepy', 'cheer'] : ['happy', 'happy', 'normal', 'cheer', 'sleepy'];
  if (band === 'retry') return dayPart === 'night' ? ['sleepy', 'sleepy', 'normal', 'happy', 'cheer'] : ['normal', 'happy', 'sleepy', 'sleepy', 'cheer'];
  return dayPart === 'night' ? ['sleepy', 'sleepy', 'normal', 'happy', 'cheer'] : ['happy', 'normal', 'cheer', 'sleepy', 'sleepy'];
}

const SESSION_RANDOM_SEED = createSessionSeed();
const sleepySuffixes = [
  'はむちー、ねむねむ だけど おうえんは ぜんりょく！',
  'ちょっと まぶたが おもいけど きみの ちからは しんじてるよ。',
  'すやっと モードでも いっしょに こつこつ すすもうね。',
  'ねむたい ときこそ ゆっくり ていねいに いこう。',
  'おやすみ まえの 1もん、はむちー と しずかに クリアしよう。',
];

export function HomePage() {
  const navigate = useNavigate();
  const xp = useAppStore((state) => state.xp);
  const streakDays = useAppStore((state) => state.streakDays);
  const recentResults = useAppStore((state) => state.recentResults);
  const skillProgress = useAppStore((state) => state.skillProgress);
  const startMission = useAppStore((state) => state.startMission);

  const dueReviews = useMemo(
    () => Object.fromEntries(SUBJECTS.map((subject) => [subject, getDueReviewCount(subject, skillProgress)])) as Record<Subject, number>,
    [skillProgress],
  );

  const last = recentResults[0];
  const now = new Date();
  const dayPart = getDayPart(now);
  const timeSlotSeed = getTimeSlotSeed(now);
  const accuracy = last ? last.accuracy : null;
  const performanceBand = getPerformanceBand(accuracy);
  const resultSeed = hashText(last?.date ?? 'no-result');
  const baseSeed = mixSeed(mixSeed(SESSION_RANDOM_SEED, timeSlotSeed), resultSeed);
  const progress = levelProgress(xp);

  const mascotMood = useMemo(() => {
    const pool = buildMoodPool(dayPart, performanceBand);
    return pickBySeed(pool, mixSeed(baseSeed, 11));
  }, [baseSeed, dayPart, performanceBand]);

  const mascotComment = useMemo(() => {
    const opener = pickBySeed(dayPartOpeners[dayPart], mixSeed(baseSeed, 1));
    const tone = pickBySeed(performanceSegments[performanceBand].tone, mixSeed(baseSeed, 2));
    const action = pickBySeed(performanceSegments[performanceBand].actions, mixSeed(baseSeed, 3));
    const closer = pickBySeed(performanceSegments[performanceBand].closers, mixSeed(baseSeed, 4));
    const sleepySuffix = mascotMood === 'sleepy' ? ` ${pickBySeed(sleepySuffixes, mixSeed(baseSeed, 5))}` : '';

    if (!last) {
      return `${opener} ${tone} ${action} ${closer}${sleepySuffix}`;
    }

    const score = Math.round(last.accuracy * 100);
    return `${opener} ${subjectInfo[last.subject].label}で ${last.correct}/${last.total} せいかい（せいとうりつ ${score}%）。 ${tone} ${action} ${closer}${sleepySuffix}`;
  }, [baseSeed, dayPart, last, mascotMood, performanceBand]);

  // つぎに いく しま: ふくしゅうが いちばん たまっている しま → なければ さいごに あそんだ しま いがい
  const suggestedSubject = useMemo<Subject>(() => {
    const byReview = [...SUBJECTS].sort((a, b) => dueReviews[b] - dueReviews[a]);
    if (dueReviews[byReview[0]] > 0) return byReview[0];
    const recentSubjects = new Set(recentResults.slice(0, 4).map((result) => result.subject));
    return SUBJECTS.find((subject) => !recentSubjects.has(subject)) ?? SUBJECTS[0];
  }, [dueReviews, recentResults]);

  const onQuickStart = (subject: Subject) => {
    audioManager.playSfx('tap');
    startMission(subject);
    navigate('/play');
  };

  return (
    <section className="stack">
      <div className="hero-card home-hero">
        <div className="home-hero-top">
          <div className="home-hero-mascot">
            <img src={hamcheeSrc(mascotMood)} alt="あいぼう はむちー" width={512} height={512} decoding="async" />
          </div>
          <div className="speech-bubble" aria-live="polite">
            {mascotComment}
            {isSpeechSupported() ? (
              <button
                className="icon-btn"
                style={{ width: 34, height: 34, fontSize: '1rem', marginLeft: 6, verticalAlign: 'middle' }}
                onClick={() => speak(mascotComment)}
                aria-label="はむちーの ことばを よみあげる"
              >
                🔊
              </button>
            ) : null}
          </div>
        </div>

        <div className="level-card">
          <div className="level-row">
            <strong>
              Lv.{progress.level} {getLevelTitle(progress.level)}
            </strong>
            <span className="muted">
              つぎまで {progress.needed - progress.current} XP
            </span>
          </div>
          <div className="meter" aria-hidden="true">
            <div className="meter-fill" style={{ width: `${progress.ratio * 100}%` }} />
          </div>
        </div>

        <button className="primary-btn btn-lg btn-block" onClick={() => onQuickStart(suggestedSubject)}>
          {subjectInfo[suggestedSubject].emoji} {subjectInfo[suggestedSubject].island}へ しゅっぱつ！
        </button>
        <p className="muted" style={{ fontSize: '0.82rem', textAlign: 'center' }}>
          {streakDays > 0 ? `🔥 れんぞく ${streakDays}にち たっせいちゅう！` : 'きょうから れんぞく きろくを はじめよう！'}
        </p>
      </div>

      <section className="card" aria-labelledby="islands-title">
        <div className="section-title">
          <h2 id="islands-title">🗺️ しまを えらぶ</h2>
          <Link to="/mission" className="muted" style={{ fontSize: '0.82rem' }} onClick={() => audioManager.playSfx('tap')}>
            マップを みる ›
          </Link>
        </div>
        <div className="island-shortcuts" style={{ marginTop: 12 }}>
          {SUBJECTS.map((subject) => (
            <button
              className="island-chip"
              key={subject}
              style={{ '--h': subjectInfo[subject].hue } as CSSProperties}
              onClick={() => onQuickStart(subject)}
              aria-label={`${subjectInfo[subject].island}で あそぶ${dueReviews[subject] > 0 ? `（ふくしゅう ${dueReviews[subject]}）` : ''}`}
            >
              <span className="chip-emoji" aria-hidden="true">
                {subjectInfo[subject].emoji}
              </span>
              {subjectInfo[subject].label}
              {dueReviews[subject] > 0 ? <span className="chip-badge">{dueReviews[subject]}</span> : null}
            </button>
          ))}
        </div>
      </section>

      <DailyQuestCard />

      <section className="card">
        <h2>📝 さいきんの きろく</h2>
        {recentResults.length > 0 ? (
          <ul className="quest-list" style={{ listStyle: 'none', padding: 0 }}>
            {recentResults.slice(0, 3).map((result) => (
              <li className="quest-item" key={result.date}>
                <span className="quest-icon" aria-hidden="true">
                  {subjectInfo[result.subject].emoji}
                </span>
                <div className="quest-body">
                  <span className="quest-title">{subjectInfo[result.subject].island}</span>
                  <span className="quest-count">
                    {new Date(result.date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ・ ⭐+{result.earnedStars}
                  </span>
                </div>
                <strong>
                  {result.correct}/{result.total}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ marginTop: 8 }}>
            まだ きろくが ありません。さいしょの ぼうけんへ！
          </p>
        )}
      </section>
    </section>
  );
}
