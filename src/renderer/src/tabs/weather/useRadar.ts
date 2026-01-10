import { useRef, useEffect } from "react";
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";
import { loggers } from "../../utils/logger";
import type { Location } from "./types";

export function useRadar(location: Location | null) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;

    const handleDidFinishLoad = () => {
      webview.insertCSS(RADAR_INJECT_CSS).catch(() => { });
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => { });
    };

    const handleDidFailLoad = (e: Electron.DidFailLoadEvent) => {
      // Ignore aborts
      if (e.errorCode === -3) return;

      loggers.weather.error("Radar failed to load", {
        errorCode: e.errorCode,
        errorDescription: e.errorDescription,
        validatedURL: e.validatedURL
      });

      // Auto-retry a few times for transient network issues
      // @ts-ignore - custom property
      const retries = (webview as Electron.WebviewTag & { _retryCount?: number })._retryCount || 0;
      if (retries < 3) {
        // @ts-ignore
        (webview as Electron.WebviewTag & { _retryCount?: number })._retryCount = retries + 1;
        setTimeout(() => {
          loggers.weather.info(`Retrying radar load (attempt ${retries + 1})...`);
          webview.reload();
        }, 1500 * (retries + 1));
      }
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
