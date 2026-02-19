import React, { useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { TactileButton } from '../components/TactileButton';

const RADAR_URL = 'https://cw-intra-web/CWDashboard/Home/Radar';

export const RadarTab: React.FC = () => {
  const webviewRef = useRef<WebviewTag>(null);
  const [isLoading, setIsLoading] = useState(false);
  const supportsWebview = Boolean(window.api);

  const handleRefresh = () => {
    setIsLoading(true);
    webviewRef.current?.reloadIgnoringCache();
  };

  const handleLoadStop = () => {
    setIsLoading(false);
  };

  React.useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    webview.addEventListener('did-stop-loading', handleLoadStop);
    return () => {
      webview.removeEventListener('did-stop-loading', handleLoadStop);
    };
  }, []);

  if (!supportsWebview) {
    return (
      <div className="tab-layout tab-layout--flush">
        <div className="tab-fallback webview-unavailable">
          <div className="tab-fallback-error-icon">ℹ️</div>
          <div className="tab-fallback-message">Radar is available in the desktop app only</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-layout tab-layout--flush">
      <div className="webview-container">
        <div className="webview-border-overlay" />
        <TactileButton
          onClick={handleRefresh}
          title={isLoading ? 'Refreshing' : 'Refresh'}
          className="radar-refresh-btn"
          icon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={isLoading ? 'animate-spin' : ''}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          }
        />
        <webview
          ref={webviewRef}
          src={RADAR_URL}
          partition="persist:dispatcher-radar"
          title="Dispatcher Radar"
          webpreferences="contextIsolation=yes, nodeIntegration=no"
          className="webview-frame"
        />
      </div>
    </div>
  );
};
