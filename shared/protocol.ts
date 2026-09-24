export const ROOM_PATTERN = /^[a-f0-9]{48}$/;
export const MAX_MESSAGE_BYTES = 64 * 1024;
export type Signal =
  | { kind: 'description'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { kind: 'candidate'; candidate: RTCIceCandidateInit };
export type ClientMessage =
  | { type: 'join'; room: string }
  | { type: 'signal'; session: string; id: string; payload: Signal }
  | { type: 'leave' };
export type ServerMessage =
  | { type: 'joined' }
  | { type: 'paired'; session: string; offerer: boolean }
  | { type: 'signal'; session: string; id: string; payload: Signal }
  | { type: 'peer-left' }
  | { type: 'error'; code: 'full' | 'invalid' | 'unavailable' | 'rate-limit'; message: string };
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export function isSignal(v: unknown): v is Signal {
  if (!object(v)) return false;
  if (v.kind === 'description')
    return (
      object(v.description) &&
      (v.description.type === 'offer' || v.description.type === 'answer') &&
      typeof v.description.sdp === 'string' &&
      v.description.sdp.length > 0 &&
      v.description.sdp.length < 60000
    );
  if (v.kind !== 'candidate' || !object(v.candidate)) return false;
  const c = v.candidate;
  return (
    typeof c.candidate === 'string' &&
    c.candidate.length <= 4096 &&
    (c.sdpMid == null || (typeof c.sdpMid === 'string' && c.sdpMid.length <= 256)) &&
    (c.sdpMLineIndex == null ||
      (Number.isInteger(c.sdpMLineIndex) &&
        Number(c.sdpMLineIndex) >= 0 &&
        Number(c.sdpMLineIndex) < 32)) &&
    (c.usernameFragment == null ||
      (typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 256))
  );
}
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!object(v)) return null;
    if (v.type === 'join' && typeof v.room === 'string' && ROOM_PATTERN.test(v.room))
      return { type: 'join', room: v.room };
    if (v.type === 'leave') return { type: 'leave' };
    if (
      v.type === 'signal' &&
      typeof v.session === 'string' &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(v.session) &&
      typeof v.id === 'string' &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(v.id) &&
      isSignal(v.payload)
    ) {
      // Whitelist protocol fields; never forward arbitrary sender-supplied data.
      const payload: Signal =
        v.payload.kind === 'description'
          ? {
              kind: 'description',
              description: { type: v.payload.description.type, sdp: v.payload.description.sdp },
            }
          : {
              kind: 'candidate',
              candidate: {
                candidate: v.payload.candidate.candidate,
                sdpMid: v.payload.candidate.sdpMid,
                sdpMLineIndex: v.payload.candidate.sdpMLineIndex,
                usernameFragment: v.payload.candidate.usernameFragment,
              },
            };
      return { type: 'signal', session: v.session, id: v.id, payload };
    }
  } catch {
    /* Invalid input is never relayed. */
  }
  return null;
}
export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!object(v)) return null;
    if (v.type === 'joined' || v.type === 'peer-left') return v as ServerMessage;
    if (
      v.type === 'paired' &&
      typeof v.session === 'string' &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(v.session) &&
      typeof v.offerer === 'boolean'
    )
      return v as ServerMessage;
    if (v.type === 'signal') {
      const signal = parseClientMessage(raw);
      return signal?.type === 'signal' ? signal : null;
    }
    if (
      v.type === 'error' &&
      typeof v.code === 'string' &&
      ['full', 'invalid', 'unavailable', 'rate-limit'].includes(v.code) &&
      typeof v.message === 'string' &&
      v.message.length <= 512
    )
      return v as ServerMessage;
  } catch {
    /* A broken or untrusted server must not crash the UI. */
  }
  return null;
}
