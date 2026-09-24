import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH ?? './',
  server: { port: 5173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
