import React, { useRef, useEffect, useState } from "react";
import type { Location } from "./types";
import { getRadarUrl, RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";

interface RadarPanelProps {
  location: Location | null;
}

export const RadarPanel: React.FC<RadarPanelProps> = ({ location }) => {
  const [radarLoaded, setRadarLoaded] = useState(false);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const radarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle webview events with timeout fallback
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;

    // Reset radar loaded state when location changes
    setRadarLoaded(false);

    // Clear any existing timeout
    if (radarTimeoutRef.current) {
      clearTimeout(radarTimeoutRef.current);
    }

    const handleDidFinishLoad = () => {
      if (radarTimeoutRef.current) {
        clearTimeout(radarTimeoutRef.current);
      }
      setRadarLoaded(true);

      // Inject CSS to fix UI overlap and styling
      webview
        .insertCSS(RADAR_INJECT_CSS)
        .catch((err) => console.error("Failed to inject radar CSS:", err));

      // Fallback: Ensure positioning via execution
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {});
    };

    const handleDidFailLoad = () => {
      console.error("Radar webview failed to load");
      if (radarTimeoutRef.current) {
        clearTimeout(radarTimeoutRef.current);
      }
      setRadarLoaded(true); // Still mark as loaded to hide spinner
    };

    // Set a timeout fallback - if radar doesn't load in 10 seconds, show it anyway
    radarTimeoutRef.current = setTimeout(() => {
      console.warn("Radar load timeout - forcing display");
      setRadarLoaded(true);
    }, 10000);

    webview.addEventListener("did-finish-load", handleDidFinishLoad);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    // Check if webview is already loaded (race condition fix)
    const checkLoaded = setTimeout(() => {
      try {
        webview
          .executeJavaScript("true")
          .then(() => {
            if (!radarLoaded) {
              setRadarLoaded(true);
              if (radarTimeoutRef.current) {
                clearTimeout(radarTimeoutRef.current);
              }
            }
          })
          .catch(() => {
            // Not ready yet, wait for events
          });
      } catch {
        // Webview not ready for JS execution yet - wait for did-finish-load event
      }
    }, 2000);

    return () => {
      webview.removeEventListener("did-finish-load", handleDidFinishLoad);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      if (radarTimeoutRef.current) {
        clearTimeout(radarTimeoutRef.current);
      }
      clearTimeout(checkLoaded);
    };
  }, [location]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          background: "black",
          borderRadius: "12px",
          overflow: "hidden",
          position: "relative",
          border: "var(--border-subtle)",
          minHeight: "300px",
        }}
      >
        {location ? (
          <>
            {!radarLoaded && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#0f0f12",
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    textAlign: "center",
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  <div
                    className="animate-spin"
                    style={{
                      width: "32px",
                      height: "32px",
                      border: "3px solid rgba(255,255,255,0.1)",
                      borderTopColor: "var(--color-accent-blue)",
                      borderRadius: "50%",
                      margin: "0 auto 12px",
                    }}
                  />
                  Loading radar...
                </div>
              </div>
            )}
            <webview
              ref={webviewRef as any}
              src={getRadarUrl(location.latitude, location.longitude)}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                opacity: radarLoaded ? 1 : 0,
                transition: "opacity var(--transition-smooth)",
              }}
              partition="persist:weather"
              // @ts-ignore - webview attributes
              allowpopups="false"
            />
            {/* Custom External View Button */}
            <button
              onClick={() => {
                if (location && window.api?.openExternal) {
                  window.api.openExternal(
                    getRadarUrl(location.latitude, location.longitude)
                  );
                }
              }}
              style={{
                position: "absolute",
                bottom: "8px",
                left: "8px",
                background: "rgba(0, 0, 0, 0.6)",
                padding: "6px 12px",
                borderRadius: "12px",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#ffffff",
                textDecoration: "none",
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.02em",
                cursor: "pointer",
                zIndex: 20,
                transition: "all 0.2s ease",
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0, 0, 0, 0.8)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14L21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
              View Larger Map
            </button>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--color-text-tertiary)",
            }}
          >
            Search for a location to view radar
          </div>
        )}
      </div>
    </div>
  );
};
