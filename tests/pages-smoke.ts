// Serve the production bundle like project Pages: no SPA fallback outside the mount point.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { strict as assert } from 'node:assert';
import { chromium } from '@playwright/test';
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = path.startsWith('/PrivateMeeting/')
    ? path.slice('/PrivateMeeting/'.length) || 'index.html'
    : '';
  if (!/^(index\.html|favicon\.svg|assets\/[\w.-]+)$/.test(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readFile(new URL(`../dist/${file}`, import.meta.url));
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.svg')
          ? 'image/svg+xml'
          : 'text/html';
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/PrivateMeeting/`;
  await page.goto(base);
  await page.getByRole('button', { name: 'Create Meeting' }).click();
  await page.getByRole('button', { name: 'Join Meeting', exact: true }).waitFor();
  assert.match(page.url(), /\/PrivateMeeting\/#\/room\/[a-f0-9]{48}$/);
  const shared = page.url();
  assert.equal((await page.reload())?.status(), 200);
  await page.getByRole('button', { name: 'Join Meeting', exact: true }).waitFor();
  const fresh = await browser.newPage();
  assert.equal((await fresh.goto(shared))?.status(), 200);
  await fresh.getByRole('button', { name: 'Join Meeting', exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS: production assets, generated shared link, reload and fresh open under /PrivateMeeting/.',
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
