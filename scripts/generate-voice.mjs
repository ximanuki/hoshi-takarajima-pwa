// VOICEVOX の よみあげ おんせいを まえもって つくる スクリプト（きほんは もち子さん）。
//
// つかいかた（PC で）:
//   1. VOICEVOX（https://voicevox.hiroshiba.jp/）を きどうする（エンジンが http://127.0.0.1:50021 で うごく）
//   2. ffmpeg を インストールしておく
//   3. npm run voice:build
//      オプション: --character もち子さん --style ノーマル（なまえで えらぶ）
//                  --speaker 20（スタイル ID を ちょくせつ してい）
//                  --engine http://127.0.0.1:50021
//                  --limit 20（ためしに 20こだけ） --dry-run（かずを かぞえるだけ） --concurrency 2
//                  --force（いまの ファイルを けして ぜんぶ つくりなおす。こえや チューニングを かえた ときに）
//                  --speed 1.0 --intonation 1.0 --pause 1.0（ぜんたいの ばいりつ）--pitch 0（たかさを たす）
//                  --preview "テキスト" [--kind question|answer|lesson|praise|talk]
//                      → 1ぶんだけ voice-preview.mp3 に つくって ならす（チューニングの ためしぎき）
//
// よみかたの くふう（scripts/voice-reading.mjs / scripts/voice-dict.json）:
//   - ひょうじは ひらがなの わかちがき。VOICEVOX には くうはくを とって、よく でる ことばを かんじに して わたす
//   - ぶんの しゅるい（もんだい・こたえ・レッスン・ほめことば・セリフ）ごとに はやさ・よくよう・ま を かえる
//   - voice-dict.json の accent を VOICEVOX の ユーザーじしょに とうろくして アクセントを してい
//
// できた ファイル: public/voice/<key>.mp3 と public/voice/manifest.json
// すでに ある ファイルは スキップするので、もんだいを ふやしたら もう1かい うごかせば OK。
// manifest の credit が アプリに ひょうじ される（VOICEVOX の りようきやくで ひつよう）。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionBank } from '../src/data/questions.generated.ts';
import { allLessons } from '../src/data/lessons.ts';
import { FIXED_LINES, PRAISE_LINES, answerLine, lessonSpeech, quizLine } from '../src/data/voiceLines.ts';
import { toSpeakableText, voiceKey } from '../src/utils/voiceKey.ts';
import { applyProfile, toReadingText, VOICE_PROFILES } from './voice-reading.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/voice');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const engine = String(arg('engine', 'http://127.0.0.1:50021')).replace(/\/$/, '');
const characterName = String(arg('character', 'もち子さん'));
const styleName = String(arg('style', 'ノーマル'));
const speakerOverride = arg('speaker', undefined);
const force = Boolean(arg('force', false));

// クレジットの かきかた（キャラクターごとの りようきやくに あわせる）
const CREDITS = {
  もち子さん: 'VOICEVOX:もち子(cv 明日葉よもぎ)',
  ずんだもん: 'VOICEVOX:ずんだもん',
};

function creditFor(name) {
  return CREDITS[name] ?? `VOICEVOX:${name.replace(/さん$/, '')}`;
}

let speaker = speakerOverride === undefined ? undefined : Number(speakerOverride);
const scale = {
  speed: Number(arg('speed', 1)),
  intonation: Number(arg('intonation', 1)),
  pause: Number(arg('pause', 1)),
  pitch: Number(arg('pitch', 0)),
};
const previewText = arg('preview', undefined);
const previewKind = String(arg('kind', 'question'));
const dict = JSON.parse(readFileSync(join(root, 'scripts/voice-dict.json'), 'utf8'));
const limit = Number(arg('limit', Infinity));
const concurrency = Math.max(1, Number(arg('concurrency', 2)));
const dryRun = Boolean(arg('dry-run', false));

