#!/usr/bin/env node
// OtoLogic などの こうかおんを アプリ ように ととのえて public/sfx/ に いれる。
//
//   1. https://otologic.jp/ から つかいたい おとの mp3（または zip）を ダウンロードして sfx-src/ に おく
//   2. node scripts/import-sfx.mjs --list        … こうほの ファイルと ながさを みる
//   3. scripts/sfx-map.json の file に ファイルめいを かく
//   4. node scripts/import-sfx.mjs               … public/sfx/*.mp3 と manifest.json が できる
//
// ffmpeg で: さいしょの むおんを けずる → maxSeconds で きる → おわりを フェードアウト → おおきさを そろえる（-16 LUFS あたり）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'sfx-src');
const OUT = join(ROOT, 'public', 'sfx');
const MAP = join(ROOT, 'scripts', 'sfx-map.json');

function listAudio(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listAudio(full);
    return /\.(mp3|wav|ogg|m4a)$/i.test(name) ? [full] : [];
  });
}

/** sfx-src の zip を いちじ フォルダに ひらいて、おとファイルの いちらんを かえす */
function collectSources() {
  const work = mkdtempSync(join(tmpdir(), 'sfx-'));
  if (existsSync(SRC)) {
    for (const name of readdirSync(SRC)) {
      if (!/\.zip$/i.test(name)) continue;
      execFileSync('unzip', ['-o', '-q', join(SRC, name), '-d', join(work, basename(name, '.zip'))]);
    }
  }
  return { work, files: [...listAudio(SRC), ...listAudio(work)] };
}

function duration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim());
}

function convert(file, out, { maxSeconds = 1.5, gainDb = 0 }) {
  const fade = Math.min(0.15, maxSeconds / 4);
  const filters = [
    'silenceremove=start_periods=1:start_threshold=-50dB',
    `atrim=0:${maxSeconds}`,
    `afade=t=out:st=${Math.max(0, maxSeconds - fade)}:d=${fade}`,
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    `volume=${gainDb}dB`,
  ].join(',');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-af', filters, '-ac', '1', '-ar', '44100', '-b:a', '96k', out]);
}

const args = process.argv.slice(2);
const { work, files } = collectSources();
try {
  if (files.length === 0) {
    console.error('sfx-src/ に おとファイル（mp3 / zip）が ないよ');
    process.exitCode = 1;
  } else if (args.includes('--list')) {
    for (const file of files) {
      const where = file.startsWith(work) ? relative(work, file) : relative(SRC, file);
      console.log(`${duration(file).toFixed(2).padStart(6)}s  ${where}`);
    }
  } else {
    const map = JSON.parse(readFileSync(MAP, 'utf8'));
    mkdirSync(OUT, { recursive: true });
    const done = {};
    for (const [effect, spec] of Object.entries(map.effects)) {
      if (!spec.file) continue;
      const source = files.find((file) => basename(file) === spec.file || file.endsWith(spec.file));
      if (!source) {
        console.error(`✗ ${effect}: ${spec.file} が みつからない`);
        process.exitCode = 1;
        continue;
      }
      const name = `${effect}.mp3`;
      convert(source, join(OUT, name), spec);
      done[effect] = name;
      console.log(`✓ ${effect} ← ${spec.file} (${duration(join(OUT, name)).toFixed(2)}s)`);
    }
    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ credit: map.credit, files: done }, null, 2)}\n`);
    console.log(`public/sfx/manifest.json: ${Object.keys(done).length} こ`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
