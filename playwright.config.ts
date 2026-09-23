import { defineConfig, devices } from '@playwright/test';

const benchRequested = process.argv.slice(2).some((argument) => argument.includes('performance'));

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  // The physical-device route belongs to `npm run bench` (it asks for it by path and runs headed),
  // never to the QA gate, so `playwright test` on its own always leaves it out.
  testIgnore: benchRequested ? [] : ['**/performance/**'],
  outputDir: '.reports/playwright-results',
  reporter: [['list'], ['html', { outputFolder: '.reports/playwright', open: 'never' }]],
  fullyParallel: false,
  // Every spec seeds the same IndexedDB origin, so two workers would overwrite each other's save.
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: benchRequested
      ? 'npx vite build --config tests/performance/vite.config.ts && npx vite preview --outDir .reports/performance-build --port 5173 --strictPort'
      : 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
