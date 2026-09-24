import { loadEnv } from 'vite';
import { iceConfiguration, signalingUrl } from '../src/webrtc/config';
try {
  const env = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
  signalingUrl(env, 'https:');
  iceConfiguration(env);
  console.log('Production frontend configuration is valid.');
} catch {
  console.error(
    'Invalid production configuration. Set VITE_SIGNALING_URL to wss://HOST/signal and check STUN/TURN settings. Values are intentionally not logged.',
  );
  process.exitCode = 1;
}
