import { describe, expect, it } from 'vitest';
import { createRoomId, readRoute, roomUrl } from '../src/rooms';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';
import { iceConfiguration } from '../src/webrtc/config';
describe('room capabilities and routes', () => {
  it('creates 192-bit random room IDs with no collisions in a sample', () => {
    const ids = Array.from({ length: 1000 }, createRoomId);
    expect(ids.every((id) => /^[a-f0-9]{48}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(1000);
  });
  it('preserves the project base and never leaks query parameters', () => {
    const id = createRoomId();
    const url = roomUrl(id, 'https://example.github.io/PrivateMeeting/?secret=no#/');
    expect(url).toBe(`https://example.github.io/PrivateMeeting/#/room/${id}`);
    expect(readRoute(new URL(url).hash)).toEqual({ page: 'room', room: id });
    expect(readRoute('#/room/short')).toEqual({ page: 'invalid' });
    expect(readRoute('#/room/' + id + '/extra')).toEqual({ page: 'invalid' });
    expect(readRoute('')).toEqual({ page: 'home' });
  });
});
describe('untrusted signaling validation', () => {
  it('rejects malformed and non-signaling payloads', () => {
    for (const data of [
      'bad',
      'null',
      '[]',
      '{}',
      JSON.stringify({ type: 'join', room: 'guessable' }),
      JSON.stringify({
        type: 'signal',
        session: 's',
        id: 'i',
        payload: { kind: 'candidate', candidate: { candidate: 'a', sdpMLineIndex: -1 } },
      }),
    ])
      expect(parseClientMessage(data)).toBeNull();
    expect(parseServerMessage('{"type":"paired","session":"s","offerer":"yes"}')).toBeNull();
  });
  it('accepts a candidate before SDP and bounded SDP', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'signal',
          session: 's',
          id: 'i',
          payload: {
            kind: 'candidate',
            candidate: { candidate: 'candidate:123', sdpMid: '0', sdpMLineIndex: 0 },
          },
        }),
      ),
    ).not.toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'signal',
          session: 's',
          id: 'i',
          payload: { kind: 'description', description: { type: 'offer', sdp: 'x'.repeat(60001) } },
        }),
      ),
    ).toBeNull();
  });
});
describe('ICE configuration', () => {
  it('works with STUN alone and supports multiple TURN transports', () => {
    expect(iceConfiguration({}).iceServers).toHaveLength(1);
    const config = iceConfiguration({
      VITE_STUN_URL: '',
      VITE_TURN_URL: 'turn:relay.example:3478,turns:relay.example:5349',
      VITE_TURN_USERNAME: 'demo',
      VITE_TURN_CREDENTIAL: 'public-demo',
    });
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers![0].urls).toHaveLength(2);
  });
  it('rejects incomplete or non-ICE configuration', () => {
    expect(() => iceConfiguration({ VITE_TURN_URL: 'turn:example.com' })).toThrow();
    expect(() => iceConfiguration({ VITE_STUN_URL: 'https://example.com' })).toThrow();
  });
});
