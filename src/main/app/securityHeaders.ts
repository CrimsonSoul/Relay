import { session } from 'electron';
import { state } from './appState';

/**
 * Install the CSP and security response headers on session.defaultSession.
 *
 * @param isDev - true when running in development (enables 'unsafe-eval' for HMR)
 */
export function setupSecurityHeaders(isDev: boolean): void {
  // Set Content Security Policy
  // M5: 'unsafe-eval' in dev is intentional — only enabled when !app.isPackaged for HMR/dev tooling
  // M4: 'unsafe-inline' for style-src is an accepted risk — React and many UI libraries
  //     inject inline styles at runtime; removing it would break component rendering
  // CSP reads config dynamically on each request so it picks up port/URL changes after setup.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const pbConnectSrc = (() => {
      const config = state.appConfig?.load();
      if (config?.mode === 'server') return `http://127.0.0.1:${config.port}`;
      if (config?.mode === 'client') return config.serverUrl;
      // Not yet configured — allow localhost on common PB ports for setup flow
      return 'http://127.0.0.1:8090';
    })();

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"}; ` +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: https://api.weather.gov https://*.rainviewer.com; " +
            `connect-src 'self' ${pbConnectSrc} https://api.weather.gov https://geocoding-api.open-meteo.com https://api.open-meteo.com https://ipapi.co https://ipinfo.io https://ipwho.is https://*.rainviewer.com https://api.zippopotam.us; ` +
            "font-src 'self' data:; " +
            "frame-src 'self' https://www.rainviewer.com https://chatgpt.com https://claude.ai https://copilot.microsoft.com https://gemini.google.com; " +
            "object-src 'none'; " +
            "base-uri 'self'; " +
            "form-action 'self';",
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    });
  });
}
