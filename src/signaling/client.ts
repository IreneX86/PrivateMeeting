import { parseServerMessage, type ServerMessage, type Signal } from '../../shared/protocol';
export class SignalingClient {
  private socket: WebSocket;
  private closed = false;
  private timer: ReturnType<typeof setTimeout>;
  constructor(
    url: string,
    room: string,
    onMessage: (m: ServerMessage) => void,
    onClose: () => void,
  ) {
    this.socket = new WebSocket(url);
    this.timer = setTimeout(() => {
      if (!this.closed) {
        this.close();
        onClose();
      }
    }, 12000);
    this.socket.onopen = () => this.socket.send(JSON.stringify({ type: 'join', room }));
    this.socket.onmessage = (event) => {
      if (this.closed || typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === 'joined' || message.type === 'error') clearTimeout(this.timer);
      onMessage(message);
    };
    this.socket.onclose = () => {
      clearTimeout(this.timer);
      if (!this.closed) onClose();
    };
    this.socket.onerror = () => {
      /* close or the deadline produces one actionable UI error. */
    };
  }
  send(session: string, payload: Signal) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN)
      throw new Error('The signaling connection was lost. Please rejoin.');
    this.socket.send(JSON.stringify({ type: 'signal', session, id: crypto.randomUUID(), payload }));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    if (this.socket.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'leave' }));
    this.socket.close();
  }
}
