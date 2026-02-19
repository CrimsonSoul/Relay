const HTTPS_PROTOCOL = 'https:';

export const ALLOWED_WEBVIEW_ORIGINS = new Set([
  'https://www.rainviewer.com',
  'https://your-intranet',
  'https://chatgpt.com',
  'https://claude.ai',
  'https://copilot.microsoft.com',
  'https://gemini.google.com',
]);

export const ALLOWED_GEOLOCATION_ORIGINS = new Set([
  'https://www.rainviewer.com',
  'https://your-intranet',
]);

export function getSecureOrigin(urlOrOrigin: string | null | undefined): string | null {
  if (!urlOrOrigin) return null;
  try {
    const parsed = new URL(urlOrOrigin);
    if (parsed.protocol !== HTTPS_PROTOCOL) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isTrustedWebviewUrl(url: string | null | undefined): boolean {
  const origin = getSecureOrigin(url);
  return origin !== null && ALLOWED_WEBVIEW_ORIGINS.has(origin);
}

export function isTrustedGeolocationOrigin(urlOrOrigin: string | null | undefined): boolean {
  const origin = getSecureOrigin(urlOrOrigin);
  return origin !== null && ALLOWED_GEOLOCATION_ORIGINS.has(origin);
}
