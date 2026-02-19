import { useRef, useEffect, useState, useCallback } from 'react';
import { RADAR_INJECT_CSS, RADAR_INJECT_JS } from './utils';
import { loggers } from '../../utils/logger';
import type { Location } from './types';

export function useRadar(location: Location | null) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const retryCountRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);

  const handleRefresh = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    setIsLoading(true);
    try {
      webview.reloadIgnoringCache();
    } catch {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !location) return;
    retryCountRef.current = 0;
    const timeouts = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (fn: () => void, delay: number) => {
      const timeout = setTimeout(() => {
        timeouts.delete(timeout);
        fn();
      }, delay);
      timeouts.add(timeout);
    };

    const applyCustomizations = () => {
      // Webview injection can fail if the webview is destroyed or navigating -- safe to ignore
      webview.insertCSS(RADAR_INJECT_CSS).catch(() => {
        /* webview may be destroyed */
      });
      webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {
        /* webview may be destroyed */
      });
      schedule(() => {
        webview.executeJavaScript(RADAR_INJECT_JS).catch(() => {
          /* webview may be destroyed */
        });
      }, 500);
    };

    const handleDidFailLoad = (e: Electron.DidFailLoadEvent) => {
      // Ignore aborts
      if (e.errorCode === -3) return;

      loggers.weather.error('Radar failed to load', {
        errorCode: e.errorCode,
        errorDescription: e.errorDescription,
        validatedURL: e.validatedURL,
      });

      // Auto-retry a few times for transient network issues
      const retries = retryCountRef.current;
      if (retries < 3) {
        retryCountRef.current = retries + 1;
        schedule(
          () => {
            if (!webview) return;
            loggers.weather.info(`Retrying radar load (attempt ${retries + 1})...`);
            try {
              webview.reload();
            } catch (_error) {
              /* noop */
            }
          },
          1500 * (retries + 1),
        );
      }
    };

    const handleLoadStop = () => setIsLoading(false);

    webview.addEventListener('dom-ready', applyCustomizations);
    webview.addEventListener('did-finish-load', applyCustomizations);
    webview.addEventListener('did-navigate', applyCustomizations);
    webview.addEventListener('did-fail-load', handleDidFailLoad);
    webview.addEventListener('did-stop-loading', handleLoadStop);

    return () => {
      webview.removeEventListener('dom-ready', applyCustomizations);
      webview.removeEventListener('did-finish-load', applyCustomizations);
      webview.removeEventListener('did-navigate', applyCustomizations);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
      webview.removeEventListener('did-stop-loading', handleLoadStop);
      timeouts.forEach((timeout) => clearTimeout(timeout));
      timeouts.clear();
    };
  }, [location]);

  return { webviewRef, isLoading, handleRefresh };
}
