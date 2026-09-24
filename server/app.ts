import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '../shared/protocol.js';
import { RoomRegistry } from './rooms.js';
import { validateOrigins } from './config.js';
import { clientAddress, ConnectionLimits, TokenBucket } from './limits.js';
export interface ServerOptions {
  origins: string[];
  maxRooms?: number;
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  connectionsPerMinute?: number;
  trustedProxyIps?: string[];
  heartbeatMs?: number;
  admissionTimeoutMs?: number;
  shutdownGraceMs?: number;
}
export function createSignalingServer(options: ServerOptions) {
  const origins = new Set(validateOrigins(options.origins));
  const trusted = new Set(options.trustedProxyIps ?? []);
  const limits = new ConnectionLimits(
    options.maxConnectionsPerIp ?? 20,
    options.connectionsPerMinute ?? 60,
  );
  const registry = new RoomRegistry(options.maxRooms);
  const sockets = new Set<Socket>();
  let draining = false;
  let shutdown: Promise<void> | undefined;
  const server = createServer(
    { headersTimeout: 10000, requestTimeout: 15000, maxHeaderSize: 8192 },
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const healthy =
        !draining && req.url === '/health' && ['GET', 'HEAD'].includes(req.method ?? '');
      res.writeHead(draining ? 503 : healthy ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(
        req.method === 'HEAD' ? undefined : healthy ? '{"status":"ok"}' : '{"error":"unavailable"}',
      );
    },
  );
  server.maxConnections = (options.maxConnections ?? 2200) + 64;
  server.keepAliveTimeout = 5000;
  server.setTimeout(15000, (socket) => socket.destroy());
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {
      /* No request, address or payload logging. */
    });
    socket.once('close', () => sockets.delete(socket));
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    const reject = (status: string) =>
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
        socket.destroy(),
      );
    if (draining || wss.clients.size >= (options.maxConnections ?? 2200)) {
      reject('503 Service Unavailable');
      return;
    }
    const release = limits.acquire(clientAddress(req, trusted));
    if (!release) {
      reject('429 Too Many Requests');
      return;
    }
    socket.once('close', release);
    if (req.url !== '/signal' || !req.headers.origin || !origins.has(req.headers.origin)) {
      reject('403 Forbidden');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (ws) => {
    alive.add(ws);
    const messages = new TokenBucket(200, 25);
    const bytes = new TokenBucket(256 * 1024, 64 * 1024);
    const admissionTimeout = setTimeout(
      () => ws.close(1008, 'Join timeout'),
      options.admissionTimeoutMs ?? 10000,
    );
    admissionTimeout.unref();
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, binary) => {
      // A buffered frame after leave/rejection must never re-admit a closing socket.
      if (draining || ws.readyState !== WebSocket.OPEN) return;
      const size = Array.isArray(data)
        ? data.reduce((sum, chunk) => sum + chunk.length, 0)
        : data.byteLength;
      if (!messages.take() || !bytes.take(size)) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'rate-limit',
            message: 'Too many signaling messages. Please rejoin.',
          }),
        );
        ws.close(1008);
        return;
      }
      const message = binary ? null : parseClientMessage(data.toString());
      if (!message) {
        ws.send(
          JSON.stringify({ type: 'error', code: 'invalid', message: 'Invalid signaling request.' }),
        );
        ws.close(1008);
        return;
      }
      if (message.type === 'join') clearTimeout(admissionTimeout);
      registry.handle(ws, message);
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearTimeout(admissionTimeout);
      registry.remove(ws);
    });
  });
  const heartbeat = setInterval(() => {
    limits.sweep();
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      if (ws.readyState !== WebSocket.OPEN) continue;
      alive.delete(ws);
      ws.ping();
    }
  }, options.heartbeatMs ?? 15000);
  heartbeat.unref();
  const close = (): Promise<void> => {
    if (shutdown) return shutdown;
    draining = true;
    clearInterval(heartbeat);
    // Stop admissions first. Complete close handshakes, then force only stragglers.
    shutdown = new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
        for (const socket of sockets) socket.destroy();
      }, options.shutdownGraceMs ?? 5000);
      const httpClosed = new Promise<void>((done) => server.close(() => done()));
      for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
      const websocketClosed = new Promise<void>((done) => wss.close(() => done()));
      void Promise.all([httpClosed, websocketClosed]).then(() => {
        clearTimeout(deadline);
        limits.clear();
        resolve();
      });
    });
    return shutdown;
  };
  return { server, registry, close };
}
