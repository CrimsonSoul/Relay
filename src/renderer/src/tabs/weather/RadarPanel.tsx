import React from 'react';
import type { Location } from './types';
import { getRadarUrl } from './utils';
import { useRadar } from './useRadar';

interface RadarPanelProps {
  location: Location | null;
}

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const { webviewRef } = useRadar(location);
  const isValidLocation =
    location && !Number.isNaN(location.latitude) && !Number.isNaN(location.longitude);

  return (
    <div className="radar-panel-wrapper">
      <div className="radar-panel-container">
        {isValidLocation ? (
          <>
            <webview
              ref={webviewRef as React.RefObject<Electron.WebviewTag>}
              key={`${location.latitude.toFixed(2)}-${location.longitude.toFixed(2)}`}
              src={getRadarUrl(location.latitude, location.longitude)}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
              className="radar-webview"
              partition="persist:weather"
              allowpopups="false"
            />
            <div className="radar-overlay-border" />
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
              Search for a city or enable location access to view radar
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
