import { ShieldCheck } from 'lucide-react';
export function Privacy() {
  return (
    <details className="privacy">
      <summary>
        <ShieldCheck size={14} /> A note on privacy
      </summary>
      <p>
        Calls use encrypted WebRTC media, directly between browsers when possible. A TURN relay may
        carry encrypted media on restrictive networks. Signaling exchanges connection details only.
        No recording, accounts, or analytics. Your peer and network providers may see connection
        metadata; this is not an anonymity service. Anyone with your link can take an available
        seat.
      </p>
    </details>
  );
}
