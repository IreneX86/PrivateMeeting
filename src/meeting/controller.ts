import { MediaDevices } from '../media/devices';
import { SignalingClient } from '../signaling/client';
import { Peer } from '../webrtc/peer';
import { iceConfiguration, signalingUrl } from '../webrtc/config';
import type { ServerMessage } from '../../shared/protocol';
export type Phase =
  'preview' | 'joining' | 'waiting' | 'connecting' | 'connected' | 'interrupted' | 'ended' | 'full';
export interface MeetingState {
  phase: Phase;
  local: MediaStream | null;
  remote: MediaStream | null;
  mic: boolean;
  camera: boolean;
  sharing: boolean;
  acquiring: boolean;
  shareBusy: boolean;
  hasMic: boolean;
  hasCamera: boolean;
  previewed: boolean;
  notice: string;
  errors: string[];
}
export const initialState: MeetingState = {
  phase: 'preview',
  local: null,
  remote: null,
  mic: true,
  camera: true,
  sharing: false,
  acquiring: false,
  shareBusy: false,
  hasMic: false,
  hasCamera: false,
  previewed: false,
  notice: '',
  errors: [],
};
export class MeetingController {
  private state = { ...initialState };
  private media = new MediaDevices();
  private signaling?: SignalingClient;
  private peer?: Peer;
  private session?: string;
  private disposed = false;
  constructor(
    private room: string,
    private notify: (s: MeetingState) => void,
  ) {}
  private update(patch: Partial<MeetingState>) {
    if (!this.disposed) {
      this.state = { ...this.state, ...patch };
      this.notify(this.state);
    }
  }
  async preview() {
    if (this.state.acquiring || this.state.phase !== 'preview') return;
    this.update({ acquiring: true, errors: [] });
    const errors = await this.media.acquire();
    if (this.disposed) return;
    const stream = this.media.stream;
    for (const track of stream.getTracks()) {
      track.enabled = track.kind === 'audio' ? this.state.mic : this.state.camera;
      track.onended = () => {
        if (this.disposed) return;
        this.update({
          hasMic: stream.getAudioTracks().some((t) => t.readyState === 'live'),
          hasCamera: stream.getVideoTracks().some((t) => t.readyState === 'live'),
          notice: 'A media device disconnected. Leave and rejoin to select it again.',
        });
      };
    }
    this.update({
      acquiring: false,
      previewed: true,
      errors,
      local: new MediaStream(stream.getTracks()),
      hasMic: stream.getAudioTracks().length > 0,
      hasCamera: stream.getVideoTracks().length > 0,
    });
  }
  toggleMic() {
    const mic = !this.state.mic;
    this.media.stream.getAudioTracks().forEach((t) => {
      t.enabled = mic;
    });
    this.update({ mic });
  }
  toggleCamera() {
    const camera = !this.state.camera;
    this.media.stream.getVideoTracks().forEach((t) => {
      t.enabled = camera;
    });
    this.update({ camera });
  }
  join() {
    if (this.disposed || this.state.phase !== 'preview' || this.state.acquiring) return;
    try {
      const url = signalingUrl();
      iceConfiguration();
      this.update({ phase: 'joining', errors: [], notice: '' });
      this.signaling = new SignalingClient(
        url,
        this.room,
        (m) => this.message(m),
        () => this.fail('Signaling connection interrupted. Please rejoin the meeting.'),
      );
    } catch (error) {
      this.update({
        phase: 'preview',
        errors: [error instanceof Error ? error.message : 'Could not join the meeting.'],
      });
    }
  }
  private message(message: ServerMessage) {
    if (this.disposed) return;
    if (message.type === 'error') {
      this.disconnect();
      this.media.dispose();
      this.update({
        phase: message.code === 'full' ? 'full' : 'interrupted',
        errors: [message.message],
        sharing: false,
        local: null,
        remote: null,
      });
      return;
    }
    if (message.type === 'joined') this.update({ phase: 'waiting' });
    if (message.type === 'peer-left') {
      this.peer?.close();
      this.peer = undefined;
      this.session = undefined;
      this.update({
        phase: 'waiting',
        remote: null,
        notice: 'The other participant left. This room is ready for them to rejoin.',
      });
    }
    if (message.type === 'paired') {
      if (this.session === message.session) return;
      this.peer?.close();
      this.session = message.session;
      const session = message.session;
      this.update({ phase: 'connecting', remote: null, notice: '' });
      try {
        const peer = new Peer(
          iceConfiguration(),
          this.media.stream,
          this.media.screen?.getVideoTracks()[0] ?? this.media.stream.getVideoTracks()[0] ?? null,
          message.offerer,
          {
            signal: (payload) => {
              if (this.session === session) {
                try {
                  this.signaling?.send(session, payload);
                } catch (error) {
                  this.fail(String(error));
                }
              }
            },
            remote: (stream) => {
              if (this.session === session) this.update({ remote: stream });
            },
            state: (state) => {
              if (this.session !== session) return;
              if (state === 'connected') this.update({ phase: 'connected', notice: '' });
              else if (state === 'disconnected')
                this.update({
                  phase: 'connecting',
                  notice: 'Connection interrupted. Trying to recover…',
                });
            },
            error: (error) => {
              if (this.session === session)
                this.fail(
                  error instanceof Error
                    ? error.message
                    : 'The media connection failed. Please rejoin.',
                );
            },
          },
        );
        this.peer = peer;
        void peer.start();
      } catch (error) {
        this.fail(error instanceof Error ? error.message : 'Could not create a peer connection.');
      }
    }
    if (message.type === 'signal' && message.session === this.session)
      void this.peer?.receive(message.id, message.payload);
  }
  async toggleShare() {
    if (this.disposed || this.state.shareBusy) return;
    this.update({ shareBusy: true, notice: '' });
    try {
      if (this.state.sharing) {
        try {
          await this.restoreCamera();
        } catch {
          this.fail('Could not restore the camera. Please rejoin.');
        }
        return;
      }
      const track = await this.media.captureScreen();
      if (!track || this.disposed) return;
      track.onended = () => {
        void this.restoreCamera().catch(() =>
          this.fail('Could not restore the camera. Please rejoin.'),
        );
      };
      // If pairing happens during the picker, use the current peer on resolution.
      await this.peer?.replaceVideo(track);
      if (this.disposed) return;
      this.update({ sharing: true });
      if (track.readyState === 'ended') await this.restoreCamera();
    } catch (error) {
      this.media.stopScreen();
      this.update({ sharing: false });
      if (!(error instanceof Error && error.name === 'NotAllowedError'))
        this.update({
          notice: error instanceof Error ? error.message : 'Screen sharing could not start.',
        });
    } finally {
      this.update({ shareBusy: false });
    }
  }
  private async restoreCamera() {
    const camera = this.media.stream.getVideoTracks().find((t) => t.readyState === 'live') ?? null;
    this.media.stopScreen();
    this.update({ sharing: false, shareBusy: true });
    try {
      await this.peer?.replaceVideo(camera);
    } finally {
      this.update({ shareBusy: false });
    }
  }
  private fail(message: string) {
    if (this.disposed) return;
    this.disconnect();
    this.media.dispose();
    this.update({
      phase: 'interrupted',
      errors: [message],
      local: null,
      remote: null,
      sharing: false,
    });
  }
  private disconnect() {
    this.session = undefined;
    this.peer?.close();
    this.peer = undefined;
    this.signaling?.close();
    this.signaling = undefined;
  }
  leave() {
    this.disconnect();
    this.media.dispose();
    this.update({ phase: 'ended', local: null, remote: null, sharing: false });
  }
  dispose() {
    this.disposed = true;
    this.disconnect();
    this.media.dispose();
  }
}
