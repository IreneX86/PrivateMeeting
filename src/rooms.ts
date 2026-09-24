import { ROOM_PATTERN } from '../shared/protocol';
export function createRoomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
export function readRoute(
  hash: string,
): { page: 'home' } | { page: 'room'; room: string } | { page: 'invalid' } {
  if (!hash || hash === '#' || hash === '#/') return { page: 'home' };
  const match = /^#\/room\/([^/]+)$/.exec(hash);
  return match && ROOM_PATTERN.test(match[1])
    ? { page: 'room', room: match[1] }
    : { page: 'invalid' };
}
export function roomUrl(room: string, current: string = location.href): string {
  const url = new URL(current);
  url.search = '';
  url.hash = `/room/${room}`;
  return url.href;
}
