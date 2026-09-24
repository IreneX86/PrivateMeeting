import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaDevices, mediaError } from '../src/media/devices';
class Stream {
  tracks: MediaStreamTrack[] = [];
  getTracks() {
    return this.tracks;
  }
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }
  removeTrack(track: MediaStreamTrack) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}
const track = (kind: string) =>
  ({ kind, readyState: 'live', stop: vi.fn(), onended: null }) as unknown as MediaStreamTrack;
beforeEach(() => {
  vi.stubGlobal('MediaStream', Stream);
  vi.stubGlobal('window', { isSecureContext: true });
});
afterEach(() => vi.unstubAllGlobals());
describe('media lifecycle', () => {
  it('stops late permission results after unmount rather than leaking capture', async () => {
    const pending: Array<(s: unknown) => void> = [];
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(() => new Promise((resolve) => pending.push(resolve))) },
    });
    const media = new MediaDevices();
    const start = media.acquire();
    media.dispose();
    const audio = track('audio'),
      video = track('video');
    pending[0]({ getTracks: () => [audio] });
    pending[1]({ getTracks: () => [video] });
    await start;
    expect(audio.stop).toHaveBeenCalled();
    expect(video.stop).toHaveBeenCalled();
    expect(media.stream.getTracks()).toHaveLength(0);
  });
  it('keeps an available microphone when the camera permission fails', async () => {
    const audio = track('audio');
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async (c: { audio: unknown }) => {
          if (c.audio) return { getTracks: () => [audio] };
          throw new DOMException('Denied', 'NotAllowedError');
        }),
      },
    });
    const media = new MediaDevices();
    const errors = await media.acquire();
    expect(media.stream.getTracks()).toEqual([audio]);
    expect(errors[0]).toContain('Camera permission denied');
    media.dispose();
  });
  it('stops a late screen picker result after leaving', async () => {
    let resolve!: (s: unknown) => void;
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: vi.fn(
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        ),
      },
    });
    const media = new MediaDevices();
    const capture = media.captureScreen();
    media.dispose();
    const screen = track('video');
    resolve({ getTracks: () => [screen] });
    expect(await capture).toBeNull();
    expect(screen.stop).toHaveBeenCalled();
  });
  it('describes permission and missing-device failures', () => {
    expect(mediaError(new DOMException('Denied', 'NotAllowedError'), 'Microphone')).toContain(
      'Microphone permission denied',
    );
    expect(mediaError(new DOMException('Missing', 'NotFoundError'), 'Camera')).toContain(
      'No camera found',
    );
  });
});
