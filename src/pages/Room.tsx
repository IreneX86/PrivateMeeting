import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Link,
  LockKeyhole,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Users,
  Video as VideoIcon,
  VideoOff,
  X,
} from 'lucide-react';
import { roomUrl } from '../rooms';
import { MeetingController, initialState } from '../meeting/controller';
import { Control } from '../components/Control';
import { Video } from '../components/Video';
import { Brand } from '../components/Brand';
import { Privacy } from '../components/Privacy';
export function Room({ room }: { room: string }) {
  const [state, setState] = useState(initialState);
  const [name, setName] = useState('');
  const [copyState, setCopyState] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<MeetingController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setState({ ...initialState });
    const instance = new MeetingController(room, setState);
    controller.current = instance;
    const exit = () => instance.dispose();
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((n) => n + 1);
    };
    window.addEventListener('pagehide', exit);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', exit);
      window.removeEventListener('pageshow', restore);
      instance.dispose();
      clearTimeout(copyTimer.current);
    };
  }, [room, attempt]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(roomUrl(room));
      setCopyState('Link copied');
    } catch {
      setShowLink(true);
      setCopyState('Copy the link below');
    }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState(''), 3500);
  }
  const terminal = ['ended', 'full', 'interrupted'].includes(state.phase);
  const prejoin = state.phase === 'preview';
  const title =
    state.phase === 'connected'
      ? 'Connected'
      : state.phase === 'reconnecting'
        ? 'Reconnecting…'
        : state.phase === 'waiting'
          ? 'Waiting for another participant...'
          : state.phase === 'joining'
            ? 'Joining meeting…'
            : 'Connecting...';
  const localVisible = state.camera && state.hasCamera;
  const micButton = (
    <Control
      caption="Mic"
      label={state.mic ? 'Mute microphone' : 'Unmute microphone'}
      active={!state.mic}
      disabled={!state.hasMic}
      onClick={() => controller.current?.toggleMic()}
    >
      {state.mic ? <Mic /> : <MicOff />}
    </Control>
  );
  const cameraButton = (
    <Control
      caption="Camera"
      label={state.camera ? 'Turn camera off' : 'Turn camera on'}
      active={!state.camera}
      disabled={!state.hasCamera}
      onClick={() => controller.current?.toggleCamera()}
    >
      {state.camera ? <VideoIcon /> : <VideoOff />}
    </Control>
  );
  return (
    <div className="room-shell">
      <header className="site-header">
        <Brand />
        <div className="room-header-right">
          <span className="room-badge">
            <LockKeyhole size={13} /> Private room
          </span>
          <button className="text-button" onClick={() => void copy()}>
            <Link size={16} />
            <span>{copyState || 'Copy invite link'}</span>
          </button>
        </div>
      </header>
      {showLink && (
        <div className="link-fallback">
          <label>
            Meeting link
            <input readOnly value={roomUrl(room)} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button aria-label="Close meeting link" onClick={() => setShowLink(false)}>
            <X />
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {copyState}
      </span>
      {terminal ? (
        <main className="terminal">
          <div className="terminal-icon">
            {state.phase === 'ended' ? <Check /> : state.phase === 'full' ? <Users /> : <Link />}
          </div>
          <div className="eyebrow">PRIVATE MEETING</div>
          <h1>
            {state.phase === 'ended'
              ? 'Until next time.'
              : state.phase === 'full'
                ? 'Meeting room is full.'
                : 'Connection failed'}
          </h1>
          <p>
            {state.phase === 'ended'
              ? 'Meeting ended. Your camera and microphone are off.'
              : state.phase === 'full'
                ? 'This space is for two. Try again after someone leaves.'
                : state.errors.join(' ')}
          </p>
          <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            {state.phase === 'ended' ? 'Rejoin meeting' : 'Try again'}
            <ArrowRight size={18} />
          </button>
          <a className="quiet-link" href="#/">
            Back to home
          </a>
        </main>
      ) : prejoin ? (
        <main className="prejoin">
          <section className="preview-side">
            <div className="preview-video">
              <Video stream={state.local} muted mirror label="Your camera preview" />
              {!localVisible && (
                <div className="video-placeholder">
                  <div className="avatar">
                    {name.trim().slice(0, 1).toUpperCase() || <VideoOff size={30} />}
                  </div>
                  <h3>{state.previewed ? 'Camera is off' : 'Your space, your pace.'}</h3>
                  <p>
                    {state.previewed
                      ? 'You can join with your camera off.'
                      : 'Check your camera and microphone before you join.'}
                  </p>
                  {!state.previewed && (
                    <button
                      className="secondary"
                      disabled={state.acquiring}
                      onClick={() => void controller.current?.preview()}
                    >
                      {state.acquiring ? 'Requesting access…' : 'Enable camera & microphone'}
                    </button>
                  )}
                </div>
              )}
              <span className="tile-label">{name.trim() || 'You'} · Preview</span>
              <div className="preview-controls">
                {micButton}
                {cameraButton}
              </div>
            </div>
            <p className="preview-caption">
              <LockKeyhole size={13} /> This preview is only visible to you.
            </p>
          </section>
          <section className="join-side">
            <div className="eyebrow">
              <span /> YOUR MEETING IS READY
            </div>
            <h1>
              A little space <br />
              for <em>you two.</em>
            </h1>
            <p>
              Make yourself comfortable. <br />
              The conversation starts when you join.
            </p>
            <label className="name-label" htmlFor="name">
              What should we call you? <span>Optional</span>
            </label>
            <input
              id="name"
              className="name-input"
              placeholder="Your name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <small className="local-note">Only labels your own preview. Stays in this tab.</small>
            <button
              className="primary join-button"
              disabled={state.acquiring}
              onClick={() => controller.current?.join()}
            >
              Join Meeting <ArrowRight size={19} />
            </button>
            {state.previewed && (!state.hasCamera || !state.hasMic) && (
              <button
                className="text-button retry"
                disabled={state.acquiring}
                onClick={() => void controller.current?.preview()}
              >
                Retry camera & microphone
              </button>
            )}
            {!state.previewed && (
              <small className="local-note">
                You can also join without a camera or microphone.
              </small>
            )}
            <div className="invite-reminder">
              <span className="invite-icon">
                <Link size={18} />
              </span>
              <div>
                Better with your person.<small>Share the meeting link to invite them.</small>
              </div>
              <button aria-label="Copy meeting link" onClick={() => void copy()}>
                {copyState ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <div className="messages" role="alert">
              {state.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className="in-call">
          <div className="call-meta">
            <span className="connection-status">
              <span className={`status-dot ${state.phase !== 'connected' ? 'pending' : ''}`} />
              <span role="status">{title}</span>
            </span>
            <span className="encrypted-label">
              <ShieldCheck size={14} /> Encrypted WebRTC media
            </span>
          </div>
          <section className="remote-stage">
            <Video stream={state.remote} label="Other participant's video" />
            {state.phase !== 'connected' && (
              <div className="waiting-state">
                <div className="waiting-orb">
                  <Users size={32} />
                </div>
                <h1>
                  {state.phase === 'waiting'
                    ? 'A space worth sharing.'
                    : 'Finding your connection.'}
                </h1>
                <p>
                  {state.phase === 'waiting'
                    ? 'Your person will appear here when they join.'
                    : 'Establishing your encrypted media connection…'}
                </p>
                {state.phase === 'waiting' && (
                  <button className="secondary" onClick={() => void copy()}>
                    <Link size={16} />
                    {copyState || 'Copy meeting link'}
                  </button>
                )}
              </div>
            )}
            {state.phase === 'connected' && (
              <span className="tile-label remote-label">Your person</span>
            )}
            <div className="local-tile">
              <Video stream={state.local} muted mirror label="Your video" />
              {!localVisible && (
                <div className="local-avatar">{name.trim().slice(0, 1).toUpperCase() || 'Y'}</div>
              )}
              <span className="tile-label">
                {!state.mic && <MicOff size={12} />} {name.trim() || 'You'}
              </span>
            </div>
            {state.sharing && (
              <div className="sharing-banner">
                <MonitorUp size={15} /> Your screen is being shared
                <button onClick={() => void controller.current?.toggleShare()}>Stop sharing</button>
              </div>
            )}
          </section>
          <div className="call-notice" role="status">
            {state.notice}
          </div>
          <nav className="call-controls" aria-label="Meeting controls">
            {micButton}
            {cameraButton}
            <span className="control-divider" />
            <Control
              label={state.sharing ? 'Stop sharing' : 'Share screen'}
              active={state.sharing}
              disabled={state.shareBusy}
              onClick={() => void controller.current?.toggleShare()}
            >
              <MonitorUp />
            </Control>
            <Control label={copyState ? 'Link copied' : 'Copy link'} onClick={() => void copy()}>
              {copyState ? <Check /> : <Link />}
            </Control>
            <span className="control-divider" />
            <Control
              caption="Leave"
              label="Leave meeting"
              danger
              onClick={() => controller.current?.leave()}
            >
              <PhoneOff />
            </Control>
          </nav>
        </main>
      )}
      <footer className="room-footer">
        <span>
          <Users size={13} /> Two people. One conversation.
        </span>
        <Privacy />
      </footer>
    </div>
  );
}
