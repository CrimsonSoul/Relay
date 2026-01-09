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
      webview.insertCSS(RADAR_INJECT_CSS).catch(() => {});
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {});
    };

    const handleDidFailLoad = (e: any) => {
      loggers.weather.error("Radar failed to load", { 
        errorCode: e.errorCode,
        errorDescription: e.errorDescription,
        validatedURL: e.validatedURL 
      });
    };

    webview.addEventListener("did-finish-load", handleDidFinishLoad);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    return () => {
      webview.removeEventListener("did-finish-load", handleDidFinishLoad);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
    };
  }, [location]);

  const reload = () => {
    webviewRef.current?.reloadIgnoringCache();
  };

  return { webviewRef, reload };
}
