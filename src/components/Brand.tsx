import { Video as VideoIcon } from 'lucide-react';
export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Private Meeting home">
      <span className="brand-mark">
        <VideoIcon size={21} />
      </span>
      private<span className="brand-light">meeting</span>
      <span className="brand-dot">.</span>
    </a>
  );
}
