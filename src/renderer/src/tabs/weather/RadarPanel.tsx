import React from "react";
import { Tooltip } from "../../components/Tooltip";
import type { Location } from "./types";
import { getRadarUrl } from "./utils";
import { useRadar } from "./useRadar";

interface RadarPanelProps { location: Location | null }

const RadarLoadingIndicator = () => (
  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0f0f12", zIndex: 10 }}>
    <div style={{ textAlign: "center", color: "var(--color-text-tertiary)" }}>
      <div className="animate-spin" style={{ width: "32px", height: "32px", border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "var(--color-accent-blue)", borderRadius: "50%", margin: "0 auto 12px" }} />
      Loading radar...
    </div>
  </div>
);

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

const containerStyle: React.CSSProperties = { flex: 1, background: "black", borderRadius: "12px", overflow: "hidden", position: "relative", border: "var(--border-subtle)", minHeight: "300px", WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='12' ry='12' fill='white' /%3E%3C/svg%3E")`, maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25'%3E%3Crect x='0' y='0' width='100%25' height='100%25' rx='12' ry='12' fill='white' /%3E%3C/svg%3E")`, transform: 'translateZ(0)' };

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const { radarLoaded, webviewRef } = useRadar(location);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={containerStyle}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '12px', border: '1.5px solid var(--color-bg-app)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', pointerEvents: 'none', zIndex: 20 }} />
        {location ? (
          <>
            {!radarLoaded && <RadarLoadingIndicator />}
            {/* eslint-disable-next-line react/no-unknown-property */}
            <webview ref={webviewRef as any} src={getRadarUrl(location.latitude, location.longitude)} style={{ width: "100%", height: "100%", border: "none", opacity: radarLoaded ? 1 : 0, transition: "opacity var(--transition-smooth)" }} partition="persist:weather" />
            <ExternalViewButton location={location} />
          </>
        ) : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-tertiary)" }}>Search for a location to view radar</div>}
      </div>
    </div>
  );
};
