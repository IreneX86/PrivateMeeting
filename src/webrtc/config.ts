export function iceConfiguration(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];
  const stun = String(env.VITE_STUN_URL ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (stun.some((url) => !/^stuns?:[^\s]+$/.test(url)))
    throw new Error('Invalid STUN URL configuration.');
  if (stun.length) iceServers.push({ urls: stun });
  const turn = String(env.VITE_TURN_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (turn.length) {
    if (
      turn.some((url) => !/^turns?:[^\s]+$/.test(url)) ||
      !env.VITE_TURN_USERNAME ||
      !env.VITE_TURN_CREDENTIAL
    )
      throw new Error('TURN requires valid URLs, a username, and a credential.');
    iceServers.push({
      urls: turn,
      username: String(env.VITE_TURN_USERNAME),
      credential: String(env.VITE_TURN_CREDENTIAL),
    });
  }
  return { iceServers, iceCandidatePoolSize: 0, bundlePolicy: 'max-bundle' };
}
export function signalingUrl(): string {
  const configured = import.meta.env.VITE_SIGNALING_URL;
  const value = configured || (import.meta.env.DEV ? 'ws://localhost:8787/signal' : '');
  if (!value)
    throw new Error('The signaling service is not configured. Set VITE_SIGNALING_URL and rebuild.');
  const url = new URL(value);
  if (
    !['ws:', 'wss:'].includes(url.protocol) ||
    (location.protocol === 'https:' && url.protocol !== 'wss:')
  )
    throw new Error('Use a secure wss:// signaling URL for an HTTPS website.');
  return url.href;
}
