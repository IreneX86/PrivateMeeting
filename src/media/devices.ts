export function mediaError(error: unknown, kind: 'Camera' | 'Microphone'): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `${kind} permission denied. Allow access in your browser settings and try again.`;
  if (name === 'NotFoundError')
    return `No ${kind.toLowerCase()} found. You can still join without it.`;
  if (name === 'NotReadableError')
    return `${kind} is busy or unavailable. Close other apps using it and try again.`;
  return `${kind} could not start. Check your device and browser permissions.`;
}
export class MediaDevices {
  stream = new MediaStream();
  screen: MediaStream | null = null;
  private disposed = false;
  private acquiring = false;
  async acquire(): Promise<string[]> {
    if (this.acquiring || this.disposed) return [];
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      return ['Camera and microphone need HTTPS or localhost and a supported browser.'];
    this.stream
      .getTracks()
      .filter((track) => track.readyState === 'ended')
      .forEach((track) => this.stream.removeTrack(track));
    this.acquiring = true;
    try {
      const results = await Promise.all(
        (['audio', 'video'] as const).map(async (kind) => {
          if (this.stream.getTracks().some((t) => t.kind === kind && t.readyState === 'live'))
            return '';
          try {
            const stream = await navigator.mediaDevices.getUserMedia(
              kind === 'audio'
                ? { audio: { echoCancellation: true, noiseSuppression: true }, video: false }
                : {
                    audio: false,
                    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                  },
            );
            if (this.disposed) stream.getTracks().forEach((t) => t.stop());
            else stream.getTracks().forEach((t) => this.stream.addTrack(t));
            return '';
          } catch (error) {
            return mediaError(error, kind === 'audio' ? 'Microphone' : 'Camera');
          }
        }),
      );
      return results.filter(Boolean);
    } finally {
      this.acquiring = false;
    }
  }
  async captureScreen(): Promise<MediaStreamTrack | null> {
    if (!navigator.mediaDevices?.getDisplayMedia)
      throw new Error('Screen sharing is not supported in this browser. Try a desktop browser.');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    this.screen = stream;
    return stream.getVideoTracks()[0] ?? null;
  }
  stopScreen() {
    this.screen?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.screen = null;
  }
  dispose() {
    this.disposed = true;
    this.stopScreen();
    this.stream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
  }
}
