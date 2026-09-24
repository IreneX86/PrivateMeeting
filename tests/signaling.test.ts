import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { connect, type AddressInfo } from 'node:net';
import { createSignalingServer, type ServerOptions } from '../server/app';
import type { ServerMessage } from '../shared/protocol';
import { createRoomId } from '../src/rooms';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup(maxRooms?: number, options: Partial<ServerOptions> = {}) {
  const app = createSignalingServer({ origins: ['http://localhost:5173'], maxRooms, ...options });
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

const closed = (socket: WebSocket) =>
  new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
describe('public signaling resilience', () => {
  it('limits simultaneous source connections, including forged forwarding headers', async () => {
    const { client, url } = await setup(undefined, { maxConnectionsPerIp: 1 });
    const first = await client();
    const rejected = new WebSocket(url, {
      origin: 'http://localhost:5173',
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    const error = await new Promise<Error>((resolve) => rejected.once('error', resolve));
    expect(error.message).toContain('429');
    const gone = closed(first.ws);
    first.ws.close();
    await gone;
    const replacement = await client();
    expect(replacement.ws.readyState).toBe(WebSocket.OPEN);
  });
  it('rate limits connection churn after sockets close', async () => {
    const { client } = await setup(undefined, { connectionsPerMinute: 2 });
    for (let i = 0; i < 2; i++) {
      const c = await client();
      const gone = closed(c.ws);
      c.ws.close();
      await gone;
    }
    await expect(client()).rejects.toThrow('429');
  });
  it('bounds total admitted sockets', async () => {
    const { client } = await setup(undefined, { maxConnections: 1 });
    await client();
    await expect(client()).rejects.toThrow('503');
  });
  it('rejects oversized frames and cleans up the occupied room', async () => {
    const { client, app } = await setup();
    const c = await client();
    c.send({ type: 'join', room: createRoomId() });
    await eventually(() => app.registry.size === 1);
    const gone = closed(c.ws);
    c.ws.send('x'.repeat(65537));
    await gone;
    await eventually(() => app.registry.size === 0);
  });
  it('closes a flood and cannot rejoin on frames buffered after leave', async () => {
    const { client, app } = await setup();
    const flood = await client();
    const room = createRoomId();
    const floodGone = closed(flood.ws);
    for (let i = 0; i < 210; i++) flood.send({ type: 'join', room });
    expect(await floodGone).toBe(1008);
    await eventually(() => app.registry.size === 0);
    expect(flood.messages).toContainEqual(expect.objectContaining({ code: 'rate-limit' }));
    const c = await client();
    const gone = closed(c.ws);
    c.send({ type: 'join', room });
    c.send({ type: 'leave' });
    c.send({ type: 'join', room: createRoomId() });
    await gone;
    expect(c.messages.filter((m) => m.type === 'joined')).toHaveLength(1);
    expect(app.registry.size).toBe(0);
  });
  it('applies a byte budget independently of message count', async () => {
    const { client } = await setup();
    const a = await client(),
      b = await client();
    const room = createRoomId();
    a.send({ type: 'join', room });
    b.send({ type: 'join', room });
    await eventually(() => a.messages.some((m) => m.type === 'paired'));
    const pair = a.messages.find((m) => m.type === 'paired');
    if (pair?.type !== 'paired') throw new Error('Pair missing');
    const gone = closed(a.ws);
    for (let i = 0; i < 6; i++)
      a.send({
        type: 'signal',
        session: pair.session,
        id: String(i),
        payload: {
          kind: 'description',
          description: { type: 'offer', sdp: 'v=0' + 'x'.repeat(55000) },
        },
      });
    expect(await gone).toBe(1008);
    expect(a.messages).toContainEqual(expect.objectContaining({ code: 'rate-limit' }));
  });
  it('expires unjoined and non-responsive connections', async () => {
    const idle = await setup(undefined, { admissionTimeoutMs: 30 });
    const c = await idle.client();
    expect(await closed(c.ws)).toBe(1008);
    const dead = await setup(undefined, { heartbeatMs: 25 });
    const ws = new WebSocket(dead.url, { origin: 'http://localhost:5173', autoPong: false });
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'join', room: createRoomId() }));
    await closed(ws);
    await eventually(() => dead.app.registry.size === 0);
  });
  it('closes with a going-away handshake and idempotent shutdown', async () => {
    const { client, app } = await setup();
    const c = await client();
    c.send({ type: 'join', room: createRoomId() });
    await eventually(() => app.registry.size === 1);
    const gone = closed(c.ws);
    const shutdown = app.close();
    expect(app.close()).toBe(shutdown);
    expect(await gone).toBe(1001);
    await shutdown;
    expect(app.registry.size).toBe(0);
  });
});

it('bounds shutdown even with incomplete HTTP requests', async () => {
  const { app } = await setup(undefined, { shutdownGraceMs: 30 });
  const socket = connect((app.server.address() as AddressInfo).port, '127.0.0.1');
  socket.on('error', () => {});
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n');
  const gone = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const start = Date.now();
  await app.close();
  await gone;
  expect(Date.now() - start).toBeLessThan(1500);
});
