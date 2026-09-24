import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:5198',
    headless: true,
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--allow-loopback-in-peer-connection',
      ],
    },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --port 5198',
      url: 'http://localhost:5198',
      reuseExistingServer: false,
      env: { VITE_SIGNALING_URL: 'ws://localhost:8798/signal', VITE_STUN_URL: '' },
    },
    {
      command: 'npm run dev:server',
      url: 'http://localhost:8798/health',
      reuseExistingServer: false,
      env: { PORT: '8798', ALLOWED_ORIGINS: 'http://localhost:5198', NODE_ENV: 'test' },
    },
  ],
});
