import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests of the built app (run `npm run build` first; `npm run e2e` does both).
 * dist/ is served under a subpath to check that the build works from any folder.
 * The browser is the Chromium already installed for Playwright (no download).
 */
const PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}/tenka-desk/`,
    viewport: { width: 1280, height: 860 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
  },
  webServer: {
    command: `node e2e/serve.ts`,
    url: `http://127.0.0.1:${PORT}/tenka-desk/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
});
