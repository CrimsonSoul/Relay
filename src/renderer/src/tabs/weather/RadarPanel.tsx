import React from 'react';
import { TactileButton } from '../../components/TactileButton';
import type { Location } from './types';
import { getRadarUrl } from './utils';
import { useRadar } from './useRadar';

interface RadarPanelProps {
  location: Location | null;
}

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const { webviewRef, isLoading, handleRefresh } = useRadar(location);
  const supportsWebview = Boolean(window.api);
  const isValidLocation =
    location && !Number.isNaN(location.latitude) && !Number.isNaN(location.longitude);

  return (
    <div className="radar-panel-wrapper">
      <div className="radar-panel-container">
        {supportsWebview && isValidLocation ? (
          <>
            <TactileButton
              onClick={handleRefresh}
              title={isLoading ? 'Refreshing' : 'Refresh Radar'}
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
              ref={webviewRef as React.RefObject<Electron.WebviewTag>}
              key={`${location.latitude.toFixed(2)}-${location.longitude.toFixed(2)}`}
              src={getRadarUrl(location.latitude, location.longitude)}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
              className="radar-webview"
              partition="persist:weather"
              allowpopups={false}
            />
            <div className="webview-border-overlay" />
          </>
        ) : (
          <div className="radar-empty">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="radar-empty-icon"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div className="radar-empty-text">
              {supportsWebview
                ? 'Search for a city or enable location access to view radar'
                : 'Radar view is available only in the desktop app.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
