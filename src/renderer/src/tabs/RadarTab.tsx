import React, { useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { TactileButton } from '../components/TactileButton';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';

export const RADAR_URL_KEY = 'radar_url';

export const RadarTab: React.FC = () => {
  const webviewRef = useRef<WebviewTag>(null);
  const [isLoading, setIsLoading] = useState(false);
  const supportsWebview = Boolean(globalThis.api);
  const radarUrl = secureStorage.getItemSync<string>(RADAR_URL_KEY, '');

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

  // Register the stored radar URL with the main process security allowlist on mount.
  React.useEffect(() => {
    if (radarUrl) {
      globalThis.api?.registerRadarUrl(radarUrl)?.catch((error_) => {
        // Non-fatal: radar webview still renders; allowlist sync can retry later.
        loggers.weather.warn('[RadarTab] Failed to register radar URL', { error: error_ });
      });
    }
  }, [radarUrl]);

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

  if (!radarUrl) {
    return (
      <div className="tab-layout tab-layout--flush">
        <div className="tab-fallback webview-unavailable">
          <div className="tab-fallback-error-icon">⚙️</div>
          <div className="tab-fallback-message">
            No Radar URL configured. Add one in Settings to enable this tab.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-layout tab-layout--flush">
      <div className="webview-container">
        <div className="webview-border-overlay" />
        <TactileButton
          variant="ghost"
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
          src={radarUrl}
          title="Dispatcher Radar"
          className="webview-frame"
        />
      </div>
    </div>
  );
};
