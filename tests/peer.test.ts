import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Peer } from '../src/webrtc/peer';
class FakeStream {
  getTracks() {
    return [];
  }
  getAudioTracks() {
    return [];
  }
  addTrack() {}
}
class FakeConnection {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  remoteDescription: unknown = null;
  localDescription: unknown = null;
  senders: Array<{ replaceTrack: ReturnType<typeof vi.fn>; setStreams: ReturnType<typeof vi.fn> }> =
    [];
  transceivers: Array<{
    sender: FakeConnection['senders'][number];
    receiver: { track: { kind: string } };
    direction: string;
  }> = [];
  addTransceiver(kind: string | MediaStreamTrack) {
    const sender = { replaceTrack: vi.fn().mockResolvedValue(undefined), setStreams: vi.fn() };
    this.senders.push(sender);
    const transceiver = {
      sender,
      receiver: { track: { kind: typeof kind === 'string' ? kind : kind.kind } },
      direction: 'recvonly',
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() {
    return this.transceivers;
  }
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'answer' });
  async setLocalDescription(d: { type: string }) {
    this.localDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: { type: string }) {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    if (d.type === 'offer') {
      this.addTransceiver('audio');
      this.addTransceiver('video');
    }
  }
  close = vi.fn();
}
beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('RTCPeerConnection', FakeConnection);
  vi.stubGlobal(
    'RTCSessionDescription',
    class {
      constructor(d: object) {
        Object.assign(this, d);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
function make(offerer = false) {
  const callbacks = { signal: vi.fn(), remote: vi.fn(), state: vi.fn(), error: vi.fn() };
  const peer = new Peer({}, new MediaStream(), null, offerer, callbacks);
  return { peer, callbacks, pc: peer.connection as unknown as FakeConnection };
}
describe('peer negotiation', () => {
  it('queues early ICE, answers once and ignores duplicate message IDs', async () => {
    const { peer, pc, callbacks } = make();
    const candidate = { kind: 'candidate' as const, candidate: { candidate: 'c', sdpMid: '0' } };
    await peer.receive('ice', candidate);
    expect(pc.addIceCandidate).not.toHaveBeenCalled();
    await peer.receive('offer', {
      kind: 'description',
      description: { type: 'offer', sdp: 'v=0' },
    });
    await peer.receive('ice', candidate);
    await peer.receive('offer', {
      kind: 'description',
      description: { type: 'offer', sdp: 'v=0' },
    });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    expect(pc.createAnswer).toHaveBeenCalledTimes(1);
    expect(callbacks.signal).toHaveBeenCalledWith({
      kind: 'description',
      description: { type: 'answer', sdp: 'answer' },
    });
    peer.close();
  });
  it('uses deterministic offer ownership and swaps tracks without negotiation', async () => {
    const { peer, pc } = make(true);
    await peer.start();
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
    await peer.receive('unexpected', {
      kind: 'description',
      description: { type: 'offer', sdp: 'bad' },
    });
    expect(pc.createAnswer).not.toHaveBeenCalled();
    const screen = {} as MediaStreamTrack;
    await peer.replaceVideo(screen);
    await peer.replaceVideo(null);
    expect(pc.senders[1].replaceTrack).toHaveBeenNthCalledWith(1, screen);
    expect(pc.senders[1].replaceTrack).toHaveBeenNthCalledWith(2, null);
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
    peer.close();
  });
  it('attaches answerer tracks to offered transceivers, including a screen selected before SDP', async () => {
    const { peer, pc, callbacks } = make(false);
    expect(pc.senders).toHaveLength(0);
    const screen = { kind: 'video' } as MediaStreamTrack;
    await peer.replaceVideo(screen);
    await peer.receive('offer', {
      kind: 'description',
      description: { type: 'offer', sdp: 'v=0' },
    });
    expect(pc.senders).toHaveLength(2);
    expect(pc.senders[1].replaceTrack).toHaveBeenCalledWith(screen);
    expect(pc.senders[0].replaceTrack).toHaveBeenCalledWith(null);
    expect(pc.transceivers.every((t) => t.direction === 'sendrecv')).toBe(true);
    expect(pc.createOffer).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    peer.close();
  });
  it('ignores queued work after close', async () => {
    const { peer, pc, callbacks } = make();
    peer.close();
    await peer.receive('offer', {
      kind: 'description',
      description: { type: 'offer', sdp: 'v=0' },
    });
    expect(pc.createAnswer).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });
});
