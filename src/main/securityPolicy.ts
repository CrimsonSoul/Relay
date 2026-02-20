const HTTPS_PROTOCOL = 'https:';

export const ALLOWED_WEBVIEW_ORIGINS = new Set([
  'https://www.rainviewer.com',
  'https://chatgpt.com',
  'https://claude.ai',
  'https://copilot.microsoft.com',
  'https://gemini.google.com',
]);

// The user-configured radar URL is validated separately at runtime; it is not
// included here because it is not known at build time.
export const ALLOWED_GEOLOCATION_ORIGINS = new Set(['https://www.rainviewer.com']);

/**
 * Runtime-registered origins (e.g. user-configured radar URL).
 * Populated at startup from persisted user settings via IPC.
 */
const trustedRuntimeOrigins = new Set<string>();

export function registerTrustedWebviewOrigin(url: string | null | undefined): void {
  const origin = getSecureOrigin(url);
  if (origin) trustedRuntimeOrigins.add(origin);
}

export function clearTrustedRuntimeOrigins(): void {
  trustedRuntimeOrigins.clear();
}

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
  return (
    origin !== null && (ALLOWED_WEBVIEW_ORIGINS.has(origin) || trustedRuntimeOrigins.has(origin))
  );
}

export function isTrustedGeolocationOrigin(urlOrOrigin: string | null | undefined): boolean {
  const origin = getSecureOrigin(urlOrOrigin);
  return origin !== null && ALLOWED_GEOLOCATION_ORIGINS.has(origin);
}
