import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronRight } from 'lucide-react';
import { readRoute } from './rooms';
import { Brand } from './components/Brand';
import { Landing } from './pages/Landing';
import { Room } from './pages/Room';
import './styles.css';
function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const route = readRoute(hash);
  if (route.page === 'home') return <Landing />;
  if (route.page === 'room') return <Room key={route.room} room={route.room} />;
  return (
    <div className="room-shell">
      <header className="site-header">
        <Brand />
      </header>
      <main className="terminal">
        <h1>This link needs another look.</h1>
        <p>The meeting link is incomplete or invalid. Ask the sender to copy it again.</p>
        <a className="primary" href="#/">
          Create a new meeting <ChevronRight size={18} />
        </a>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
