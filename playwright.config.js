// Dev-only. The app itself has no build step and no npm runtime dependencies.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results', // git-ignored
  use: {
    // WebKit is the engine that matters (iPhone Safari). BT_BROWSER=chromium is only a fallback
    // for machines where WebKit cannot be installed.
    browserName: process.env.BT_BROWSER || 'webkit',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL',
    serviceWorkers: 'allow'
  }
});
