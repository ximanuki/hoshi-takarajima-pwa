import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = 'hoshi-takarajima-pwa';

// オフラインで うごかすために さきに キャッシュする ファイル（おおきい BGM などは のぞく）
const PRECACHE_PATTERN = /\.(html|js|css|webmanifest|svg|png|webp)$/;
// よみあげの こえ（voice/）は たくさん あるので、よまれた ものだけ じっこうじに キャッシュする
const PRECACHE_EXCLUDE = [/^assets\/audio\//, /^voice\//];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'hoshi-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      const files = listFiles(outDir)
        .map((file) => relative(outDir, file).split(sep).join('/'))
        .filter((file) => file !== 'sw.js' && PRECACHE_PATTERN.test(file))
        .filter((file) => !PRECACHE_EXCLUDE.some((pattern) => pattern.test(file)))
        .sort();

      const hash = createHash('sha256');
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      const buildId = hash.digest('hex').slice(0, 12);

      const manifest = files.map((file) => `./${file}`);
      const source = readFileSync(swPath, 'utf8')
        .replace("'__BUILD_ID__'", JSON.stringify(buildId))
        .replace('self.__PRECACHE_MANIFEST || []', JSON.stringify(manifest));
      writeFileSync(swPath, source);
      this.info?.(`sw.js: precache ${manifest.length} files (build ${buildId})`);
    },
  };
}

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? `/${repoName}/` : '/',
  plugins: [react(), serviceWorkerPrecache()],
  build: {
    rollupOptions: {
      output: {
        // もんだいデータは べつの ファイルに して、アプリの こうしんで キャッシュが むだに ならないように する
        manualChunks: (id) => (id.includes('/src/data/questions.generated') ? 'questions' : undefined),
      },
    },
  },
});
