import { describe, expect, it } from 'vitest';
import { createRoomId, readRoute, roomUrl } from '../src/rooms';
import { parseClientMessage, parseServerMessage } from '../shared/protocol';
import { iceConfiguration, signalingUrl } from '../src/webrtc/config';
describe('room capabilities and routes', () => {
  it('creates 192-bit random room IDs with no collisions in a sample', () => {
    const ids = Array.from({ length: 1000 }, createRoomId);
    expect(ids.every((id) => /^[a-f0-9]{48}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(1000);
  });
  it('preserves the project base and never leaks query parameters', () => {
    const id = createRoomId();
    const url = roomUrl(id, 'https://irenex86.github.io/PrivateMeeting/?secret=no#/');
    expect(url).toBe(`https://irenex86.github.io/PrivateMeeting/#/room/${id}`);
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
      VITE_STUN_URLS: '',
      VITE_TURN_URL: 'turn:relay.example:3478,turns:relay.example:5349',
      VITE_TURN_USERNAME: 'demo',
      VITE_TURN_CREDENTIAL: 'public-demo',
    });
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers![0].urls).toHaveLength(2);
  });
  it('rejects incomplete or non-ICE configuration', () => {
    expect(() => iceConfiguration({ VITE_TURN_URL: 'turn:example.com' })).toThrow();
    expect(() => iceConfiguration({ VITE_STUN_URLS: 'https://example.com' })).toThrow();
  });
});

describe('production protocol/config regressions', () => {
  it('strips unrelated data and rejects coerced SDP types, empty IDs and oversized room IDs', () => {
    const signal = {
      type: 'signal',
      session: 's',
      id: 'i',
      secret: 'discard',
      payload: {
        kind: 'description',
        description: { type: 'offer', sdp: 'v=0', extra: 'discard' },
        extra: 'discard',
      },
    };
    expect(parseClientMessage(JSON.stringify(signal))).toEqual({
      type: 'signal',
      session: 's',
      id: 'i',
      payload: { kind: 'description', description: { type: 'offer', sdp: 'v=0' } },
    });
    expect(parseClientMessage(JSON.stringify({ ...signal, id: '' }))).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          ...signal,
          payload: { kind: 'description', description: { type: ['offer'], sdp: 'v=0' } },
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: 'join', room: 'a'.repeat(10000) })),
    ).toBeNull();
  });
  it('supports plural STUN URLs with a legacy fallback and explicit empty configuration', () => {
    expect(
      iceConfiguration({ VITE_STUN_URLS: 'stun:a.example,stun:b.example' }).iceServers![0].urls,
    ).toEqual(['stun:a.example', 'stun:b.example']);
    expect(
      iceConfiguration({ VITE_STUN_URLS: '', VITE_STUN_URL: 'stun:legacy.example' }).iceServers,
    ).toEqual([]);
    expect(iceConfiguration({ VITE_STUN_URL: 'stun:legacy.example' }).iceServers![0].urls).toEqual([
      'stun:legacy.example',
    ]);
    expect(iceConfiguration({}).iceTransportPolicy).toBe('all');
  });
  it('rejects insecure, credential-bearing or incorrect production signaling URLs', () => {
    for (const value of [
      'ws://example.com/signal',
      'wss://user:secret@example.com/signal',
      'wss://example.com/signal?token=secret',
      'wss://example.com/wrong',
      'invalid',
    ]) {
      expect(() => signalingUrl({ VITE_SIGNALING_URL: value }, 'https:')).toThrow();
    }
    expect(signalingUrl({ VITE_SIGNALING_URL: 'wss://example.com/signal' }, 'https:')).toBe(
      'wss://example.com/signal',
    );
  });
});
