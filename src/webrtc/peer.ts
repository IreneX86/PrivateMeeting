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
  private seenCandidates = new Set<string>();
  private started = false;
  private videoQueue: Promise<void> = Promise.resolve();
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
      const audio = stream.getAudioTracks().find((t) => t.readyState === 'live');
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
      if (this.closed) return;
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
      if (this.closed) return;
      const ice = this.connection.iceConnectionState;
      if (ice === 'disconnected') {
        callbacks.state('disconnected');
        this.deadline();
      }
      if (
        (ice === 'connected' || ice === 'completed') &&
        this.connection.connectionState === 'connected'
      ) {
        clearTimeout(this.timer);
        callbacks.state('connected');
      }
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
      .catch(() => {
        if (!this.closed)
          this.callbacks.error(
            new Error('Could not negotiate the media connection. Please rejoin.'),
          );
      });
    return this.queue;
  }
  start() {
    if (!this.offerer || this.started || this.closed) return this.queue;
    this.started = true;
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
    if (payload.kind === 'candidate') {
      const c = payload.candidate;
      const key = JSON.stringify([
        c.candidate,
        c.sdpMid ?? null,
        c.sdpMLineIndex ?? null,
        c.usernameFragment ?? null,
      ]);
      if (this.seenCandidates.has(key)) return this.queue;
      if (this.seenCandidates.size >= 256) {
        this.callbacks.error(new Error('Too many ICE candidates. Please rejoin.'));
        return this.queue;
      }
      this.seenCandidates.add(key);
    }
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
          if (kind === 'video') await this.replaceVideo(this.outgoingVideo);
          else
            await transceiver.sender.replaceTrack(
              this.stream.getAudioTracks().find((t) => t.readyState === 'live') ?? null,
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
  replaceVideo(track: MediaStreamTrack | null): Promise<void> {
    this.outgoingVideo = track;
    // Serialize replacements, including native Stop sharing during negotiation.
    this.videoQueue = this.videoQueue
      .catch(() => {})
      .then(async () => {
        if (!this.closed) await this.video?.replaceTrack(this.outgoingVideo);
      });
    return this.videoQueue;
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.connection.ontrack = null;
    this.connection.onicecandidate = null;
    this.connection.onconnectionstatechange = null;
    this.connection.oniceconnectionstatechange = null;
    this.connection.close();
    this.remote.getTracks().forEach((t) => t.stop());
    this.candidates = [];
    this.seen.clear();
    this.seenCandidates.clear();
  }
}
