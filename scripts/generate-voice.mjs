// ずんだもん（VOICEVOX）の よみあげ おんせいを まえもって つくる スクリプト。
//
// つかいかた（PC で）:
//   1. VOICEVOX（https://voicevox.hiroshiba.jp/）を きどうする（エンジンが http://127.0.0.1:50021 で うごく）
//   2. ffmpeg を インストールしておく
//   3. npm run voice:build
//      オプション: --engine http://127.0.0.1:50021  --speaker 3（ずんだもん ノーマル）
//                  --limit 20（ためしに 20こだけ） --dry-run（かずを かぞえるだけ） --concurrency 2
//
// できた ファイル: public/voice/<key>.mp3 と public/voice/manifest.json
// すでに ある ファイルは スキップするので、もんだいを ふやしたら もう1かい うごかせば OK。
// クレジット「VOICEVOX:ずんだもん」は アプリの おとなの へや と README に ひょうじしている。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { questionBank } from '../src/data/questions.generated.ts';
import { allLessons } from '../src/data/lessons.ts';
import { FIXED_LINES, answerLine, lessonSpeech, quizLine } from '../src/data/voiceLines.ts';
import { toSpeakableText, voiceKey } from '../src/utils/voiceKey.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/voice');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const engine = String(arg('engine', 'http://127.0.0.1:50021')).replace(/\/$/, '');
const speaker = Number(arg('speaker', 3));
const limit = Number(arg('limit', Infinity));
const concurrency = Math.max(1, Number(arg('concurrency', 2)));
const dryRun = Boolean(arg('dry-run', false));

/** アプリが よみあげる テキストを ぜんぶ あつめる */
export function collectVoiceTexts() {
  const texts = [...FIXED_LINES];

  for (const question of questionBank) {
    texts.push(question.prompt);
    texts.push(answerLine(question.choices[question.answerIndex]));
  }

  // レッスンの ミニクイズは スキルの いちばん やさしい もんだいから でる
  const easiestBySkill = new Map();
  for (const question of questionBank) {
    const current = easiestBySkill.get(question.skillId);
    if (current === undefined || question.difficulty < current) easiestBySkill.set(question.skillId, question.difficulty);
  }
  for (const question of questionBank) {
    if (question.difficulty === easiestBySkill.get(question.skillId)) texts.push(quizLine(question.prompt));
  }

  for (const lesson of allLessons) {
    const lines = lessonSpeech(lesson);
    texts.push(lines.goal, ...lines.steps, lines.example, lines.exampleAnswer, lines.tip);
  }

  const unique = new Map();
  for (const text of texts) {
    const spoken = toSpeakableText(text);
    if (!spoken) continue;
    unique.set(voiceKey(text), spoken);
  }
  return unique;
}

async function synthesize(text) {
  const query = await fetch(`${engine}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
  if (!query.ok) throw new Error(`audio_query ${query.status}`);
  const params = await query.json();
  params.speedScale = 0.95;
  params.intonationScale = 1.15;
  params.prePhonemeLength = 0.05;
  params.postPhonemeLength = 0.1;

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

function writeManifest() {
  const keys = existsSync(outDir)
    ? readdirSync(outDir)
        .filter((file) => file.endsWith('.mp3'))
        .map((file) => file.replace(/\.mp3$/, ''))
        .sort()
    : [];
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ voice: 'VOICEVOX:ずんだもん', keys })}\n`);
  return keys.length;
}

async function main() {
  const texts = collectVoiceTexts();
  const pending = [...texts].filter(([key]) => !existsSync(join(outDir, `${key}.mp3`))).slice(0, limit);
  console.info(`よみあげ テキスト: ${texts.size}こ / これから つくる: ${pending.length}こ`);
  if (dryRun) return;

  if (pending.length > 0) {
    const version = await fetch(`${engine}/version`).catch(() => null);
    if (!version?.ok) {
      console.error(`VOICEVOX エンジンに つながりません: ${engine}\nVOICEVOX を きどうしてから もう いちど ためしてください。`);
      process.exitCode = 1;
      return;
    }
    console.info(`VOICEVOX ${await version.json()} / speaker ${speaker}`);
  }

  mkdirSync(outDir, { recursive: true });
  let done = 0;
  let failed = 0;
  const queue = [...pending];
  const worker = async () => {
    while (queue.length > 0) {
      const [key, text] = queue.shift();
      try {
        const wav = await synthesize(text);
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

  const total = writeManifest();
  console.info(`できあがり: ${done}こ つくった / しっぱい ${failed}こ / ぜんぶで ${total}こ`);
  console.info('クレジット: VOICEVOX:ずんだもん');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