/** アプリが よみあげる テキストを ぜんぶ あつめる（key → { text, kind }） */
export function collectVoiceTexts() {
  const entries = [];
  const add = (text, kind) => entries.push({ text, kind });

  for (const line of PRAISE_LINES) add(line, 'praise');
  for (const line of FIXED_LINES) add(line, 'talk');

  for (const question of questionBank) {
    add(question.prompt, 'question');
    add(answerLine(question.choices[question.answerIndex]), 'answer');
  }

  // レッスンの ミニクイズは スキルの いちばん やさしい もんだいから でる
  const easiestBySkill = new Map();
  for (const question of questionBank) {
    const current = easiestBySkill.get(question.skillId);
    if (current === undefined || question.difficulty < current) easiestBySkill.set(question.skillId, question.difficulty);
  }
  for (const question of questionBank) {
    if (question.difficulty === easiestBySkill.get(question.skillId)) add(quizLine(question.prompt), 'question');
  }

  for (const lesson of allLessons) {
    const lines = lessonSpeech(lesson);
    for (const line of [lines.goal, ...lines.steps, lines.example, lines.tip]) add(line, 'lesson');
    add(lines.exampleAnswer, 'answer');
  }

  const unique = new Map();
  for (const { text, kind } of entries) {
    const spoken = toSpeakableText(text);
    if (!spoken) continue;
    const key = voiceKey(text);
    // おなじ ぶんが なんども でる ときは さいしょの しゅるい（ほめことば > セリフ > もんだい …）を つかう
    if (!unique.has(key)) unique.set(key, { text: spoken, kind });
  }
  return unique;
}

async function synthesize(text, kind) {
  const reading = toReadingText(text, dict);
  const query = await fetch(`${engine}/audio_query?text=${encodeURIComponent(reading)}&speaker=${speaker}`, { method: 'POST' });
  if (!query.ok) throw new Error(`audio_query ${query.status}`);
  const params = applyProfile(await query.json(), kind, scale);

  const synthesis = await fetch(`${engine}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!synthesis.ok) throw new Error(`synthesis ${synthesis.status}`);
  return Buffer.from(await synthesis.arrayBuffer());
}

function encodeMp3(wav, outPath) {
  return new Promise((resolvePromise, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-b:a', '40k', outPath]);
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg exited ${code}`))));
    ffmpeg.stdin.end(wav);
  });
}

async function resolveSpeaker() {
  if (speaker !== undefined) return speaker;
  const response = await fetch(`${engine}/speakers`);
  if (!response.ok) throw new Error(`speakers ${response.status}`);
  const speakers = await response.json();
  const character = speakers.find((entry) => entry.name === characterName);
  if (!character) {
    throw new Error(
      `「${characterName}」が みつかりません。つかえる なまえ: ${speakers.map((entry) => entry.name).join('、')}`,
    );
  }
  const style = character.styles.find((entry) => entry.name === styleName) ?? character.styles[0];
  return style.id;
}

/** voice-dict.json の accent を VOICEVOX の ユーザーじしょに とうろく（おなじ ことばが あれば うわがき） */
async function registerAccents() {
  const words = dict.accent ?? [];
  if (words.length === 0) return;
  const listResponse = await fetch(`${engine}/user_dict`);
  const existing = listResponse.ok ? await listResponse.json() : {};
  let registered = 0;
  for (const word of words) {
    const params = new URLSearchParams({
      surface: word.surface,
      pronunciation: word.pronunciation,
      accent_type: String(word.accentType),
      word_type: 'PROPER_NOUN',
    });
    const found = Object.entries(existing).find(([, entry]) => entry.surface === word.surface || entry.surface === toFullWidth(word.surface));
    const url = found ? `${engine}/user_dict_word/${found[0]}?${params}` : `${engine}/user_dict_word?${params}`;
    const response = await fetch(url, { method: found ? 'PUT' : 'POST' });
    if (response.ok) registered += 1;
    else console.warn(`アクセントの とうろくに しっぱい: ${word.surface} (${response.status})`);
  }
  console.info(`アクセント じしょ: ${registered}こ とうろく`);
}

