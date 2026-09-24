import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../shared/protocol';
import type { MeetingState } from '../src/meeting/controller';
const harness = vi.hoisted(() => ({
  message: undefined as ((message: ServerMessage) => void) | undefined,
  capture: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  peers: [] as Array<{
    replaceVideo: ReturnType<typeof vi.fn>;
    callbacks: { state: (state: string) => void; error: (error: Error) => void };
  }>,
}));
vi.mock('../src/webrtc/config', () => ({
  iceConfiguration: () => ({}),
  signalingUrl: () => 'wss://example.com/signal',
}));
vi.mock('../src/media/devices', () => ({
  MediaDevices: class {
    stream = { getAudioTracks: () => [], getVideoTracks: () => [] };
    screen = null;
    captureScreen = harness.capture;
    stopScreen = harness.stop;
    dispose = harness.dispose;
  },
}));
vi.mock('../src/signaling/client', () => ({
  SignalingClient: class {
    constructor(_url: string, _room: string, message: (m: ServerMessage) => void) {
      harness.message = message;
    }
    send() {}
    close() {}
  },
}));
vi.mock('../src/webrtc/peer', () => ({
  Peer: class {
    replaceVideo = vi.fn().mockResolvedValue(undefined);
    constructor(
      _config: object,
      _stream: object,
      _track: unknown,
      _offerer: boolean,
      public callbacks: { state: (state: string) => void; error: (error: Error) => void },
    ) {
      harness.peers.push(this);
    }
    start() {}
    close() {}
    receive() {}
  },
}));
import { MeetingController } from '../src/meeting/controller';
let controller: MeetingController;
let states: MeetingState[];
beforeEach(() => {
  harness.peers.length = 0;
  vi.clearAllMocks();
  states = [];
  controller = new MeetingController('a'.repeat(48), (s) => states.push(s));
  controller.join();
  harness.message!({ type: 'paired', session: 's', offerer: true });
});
afterEach(() => controller.dispose());
const screen = () => ({ kind: 'video', readyState: 'live', onended: null }) as MediaStreamTrack;
describe('meeting lifecycle regressions', () => {
  it('ignores a screen replacement rejection that arrives after leave', async () => {
    harness.capture.mockResolvedValue(screen());
    let reject!: (error: Error) => void;
    harness.peers[0].replaceVideo.mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const sharing = controller.toggleShare();
    await Promise.resolve();
    controller.leave();
    reject(new Error('Closed peer'));
    await sharing;
    expect(states.at(-1)?.phase).toBe('ended');
    expect(states.at(-1)?.sharing).toBe(false);
    expect(harness.dispose).toHaveBeenCalled();
  });
  it('restores the camera when native Stop sharing races with replacement', async () => {
    const track = screen();
    harness.capture.mockResolvedValue(track);
    let resolve!: () => void;
    harness.peers[0].replaceVideo.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const sharing = controller.toggleShare();
    await Promise.resolve();
    track.onended!(new Event('ended'));
    resolve();
    await sharing;
    await vi.waitFor(() => expect(states.at(-1)?.shareBusy).toBe(false));
    expect(states.at(-1)?.sharing).toBe(false);
    expect(harness.peers[0].replaceVideo).toHaveBeenLastCalledWith(null);
  });
  it('reconciles screen replacement against a new peer after the old one leaves', async () => {
    const track = screen();
    harness.capture.mockResolvedValue(track);
    let reject!: (error: Error) => void;
    harness.peers[0].replaceVideo.mockImplementationOnce(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        }),
    );
    const sharing = controller.toggleShare();
    await Promise.resolve();
    harness.message!({ type: 'peer-left' });
    harness.message!({ type: 'paired', session: 'new', offerer: true });
    reject(new Error('Old peer closed'));
    await sharing;
    expect(harness.peers[1].replaceVideo).toHaveBeenCalledWith(track);
    expect(states.at(-1)?.sharing).toBe(true);
  });
  it('distinguishes transient recovery and ignores stale peer callbacks', () => {
    const old = harness.peers[0];
    old.callbacks.state('connected');
    old.callbacks.state('disconnected');
    expect(states.at(-1)?.phase).toBe('reconnecting');
    old.callbacks.state('connected');
    expect(states.at(-1)?.phase).toBe('connected');
    harness.message!({ type: 'peer-left' });
    old.callbacks.error(new Error('stale'));
    expect(states.at(-1)?.phase).toBe('waiting');
  });
});
