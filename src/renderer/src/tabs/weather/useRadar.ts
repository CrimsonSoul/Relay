import { useRef, useState, useEffect } from "react";
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";
import { loggers, ErrorCategory } from "../../utils/logger";
import type { Location } from "./types";

export function useRadar(location: Location | null) {
  const [radarLoaded, setRadarLoaded] = useState(false);
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const radarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;
    setRadarLoaded(false);
    if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);

    const handleDidFinishLoad = () => {
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);
      setRadarLoaded(true);
      webview.insertCSS(RADAR_INJECT_CSS).catch((err) => {
        loggers.weather.error("Failed to inject radar CSS", { 
          error: err.message, 
          category: ErrorCategory.UI 
        });
      });
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {});
    };

    const handleDidFailLoad = () => { 
      loggers.weather.error("Radar webview failed to load", { category: ErrorCategory.NETWORK });
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current); 
      setRadarLoaded(true); 
    };

    radarTimeoutRef.current = setTimeout(() => { 
      loggers.weather.warn("Radar load timeout - forcing display");
      setRadarLoaded(true); 
    }, 10000);

    webview.addEventListener("did-finish-load", handleDidFinishLoad);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    const checkLoaded = setTimeout(() => {
      try { webview.executeJavaScript("true").then(() => { if (!radarLoaded) { setRadarLoaded(true); if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current); } }).catch(() => {}); } catch {}
    }, 2000);

    return () => {
      webview.removeEventListener("did-finish-load", handleDidFinishLoad);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      if (radarTimeoutRef.current) clearTimeout(radarTimeoutRef.current);
      clearTimeout(checkLoaded);
    };
  }, [location]);

  return { radarLoaded, webviewRef };
}
