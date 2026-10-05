// VOICEVOX に わたす よみ（ひょうじ ようの ひらがなぶんを、はつおん しやすい かたちに する）と、
// ぶんの しゅるいごとの よみかた（はやさ・よくよう・たかさ・ま）の チューニング。

/**
 * ぶんの しゅるいごとの パラメータ（VOICEVOX audio_query の こうもく）。
 * 6〜8さいが ききとりやすいように:
 *  - もんだい: すこし ゆっくり・はっきり、「？」で ごびが あがる（VOICEVOX が じどうで ぎもんけいに する）
 *  - こたえ: おちついて、ゆっくりめ
 *  - レッスン: いちばん ゆっくり、くとうてんの まを ながめに
 *  - ほめことば: あかるく、よくよう おおきめ、すこし たかめ
 *  - あいさつ・セリフ: ふつうの はやさで げんきに
 */
export const VOICE_PROFILES = {
  question: { speedScale: 0.9, intonationScale: 1.15, pitchScale: 0, pauseLengthScale: 1.15, prePhonemeLength: 0.1, postPhonemeLength: 0.2 },
  answer: { speedScale: 0.92, intonationScale: 1.1, pitchScale: 0, pauseLengthScale: 1.1, prePhonemeLength: 0.08, postPhonemeLength: 0.15 },
  lesson: { speedScale: 0.88, intonationScale: 1.1, pitchScale: 0, pauseLengthScale: 1.3, prePhonemeLength: 0.1, postPhonemeLength: 0.25 },
  praise: { speedScale: 1.0, intonationScale: 1.35, pitchScale: 0.03, pauseLengthScale: 1.0, prePhonemeLength: 0.03, postPhonemeLength: 0.1 },
  talk: { speedScale: 0.95, intonationScale: 1.2, pitchScale: 0.02, pauseLengthScale: 1.1, prePhonemeLength: 0.05, postPhonemeLength: 0.15 },
};

const PARTICLES = ['では', 'には', 'とは', 'でも', 'から', 'まで', 'より', 'だけ', 'など', 'ずつ', 'です', 'でした', 'って', 'は', 'が', 'を', 'に', 'の', 'で', 'と', 'も', 'へ', 'や', 'か', 'だ', 'ね', 'よ'];
const TRAILING_PUNCT = /[。、！？!?」』）)]*$/;
const SPLIT = /(\s+|[。、！？!?「」『』（）()])/;

// かず + じょすうし（ひらがな）→ かんじ。「1こ」を いちこ、「2にん」を ににん と よまないように
const COUNTERS = [
  [/(\d+)じはん/g, '$1時半'],
  [/(\d+)(ふん|ぷん)/g, '$1分'],
  [/(\d+)びょう/g, '$1秒'],
  [/(\d+)じ(?![ゃゅょぁ-ゖ]*[ぁ-ゖ]{2})/g, '$1時'],
  [/(\d+)こ(?![ぁ-ゖ]{2,}[^ぁ-ゖ]?$)/g, '$1個'],
  [/(\d+)(ほん|ぼん|ぽん)/g, '$1本'],
  [/(\d+)まい/g, '$1枚'],
  [/(\d+)えん/g, '$1円'],
  [/(\d+)にん/g, '$1人'],
  [/(\d+)(ひき|びき|ぴき)/g, '$1匹'],
  [/(\d+)さつ/g, '$1冊'],
  [/(\d+)ばんめ/g, '$1番目'],
  [/(\d+)かい/g, '$1回'],
  [/(\d+)にち/g, '$1日'],
  [/(\d+)がつ/g, '$1月'],
  [/(\d+)かげつ/g, '$1か月'],
  [/(\d+)さい/g, '$1歳'],
  [/(\d+)だん/g, '$1段'],
  [/(\d+)ほ(?=[^ぁ-ゖ]|$|[はがをにのでと])/g, '$1歩'],
  [/(\d+)とうぶん/g, '$1等分'],
  [/(\d+)きれ/g, '$1切れ'],
  [/(\d+)しゅうかん/g, '$1週間'],
  [/(\d+)てん/g, '$1点'],
];

function replaceNoun(token, nouns, keys) {
  const core = token.replace(TRAILING_PUNCT, '');
  const punct = token.slice(core.length);
  for (const key of keys) {
    if (!core.startsWith(key)) continue;
    const rest = core.slice(key.length);
    if (rest === '' || PARTICLES.some((particle) => rest.startsWith(particle))) {
      return nouns[key] + rest + punct;
    }
  }
  return token;
}

/**
 * ひょうじ ようの ぶん → VOICEVOX に わたす ぶん。
 * 1. くうはくで くぎった かたまりごとに じしょで かんじに なおす（tokens → nouns）
 * 2. にほんごの あいだの くうはくを とる（へんな まや アクセントの きれめを ふせぐ）
 */
export function toReadingText(text, dict = {}) {
  const nouns = dict.nouns ?? {};
  const tokens = dict.tokens ?? {};
  const nounKeys = Object.keys(nouns).sort((a, b) => b.length - a.length);

  const converted = text
    .split(SPLIT)
    .map((part) => {
      if (part === '' || SPLIT.test(part)) return part;
      const core = part.replace(TRAILING_PUNCT, '');
      if (tokens[core] !== undefined) return tokens[core] + part.slice(core.length);
      return replaceNoun(part, nouns, nounKeys);
    })
    .join('');

  const counted = COUNTERS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), converted)
    // 「こたえは 13」→「答えは、13」: こたえの まえに すこし まを いれる
    .replace(/答えは\s*(?=[0-9ぁ-んァ-ヶー一-龯「])/g, '答えは、');

  return counted
    .replace(/(?<=[^\sA-Za-z0-9])\s+(?=[^\sA-Za-z0-9])/g, '')
    .replace(/(?<=[0-9])\s+(?=[^\sA-Za-z0-9])/g, '')
    .replace(/(?<=[^\sA-Za-z0-9])\s+(?=[0-9])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** audio_query の けっかに プロファイルと ぜんたいの ばいりつを あてる */
export function applyProfile(query, kind, scale = {}) {
  const profile = VOICE_PROFILES[kind] ?? VOICE_PROFILES.talk;
  const next = { ...query };
  next.speedScale = round(profile.speedScale * (scale.speed ?? 1));
  next.intonationScale = round(profile.intonationScale * (scale.intonation ?? 1));
  next.pitchScale = round(profile.pitchScale + (scale.pitch ?? 0));
  next.prePhonemeLength = profile.prePhonemeLength;
  next.postPhonemeLength = profile.postPhonemeLength;
  // pauseLengthScale は VOICEVOX 0.19 いこう。ふるい エンジンでは むしされる
  next.pauseLengthScale = round(profile.pauseLengthScale * (scale.pause ?? 1));
  return next;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
