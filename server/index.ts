import { createSignalingServer } from './app.js';
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.ALLOWED_ORIGINS || origins.some((s) => !s.startsWith('https://')))
) {
  throw new Error('Production requires explicit HTTPS ALLOWED_ORIGINS.');
}
const port = Number(process.env.PORT || 8787);
const app = createSignalingServer({ origins });
app.server.listen(port, '0.0.0.0', () =>
  console.log(`Signaling listening on port ${port}. Media is never relayed by this service.`),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
