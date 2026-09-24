import type { Signal } from '../../shared/protocol';
interface PeerCallbacks {
  signal: (payload: Signal) => void;
  remote: (stream: MediaStream) => void;
  state: (state: RTCPeerConnectionState | 'checking') => void;
  error: (error: unknown) => void;
}
export class Peer {
  readonly connection: RTCPeerConnection;
  private video?: RTCRtpSender;
  private outgoingVideo: MediaStreamTrack | null;
  private remote = new MediaStream();
  private candidates: RTCIceCandidateInit[] = [];
  private seen = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    config: RTCConfiguration,
    private readonly stream: MediaStream,
    videoTrack: MediaStreamTrack | null,
    private readonly offerer: boolean,
    private readonly callbacks: PeerCallbacks,
  ) {
    this.connection = new RTCPeerConnection(config);
    this.outgoingVideo = videoTrack;
    // Only the offerer creates transceivers before SDP. The answerer must use
    // the offered transceivers; pre-creating its own can produce receive-only SDP.
    if (offerer) {
      const audio = stream.getAudioTracks()[0];
      this.connection.addTransceiver(audio ?? 'audio', {
        direction: 'sendrecv',
        streams: [stream],
      });
      this.video = this.connection.addTransceiver(videoTrack ?? 'video', {
        direction: 'sendrecv',
        streams: [stream],
      }).sender;
    }
    this.connection.onicecandidate = (event) => {
      if (event.candidate && !this.closed)
        callbacks.signal({ kind: 'candidate', candidate: event.candidate.toJSON() });
    };
    this.connection.ontrack = (event) => {
      if (!this.remote.getTracks().some((t) => t.id === event.track.id))
        this.remote.addTrack(event.track);
      callbacks.remote(this.remote);
    };
    this.connection.onconnectionstatechange = () => {
      if (this.closed) return;
      const state = this.connection.connectionState;
      callbacks.state(state);
      if (state === 'connected') clearTimeout(this.timer);
      if (state === 'failed')
        callbacks.error(
          new Error(
            'Connection interrupted. Rejoin the meeting; some networks require a TURN relay.',
          ),
        );
      if (state === 'disconnected') this.deadline();
    };
    this.connection.oniceconnectionstatechange = () => {
      if (this.connection.iceConnectionState === 'checking') callbacks.state('checking');
      if (this.connection.iceConnectionState === 'failed')
        callbacks.error(
          new Error(
            'Could not establish a media connection. Try another network or configure TURN.',
          ),
        );
    };
    this.deadline();
  }
  private deadline() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.closed && this.connection.connectionState !== 'connected')
        this.callbacks.error(
          new Error(
            'Connection timed out. Check your network and TURN configuration, then rejoin.',
          ),
        );
    }, 35000);
  }
  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue
      .then(async () => {
        if (!this.closed) await job();
      })
      .catch((error) => {
        if (!this.closed) this.callbacks.error(error);
      });
    return this.queue;
  }
  start() {
    if (!this.offerer) return Promise.resolve();
    return this.enqueue(async () => {
      const offer = await this.connection.createOffer();
      if (this.closed) return;
      await this.connection.setLocalDescription(offer);
      if (!this.closed)
        this.callbacks.signal({
          kind: 'description',
          description: { type: 'offer', sdp: this.connection.localDescription!.sdp },
        });
    });
  }
  receive(id: string, payload: Signal) {
    if (this.seen.has(id) || this.closed) return this.queue;
    if (this.seen.size >= 2048) {
      this.callbacks.error(new Error('Too many signaling messages. Rejoin the meeting.'));
      return this.queue;
    }
    this.seen.add(id);
    return this.enqueue(async () => {
      if (payload.kind === 'candidate') {
        if (this.connection.remoteDescription)
          await this.connection.addIceCandidate(payload.candidate);
        else if (this.candidates.length < 256) this.candidates.push(payload.candidate);
        return;
      }
      const description = payload.description;
      if (
        description.type === 'offer' &&
        (this.offerer ||
          this.connection.signalingState !== 'stable' ||
          this.connection.remoteDescription)
      )
        return;
      if (
        description.type === 'answer' &&
        (!this.offerer || this.connection.signalingState !== 'have-local-offer')
      )
        return;
      await this.connection.setRemoteDescription(new RTCSessionDescription(description));
      if (this.closed) return;
      for (const candidate of this.candidates.splice(0)) {
        if (this.closed) return;
        await this.connection.addIceCandidate(candidate);
      }
      if (description.type === 'offer') {
        for (const transceiver of this.connection.getTransceivers()) {
          if (this.closed) return;
          const kind = transceiver.receiver.track.kind;
          if (kind !== 'audio' && kind !== 'video') continue;
          transceiver.direction = 'sendrecv';
          transceiver.sender.setStreams(this.stream);
          if (kind === 'video') this.video = transceiver.sender;
          await transceiver.sender.replaceTrack(
            kind === 'video' ? this.outgoingVideo : (this.stream.getAudioTracks()[0] ?? null),
          );
        }
        if (this.closed) return;
        const answer = await this.connection.createAnswer();
        if (this.closed) return;
        await this.connection.setLocalDescription(answer);
        if (!this.closed)
          this.callbacks.signal({
            kind: 'description',
            description: { type: 'answer', sdp: this.connection.localDescription!.sdp },
          });
      }
    });
  }
  async replaceVideo(track: MediaStreamTrack | null) {
    this.outgoingVideo = track;
    if (!this.closed) await this.video?.replaceTrack(track);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.connection.close();
    this.remote.getTracks().forEach((t) => t.stop());
    this.candidates = [];
    this.seen.clear();
  }
}
