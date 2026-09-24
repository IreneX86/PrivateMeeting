import {
  ArrowRight,
  Expand,
  LockKeyhole,
  Mic,
  MonitorUp,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Users,
  Video as VideoIcon,
} from 'lucide-react';
import { createRoomId } from '../rooms';
import { Brand } from '../components/Brand';
import { Privacy } from '../components/Privacy';
export function Landing() {
  function create() {
    location.hash = `/room/${createRoomId()}`;
  }
  return (
    <div className="landing">
      <header className="site-header">
        <Brand />
        <span className="header-note">
          <span className="status-dot" /> Just you. And them.
        </span>
      </header>
      <main className="landing-main">
        <section className="hero-copy">
          <div className="eyebrow">
            <span /> A SPACE FOR TWO
          </div>
          <h1>
            Less noise.
            <br />
            More <em>connection.</em>
          </h1>
          <p className="hero-description">
            Start a private 1-to-1 video call.
            <br />
            No accounts. No downloads. Just a conversation.
          </p>
          <button className="primary create" onClick={create}>
            Create Meeting <ArrowRight size={19} />
          </button>
          <p className="under-button">
            <LockKeyhole size={13} /> A unique link. Share it with someone you trust.
          </p>
          <div className="features">
            <span>
              <Users size={17} /> Made for two
            </span>
            <span>
              <ShieldCheck size={17} /> Encrypted media
            </span>
            <span>
              <MonitorUp size={17} /> Screen sharing
            </span>
          </div>
        </section>
        <section className="hero-art" aria-label="Illustration of a private call for two">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="call-card">
            <div className="card-top">
              <span>
                <span className="status-dot" /> Room for a real conversation
              </span>
              <Expand size={14} />
            </div>
            <div className="abstract-person person-one">
              <div className="portrait-head" />
              <div className="portrait-body" />
              <span className="tile-label">
                <Mic size={12} /> You
              </span>
              <div className="mini-person">
                <div className="portrait-head" />
                <div className="portrait-body" />
                <span>Your person</span>
              </div>
            </div>
            <div className="art-controls">
              <span>
                <Mic size={18} />
              </span>
              <span>
                <VideoIcon size={18} />
              </span>
              <span>
                <MonitorUp size={18} />
              </span>
              <span className="art-hangup">
                <PhoneOff size={18} />
              </span>
            </div>
          </div>
          <div className="floating-note">
            <LockKeyhole size={16} />
            <div>
              A little more personal.<small>One link. Two people.</small>
            </div>
            <Sparkles size={16} />
          </div>
          <div className="art-caption">GOOD CONVERSATIONS NEED A LITTLE SPACE.</div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>A simpler way to be together.</span>
        <Privacy />
        <span>Built for the conversation.</span>
      </footer>
    </div>
  );
}
