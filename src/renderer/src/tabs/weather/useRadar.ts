import { useRef, useEffect } from "react";
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";
import { loggers, ErrorCategory } from "../../utils/logger";
import type { Location } from "./types";

export function useRadar(location: Location | null) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;
    
    const handleDidFinishLoad = () => {
      webview.insertCSS(RADAR_INJECT_CSS).catch((err) => {
        loggers.weather.error("Failed to inject radar CSS", { 
          error: err.message, 
          category: ErrorCategory.UI 
        });
      });
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {});
    };

    webview.addEventListener("did-finish-load", handleDidFinishLoad);

    return () => {
      webview.removeEventListener("did-finish-load", handleDidFinishLoad);
    };
  }, [location]);

  return { webviewRef };
}
