import { useRef, useEffect } from "react";
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from "./utils";
import { loggers } from "../../utils/logger";
import type { Location } from "./types";

export function useRadar(location: Location | null) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;
    const timeouts = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (fn: () => void, delay: number) => {
      const timeout = setTimeout(() => {
        timeouts.delete(timeout);
        fn();
      }, delay);
      timeouts.add(timeout);
    };

    const applyCustomizations = () => {
      webview.insertCSS(RADAR_INJECT_CSS).catch(() => { });
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => { });
      schedule(() => {
        webview.executeJavaScript(RADAR_INJECT_JS).catch(() => { });
      }, 500);
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
        schedule(() => {
          if (!webview) return;
          loggers.weather.info(`Retrying radar load (attempt ${retries + 1})...`);
          try { webview.reload(); } catch (_error) { /* noop */ }
        }, 1500 * (retries + 1));
      }
    };

    webview.addEventListener("dom-ready", applyCustomizations);
    webview.addEventListener("did-finish-load", applyCustomizations);
    webview.addEventListener("did-navigate", applyCustomizations);
    webview.addEventListener("did-fail-load", handleDidFailLoad);

    return () => {
      webview.removeEventListener("dom-ready", applyCustomizations);
      webview.removeEventListener("did-finish-load", applyCustomizations);
      webview.removeEventListener("did-navigate", applyCustomizations);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
    };
  }, [location]);

  return { webviewRef };
}
