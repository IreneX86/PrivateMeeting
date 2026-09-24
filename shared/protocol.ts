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
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
export function isSignal(v: unknown): v is Signal {
  if (!object(v)) return false;
  if (v.kind === 'description')
    return (
      object(v.description) &&
      ['offer', 'answer'].includes(String(v.description.type)) &&
      typeof v.description.sdp === 'string' &&
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
  try {
    const v: unknown = JSON.parse(raw);
    if (!object(v)) return null;
    if (v.type === 'join' && typeof v.room === 'string' && ROOM_PATTERN.test(v.room))
      return { type: 'join', room: v.room };
    if (v.type === 'leave') return { type: 'leave' };
    if (
      v.type === 'signal' &&
      typeof v.session === 'string' &&
      v.session.length <= 64 &&
      typeof v.id === 'string' &&
      v.id.length <= 64 &&
      isSignal(v.payload)
    )
      return v as ClientMessage;
  } catch {
    /* Invalid input is never relayed. */
  }
  return null;
}
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (!object(v)) return null;
    if (v.type === 'joined' || v.type === 'peer-left') return v as ServerMessage;
    if (
      v.type === 'paired' &&
      typeof v.session === 'string' &&
      v.session.length <= 64 &&
      typeof v.offerer === 'boolean'
    )
      return v as ServerMessage;
    if (v.type === 'signal' && parseClientMessage(raw)) return v as ServerMessage;
    if (
      v.type === 'error' &&
      ['full', 'invalid', 'unavailable', 'rate-limit'].includes(String(v.code)) &&
      typeof v.message === 'string'
    )
      return v as ServerMessage;
  } catch {
    /* A broken or untrusted server must not crash the UI. */
  }
  return null;
}
