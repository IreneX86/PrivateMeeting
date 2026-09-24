import { createSignalingServer } from './app.js';
import { serverConfiguration } from './config.js';

try {
  const configuration = serverConfiguration();
  const app = createSignalingServer(configuration);
  app.server.on('error', () => {
    console.error('Signaling server could not listen. Check PORT and host configuration.');
    process.exitCode = 1;
    void app.close();
  });
  app.server.listen(configuration.port, '0.0.0.0', () => console.log('Signaling server started.'));
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      console.log('Signaling server shutting down.');
      void app.close();
    });
} catch {
  // Configuration may contain credentials/addresses. Never log its values or raw errors.
  console.error(
    'Invalid signaling configuration. Check PORT, ALLOWED_ORIGINS, proxy and limit settings in .env.example.',
  );
  process.exitCode = 1;
}
