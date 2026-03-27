import { memo } from 'react';
import type { ReactNode } from 'react';
import './statusbar.css';

interface StatusBarProps {
  readonly left?: ReactNode;
  readonly center?: ReactNode;
  readonly right?: ReactNode;
}

export const StatusBar = memo(function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <div className="status-bar">
      {left && <div className="status-bar-left">{left}</div>}
      {center && (
        <>
          <div className="status-bar-sep" />
          <div className="status-bar-center">{center}</div>
        </>
      )}
      <div className="status-bar-right">{right}</div>
    </div>
  );
});

export function StatusBarLive({ label = 'Connected' }: { readonly label?: string }) {
  return (
    <span className="status-bar-live">
      <span className="status-bar-live-dot" />
      {label}
    </span>
  );
}
