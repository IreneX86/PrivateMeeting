import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage } from '../shared/protocol.js';
import { RoomRegistry } from './rooms.js';
export interface ServerOptions {
  origins: string[];
  maxRooms?: number;
  maxConnections?: number;
  heartbeatMs?: number;
}
export function createSignalingServer(options: ServerOptions) {
  const registry = new RoomRegistry(options.maxRooms);
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(req.url === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(req.url === '/health' ? '{"status":"ok"}' : '{"error":"not found"}');
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    if (
      req.url !== '/signal' ||
      !req.headers.origin ||
      !options.origins.includes(req.headers.origin)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (wss.clients.size >= (options.maxConnections ?? 2200)) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (ws) => {
    alive.add(ws);
    let tokens = 200,
      last = Date.now(),
      joined = false;
    const admissionTimeout = setTimeout(() => {
      if (!joined) ws.close(1008, 'Join timeout');
    }, 10000);
    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, binary) => {
      const now = Date.now();
      tokens = Math.min(200, tokens + (now - last) * 0.025);
      last = now;
      if (--tokens < 0) {
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
      if (message.type === 'join') {
        joined = true;
        clearTimeout(admissionTimeout);
      }
      registry.handle(ws, message);
    });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => {
      clearTimeout(admissionTimeout);
      registry.remove(ws);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, options.heartbeatMs ?? 15000);
  heartbeat.unref();
  const close = async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { server, registry, close };
}
