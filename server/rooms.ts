import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
interface Member {
  socket: WebSocket;
  room?: string;
}
interface Room {
  members: Member[];
  session?: string;
}
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private members = new Map<WebSocket, Member>();
  constructor(private readonly maxRooms = 1000) {}
  get size() {
    return this.rooms.size;
  }
  private send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) {
      socket.close(1013, 'Slow connection');
      return;
    }
    socket.send(JSON.stringify(message));
  }
  handle(socket: WebSocket, message: ClientMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (message.type === 'leave') {
      this.remove(socket);
      socket.close(1000);
      return;
    }
    if (message.type === 'join') {
      if (this.members.has(socket)) return; // Idempotent admission, one room per socket.
      let room = this.rooms.get(message.room);
      if (room && room.members.length >= 2) {
        this.send(socket, { type: 'error', code: 'full', message: 'Meeting room is full.' });
        socket.close(1008);
        return;
      }
      if (!room) {
        if (this.rooms.size >= this.maxRooms) {
          this.send(socket, {
            type: 'error',
            code: 'unavailable',
            message: 'The meeting service is busy. Please try again later.',
          });
          socket.close(1013);
          return;
        }
        room = { members: [] };
        this.rooms.set(message.room, room);
      }
      const member = { socket, room: message.room };
      room.members.push(member);
      this.members.set(socket, member);
      this.send(socket, { type: 'joined' });
      if (room.members.length === 2) {
        room.session = randomUUID();
        room.members.forEach((m, i) =>
          this.send(m.socket, { type: 'paired', session: room.session!, offerer: i === 0 }),
        );
      }
      return;
    }
    const member = this.members.get(socket);
    const room = member?.room ? this.rooms.get(member.room) : undefined;
    if (!room || room.members.length !== 2 || message.session !== room.session) return;
    if (message.payload.kind === 'description') {
      const isOfferer = room.members[0].socket === socket;
      if ((message.payload.description.type === 'offer') !== isOfferer) return;
    }
    const other = room.members.find((m) => m.socket !== socket);
    if (other) this.send(other.socket, message);
  }
  remove(socket: WebSocket) {
    const member = this.members.get(socket);
    this.members.delete(socket);
    if (!member?.room) return;
    const room = this.rooms.get(member.room);
    if (!room) return;
    room.members = room.members.filter((m) => m.socket !== socket);
    room.session = undefined;
    if (!room.members.length) this.rooms.delete(member.room);
    else this.send(room.members[0].socket, { type: 'peer-left' });
  }
}
