import React, { useRef, useState } from 'react';
import type { WebviewTag } from 'electron';
import { TactileButton } from '../components/TactileButton';
import { CollapsibleHeader } from '../components/CollapsibleHeader';

const RADAR_URL = 'https://cw-intra-web/CWDashboard/Home/Radar';

export const RadarTab: React.FC = () => {
  const webviewRef = useRef<WebviewTag>(null);
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 32px',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <CollapsibleHeader
        title="Dispatcher Radar"
        subtitle="Live CW intra-web monitoring"
        isCollapsed={true}
      >
        <TactileButton
          onClick={handleRefresh}
          title={isLoading ? 'Refreshing' : 'Refresh'}
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
              className={isLoading ? 'spin' : ''}
              style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }}
            >
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          }
        />
      </CollapsibleHeader>

      {/* Webview Container - Full Bleed */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          background: 'black',
          overflow: 'hidden',
          borderRadius: '16px',
          // Force the GPU to clip the webview using a mask-image hack
          WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='16' ry='16' fill='white' /%3E%3C/svg%3E")`,
          maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='16' ry='16' fill='white' /%3E%3C/svg%3E")`,
          transform: 'translateZ(0)',
        }}
      >
        {/* 
           CRITICAL: Border Overlay (The "Choke")
           We use a border + a tiny box-shadow to "thicken" the mask 
           and ensure it perfectly covers the aliased edges of the webview.
        */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '16px',
            border: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', // Extra sub-pixel choke
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />

        <webview
          ref={webviewRef}
          src={RADAR_URL}
          partition="persist:dispatcher-radar"
          title="Dispatcher Radar"
          webpreferences="contextIsolation=yes, nodeIntegration=no"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'transparent', // Prevent white bleed
          }}
        />
      </div>
    </div>
  );
};
