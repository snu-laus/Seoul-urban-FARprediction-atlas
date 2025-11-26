// @ts-check
/* global process */
import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', {outputFolder: 'playwright-report'}]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN ?? 'test-token',
      VITE_APP_TEST_MODE: 'true',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
});
