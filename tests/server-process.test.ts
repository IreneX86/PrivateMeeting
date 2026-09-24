import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';

it('starts the production entrypoint, serves health and exits cleanly on SIGTERM without sensitive logs', async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(new URL('../server/index.ts', import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        ALLOWED_ORIGINS: 'https://irenex86.github.io',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', () => {
        if (output.includes('Signaling server started.')) resolve();
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Server exited before readiness.')));
    });
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`, {
      origin: 'https://irenex86.github.io',
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const joined = new Promise<void>((resolve) => ws.once('message', () => resolve()));
    const secret = 'd'.repeat(48);
    ws.send(JSON.stringify({ type: 'join', room: secret }));
    await joined;
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    child.kill('SIGTERM');
    expect(await closed).toBe(1001);
    expect(await exited).toBe(0);
    expect(output).toContain('Signaling server shutting down.');
    expect(output).not.toContain(secret);
    expect(output).not.toContain('127.0.0.1');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}, 10000);
