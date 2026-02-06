import React from 'react';
import type { Location } from './types';
import { getRadarUrl } from './utils';
import { useRadar } from './useRadar';

interface RadarPanelProps {
  location: Location | null;
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--app-surface)',
  borderRadius: '16px',
  overflow: 'hidden',
  position: 'relative',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  minHeight: '350px',
  transform: 'translateZ(0)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
};

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const { webviewRef } = useRadar(location);
  const isValidLocation =
    location && !Number.isNaN(location.latitude) && !Number.isNaN(location.longitude);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={containerStyle}>
        {isValidLocation ? (
          <>
            <webview
              ref={webviewRef as React.RefObject<Electron.WebviewTag>}
              key={`${location.latitude.toFixed(2)}-${location.longitude.toFixed(2)}`}
              src={getRadarUrl(location.latitude, location.longitude)}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
              style={{
                width: '100%',
                height: '100%',
                background: 'black',
              }}
              partition="persist:weather"
              allowpopups="false"
            />
            {/* Minimal overlay border only */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                pointerEvents: 'none',
                zIndex: 50,
              }}
            />
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--color-text-tertiary)',
              gap: '12px',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              style={{ opacity: 0.5 }}
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <div style={{ fontSize: '14px', maxWidth: '200px' }}>
              Search for a city or enable location access to view radar
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
