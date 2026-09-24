import type { ReactNode } from 'react';
export function Control({
  label,
  children,
  caption,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  label: string;
  caption?: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`control ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={danger ? undefined : active}
      disabled={disabled}
    >
      {children}
      <span>{caption ?? label}</span>
    </button>
  );
}