function toFullWidth(text) {
  return text.replace(/[!-~]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
}

async function preview() {
  if (!VOICE_PROFILES[previewKind]) {
    console.error(`--kind は ${Object.keys(VOICE_PROFILES).join(' / ')} の どれか`);
    process.exitCode = 1;
    return;
  }
  if (!(await connect())) {
    process.exitCode = 1;
    return;
  }
  const spoken = toSpeakableText(String(previewText));
  console.info(`ひょうじ: ${previewText}\nVOICEVOX: ${toReadingText(spoken, dict)}\nしゅるい: ${previewKind} ${JSON.stringify(applyProfile({}, previewKind, scale))}`);
  const out = join(process.cwd(), 'voice-preview.mp3');
  await encodeMp3(await synthesize(spoken, previewKind), out);
  console.info(`→ ${out}`);
  const player = process.platform === 'darwin' ? 'afplay' : null;
  if (player) spawn(player, [out], { stdio: 'ignore' });
}

function readManifestCredit() {
  try {
    return JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).credit;
  } catch {
    return undefined;
  }
}

function writeManifest(credit) {
  const keys = existsSync(outDir)
    ? readdirSync(outDir)
        .filter((file) => file.endsWith('.mp3'))
        .map((file) => file.replace(/\.mp3$/, ''))
        .sort()
    : [];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'manifest.json'),
    `${JSON.stringify({ credit: keys.length > 0 ? credit : null, keys })}\n`,
  );
  return keys.length;
}

async function connect() {
  const version = await fetch(`${engine}/version`).catch(() => null);
  if (!version?.ok) {
    console.error(`VOICEVOX エンジンに つながりません: ${engine}\nVOICEVOX を きどうしてから もう いちど ためしてください。`);
    return false;
  }
  try {
    speaker = await resolveSpeaker();
    await registerAccents();
  } catch (error) {
    console.error(error.message);
    return false;
  }
  console.info(`VOICEVOX ${await version.json()} / ${characterName} ${styleName}（speaker ${speaker}）`);
  return true;
}

async function main() {
  if (previewText !== undefined) {
    await preview();
    return;
  }
  const credit = creditFor(characterName);
  const previousCredit = readManifestCredit();
  const texts = collectVoiceTexts();

  if (dryRun) {
    const pendingCount = [...texts.keys()].filter((key) => force || !existsSync(join(outDir, `${key}.mp3`))).length;
    console.info(`よみあげ テキスト: ${texts.size}こ / これから つくる: ${Math.min(pendingCount, limit)}こ`);
    return;
  }

  if (previousCredit && previousCredit !== credit && !force) {
    console.error(
      `いまの おんせいは「${previousCredit}」です。こえを「${credit}」に かえるときは --force を つけて ぜんぶ つくりなおしてください。`,
    );
    process.exitCode = 1;
    return;
  }

  // けす まえに、エンジンと こえが つかえるか たしかめる
  if (!(await connect())) {
    process.exitCode = 1;
    return;
  }

  if (force && existsSync(outDir)) {
    for (const file of readdirSync(outDir)) {
      if (file.endsWith('.mp3')) rmSync(join(outDir, file));
    }
    console.info('いまの おんせいファイルを けしました（--force）');
  }

  const pending = [...texts].filter(([key]) => !existsSync(join(outDir, `${key}.mp3`))).slice(0, limit);
  console.info(`よみあげ テキスト: ${texts.size}こ / これから つくる: ${pending.length}こ`);

  mkdirSync(outDir, { recursive: true });
  let done = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    while (queue.length > 0) {
      const [key, { text, kind }] = queue.shift();
      try {
        const wav = await synthesize(text, kind);
        await encodeMp3(wav, join(outDir, `${key}.mp3`));
        done += 1;
      } catch (error) {
        failed += 1;
        console.warn(`しっぱい: ${text} (${error.message})`);
      }
      if ((done + failed) % 50 === 0) console.info(`  ${done + failed} / ${pending.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const total = writeManifest(credit);
  console.info(`できあがり: ${done}こ つくった / しっぱい ${failed}こ / ぜんぶで ${total}こ`);
  console.info(`クレジット: ${credit}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
