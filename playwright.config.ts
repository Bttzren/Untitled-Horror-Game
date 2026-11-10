import { defineConfig } from '@playwright/test';

const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 960, height: 600 },
    trace: 'off',
    launchOptions: {
      executablePath,
      // Software WebGL so the game renders on machines without a GPU.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
    { command: 'node e2e/signal-server.mjs', url: 'http://127.0.0.1:9000/', reuseExistingServer: true, timeout: 30_000 },
    { command: 'npm run build && node e2e/static-server.mjs', url: 'http://127.0.0.1:4174/nested/', reuseExistingServer: true, timeout: 120_000 },
  ],
});
