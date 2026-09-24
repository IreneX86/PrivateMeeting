import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignalingClient } from '../src/signaling/client';
class Socket {
  static OPEN = 1;
  static latest: Socket;
  readyState = 0;
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn();
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() {
    Socket.latest = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('does not join or deliver stale callbacks after a canceled socket opens late', () => {
  const message = vi.fn(),
    lost = vi.fn();
  const client = new SignalingClient('ws://localhost/signal', 'a'.repeat(48), message, lost);
  const socket = Socket.latest;
  client.close();
  socket.readyState = 1;
  socket.onopen!();
  socket.onmessage!({ data: '{"type":"joined"}' });
  socket.onclose!();
  vi.advanceTimersByTime(13000);
  expect(socket.send).not.toHaveBeenCalled();
  expect(message).not.toHaveBeenCalled();
  expect(lost).not.toHaveBeenCalled();
});
it('reports an admission timeout once and prevents unlimited outgoing buffering', () => {
  const lost = vi.fn();
  const client = new SignalingClient('ws://localhost/signal', 'a'.repeat(48), vi.fn(), lost);
  const socket = Socket.latest;
  socket.readyState = 1;
  socket.bufferedAmount = 300000;
  expect(() => client.send('s', { kind: 'candidate', candidate: { candidate: 'test' } })).toThrow(
    'connection was lost',
  );
  vi.advanceTimersByTime(13000);
  socket.onclose!();
  expect(lost).toHaveBeenCalledTimes(1);
  client.close();
});
