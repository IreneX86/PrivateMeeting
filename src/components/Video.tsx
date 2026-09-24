import { useEffect, useRef, useState } from 'react';
export function Video({
  stream,
  muted = false,
  mirror = false,
  label,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    video.srcObject = stream;
    if (stream)
      void video
        .play()
        .then(() => {
          if (active) setBlocked(false);
        })
        .catch(() => {
          if (active) setBlocked(true);
        });
    return () => {
      active = false;
      video.srcObject = null;
    };
  }, [stream]);
  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
        className={mirror ? 'mirror' : ''}
      />
      {blocked && (
        <button
          className="play-button"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setBlocked(false))
              .catch(() => setBlocked(true));
          }}
        >
          Play {muted ? 'preview' : 'video & audio'}
        </button>
      )}
    </>
  );
}
