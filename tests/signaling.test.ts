import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { createSignalingServer } from '../server/app';
import type { ServerMessage } from '../shared/protocol';
import { createRoomId } from '../src/rooms';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(maxRooms?: number) {
  const app = createSignalingServer({ origins: ['http://localhost:5173'], maxRooms });
  cleanup.push(app.close);
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/signal`;
  async function client() {
    const ws = new WebSocket(url, { origin: 'http://localhost:5173' });
    const messages: ServerMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return { ws, messages, send: (value: unknown) => ws.send(JSON.stringify(value)) };
  }
  return { app, url, client };
}
const eventually = async (condition: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(condition()).toBe(true);
};
describe('real WebSocket signaling service', () => {
  it('atomically admits two, rejects a third, routes only within a session, and frees seats', async () => {
    const { app, client } = await setup();
    const a = await client(),
      b = await client(),
      c = await client();
    const room = createRoomId();
    a.send({ type: 'join', room });
    b.send({ type: 'join', room });
    c.send({ type: 'join', room });
    await eventually(
      () =>
        a.messages.some((m) => m.type === 'paired') && c.messages.some((m) => m.type === 'error'),
    );
    const pair = a.messages.find((m) => m.type === 'paired');
    if (pair?.type !== 'paired') throw Error('Missing pair');
    expect(pair.offerer).toBe(true);
    expect(b.messages.find((m) => m.type === 'paired')).toEqual({ ...pair, offerer: false });
    expect(c.messages).toContainEqual({
      type: 'error',
      code: 'full',
      message: 'Meeting room is full.',
    });
    const payload = { kind: 'description', description: { type: 'offer', sdp: 'v=0' } };
    a.send({ type: 'signal', session: 'stale', id: 'wrong', payload });
    b.send({ type: 'signal', session: pair.session, id: 'wrong-role', payload });
    a.send({ type: 'signal', session: pair.session, id: 'correct', payload });
    await eventually(() => b.messages.some((m) => m.type === 'signal'));
    expect(b.messages.filter((m) => m.type === 'signal')).toHaveLength(1);
    expect(a.messages.filter((m) => m.type === 'signal')).toHaveLength(0);
    b.ws.close();
    await eventually(() => a.messages.some((m) => m.type === 'peer-left'));
    const d = await client();
    d.send({ type: 'join', room });
    await eventually(() => d.messages.some((m) => m.type === 'paired'));
    expect(d.messages.find((m) => m.type === 'paired')).not.toEqual({ ...pair, offerer: false });
    a.ws.close();
    d.ws.close();
    await eventually(() => app.registry.size === 0);
  });
  it('does not relay to another room or allow one socket to occupy multiple rooms', async () => {
    const { app, client } = await setup();
    const a = await client(),
      b = await client();
    a.send({ type: 'join', room: createRoomId() });
    a.send({ type: 'join', room: createRoomId() });
    b.send({ type: 'join', room: createRoomId() });
    await eventually(() => b.messages.some((m) => m.type === 'joined'));
    expect(app.registry.size).toBe(2);
    expect(a.messages).toEqual([{ type: 'joined' }]);
    expect(b.messages).toEqual([{ type: 'joined' }]);
  });
  it('bounds room allocation and rejects invalid messages', async () => {
    const { client } = await setup(1);
    const a = await client(),
      b = await client(),
      c = await client();
    a.send({ type: 'join', room: createRoomId() });
    b.send({ type: 'join', room: createRoomId() });
    c.send({ type: 'join', room: 'short' });
    await eventually(
      () =>
        b.messages.some((m) => m.type === 'error') && c.messages.some((m) => m.type === 'error'),
    );
    expect(b.messages).toContainEqual(expect.objectContaining({ code: 'unavailable' }));
    expect(c.messages).toContainEqual(expect.objectContaining({ code: 'invalid' }));
  });
  it('refuses unapproved origins and unknown paths', async () => {
    const { url } = await setup();
    for (const [endpoint, origin] of [
      [url, 'https://untrusted.example'],
      [url.replace('/signal', '/rooms'), 'http://localhost:5173'],
    ]) {
      const socket = new WebSocket(endpoint, { origin });
      const error = await new Promise<Error>((resolve) => socket.on('error', resolve));
      expect(error.message).toContain('403');
    }
  });
});
