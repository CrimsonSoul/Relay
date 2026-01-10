import React from "react";
import { Tooltip } from "../../components/Tooltip";
import type { Location } from "./types";
import { getRadarUrl } from "./utils";
import { useRadar } from "./useRadar";

interface RadarPanelProps { location: Location | null }

const ExternalViewButton: React.FC<{ location: Location }> = ({ location }) => (
  <Tooltip content="Open radar in browser for a larger view" position="top">
    <button onClick={() => globalThis.window.api?.openExternal?.(getRadarUrl(location.latitude, location.longitude))}
      style={{ position: "absolute", bottom: "8px", left: "8px", background: "rgba(0, 0, 0, 0.6)", padding: "6px 12px", borderRadius: "12px", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255, 255, 255, 0.15)", display: "flex", alignItems: "center", gap: "8px", color: "#ffffff", textDecoration: "none", fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em", cursor: "pointer", zIndex: 30, transition: "all 0.2s ease", boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0, 0, 0, 0.8)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)"; e.currentTarget.style.transform = "translateY(0)"; }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14L21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
      View Larger Map
    </button>
  </Tooltip>
);

const containerStyle: React.CSSProperties = { 
  flex: 1, 
  background: "#0F1117", // Slightly lighter than black to differentiate from 'dead' webview
  borderRadius: "12px", 
  overflow: "hidden", 
  position: "relative", 
  border: "var(--border-subtle)", 
  minHeight: "350px", 
  transform: 'translateZ(0)' 
};

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const { webviewRef, reload } = useRadar(location);
  const isValidLocation = location && !isNaN(location.latitude) && !isNaN(location.longitude);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={containerStyle}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '12px', border: '1.5px solid var(--color-bg-app)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', pointerEvents: 'none', zIndex: 50 }} />
        {isValidLocation ? (
          <>
            {/* eslint-disable react/no-unknown-property */}
            <webview 
              ref={webviewRef as any} 
              key={`${location.latitude.toFixed(2)}-${location.longitude.toFixed(2)}`} 
              src={getRadarUrl(location.latitude, location.longitude)} 
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
              style={{ width: "100%", height: "100%", background: "transparent" }} 
              partition="persist:weather" 
              allowpopups="true"
            />
            {/* eslint-enable react/no-unknown-property */}
            <ExternalViewButton location={location} />
            <button 
              onClick={reload}
              style={{ position: "absolute", bottom: "8px", right: "8px", background: "rgba(0, 0, 0, 0.6)", width: "32px", height: "32px", borderRadius: "16px", border: "1px solid rgba(255, 255, 255, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer", zIndex: 30, backdropFilter: "blur(12px)", transition: "all 0.2s ease" }}
              title="Refresh Radar Map"
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(0, 0, 0, 0.8)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
            </button>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-tertiary)", gap: "12px", padding: "24px", textAlign: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <div style={{ fontSize: "14px", maxWidth: "200px" }}>Search for a city or enable location access to view radar</div>
          </div>
        )}
      </div>
    </div>
  );
};
