import { useRef, useState, useEffect } from "react";
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";
import { loggers, ErrorCategory } from "../../utils/logger";
import type { Location } from "./types";

export function useRadar(location: Location | null) {
  const [radarLoaded, setRadarLoaded] = useState(false);
  const [radarError, setRadarError] = useState(false);
  const [prevLocation, setPrevLocation] = useState(location);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const radarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Immediate state reset during render when location changes to prevent flashing
  if (location?.latitude !== prevLocation?.latitude || location?.longitude !== prevLocation?.longitude) {
    setPrevLocation(location);
    setRadarLoaded(false);
    setRadarError(false);
  }

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;
    
    // Safety check in case render reset didn't catch it
    if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);

    const handleDidFinishLoad = () => {
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);
      
      // Delay setting loaded to true to allow radar tiles to actually render
      setTimeout(() => {
        setRadarLoaded(true);
        setRadarError(false);
        webview.insertCSS(RADAR_INJECT_CSS).catch((err) => {
          loggers.weather.error("Failed to inject radar CSS", { 
            error: err.message, 
            category: ErrorCategory.UI 
          });
        });
        webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {});
      }, 1200);
    };

    const handleDidFailLoad = (event: any) => { 
      loggers.weather.error("Radar webview failed to load", { 
        category: ErrorCategory.NETWORK,
        errorCode: event.errorCode,
        errorDescription: event.errorDescription 
      });
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current); 
      setRadarLoaded(true); 
      setRadarError(true);
    };

    radarTimeoutRef.current = setTimeout(() => { 
      loggers.weather.warn("Radar load timeout - forcing display");
      setRadarLoaded(true); 
    }, 10000);

    webview.addEventListener("did-finish-load", handleDidFinishLoad);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    return () => {
      webview.removeEventListener("did-finish-load", handleDidFinishLoad);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);
    };
  }, [location]);

  return { radarLoaded, radarError, webviewRef };
}
