export const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const firstSegment = normalized.split(':')[0] ?? '';

  return (
    normalized === '::1' ||
    firstSegment.startsWith('fc') ||
    firstSegment.startsWith('fd') ||
    /^fe[89ab]$/i.test(firstSegment)
  );
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLanHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const bracketless = normalized.replace(/^\[|\]$/g, '');
  const isIpv6Literal = bracketless.includes(':');

  if (isIpv6Literal) {
    return LOOPBACK_HOSTS.has(normalized) || isPrivateIpv6(normalized);
  }

  return (
    LOOPBACK_HOSTS.has(normalized) ||
    isPrivateIpv4(normalized) ||
    normalized.endsWith('.local') ||
    !normalized.includes('.')
  );
}

function getDefaultProtocolForBareRelayServerUrl(value: string): 'http' | 'https' {
  const parsed = parseUrl(`https://${value}`);
  if (!parsed) return 'https';
  return isLanHostname(parsed.hostname) ? 'http' : 'https';
}

export function normalizeRelayServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const protocol = getDefaultProtocolForBareRelayServerUrl(trimmed);
  const withProtocol = trimmed.includes('://') ? trimmed : `${protocol}://${trimmed}`;
  const parsed = parseUrl(withProtocol);
  if (!parsed || !isRelayServerOriginUrl(parsed)) return '';
  return parsed.origin;
}

export function isLoopbackRelayServerUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export function isLanRelayServerUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;

  return isLanHostname(parsed.hostname);
}

export function isAllowedRelayServerUrl(value: string, allowInsecureHttp = false): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  if (!isRelayServerOriginUrl(parsed)) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  return allowInsecureHttp || isLanRelayServerUrl(value);
}

export function getRelayServerConnectOrigins(value: string): { http: string; ws: string } | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.host) return null;
  const http = parsed.origin;
  const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return { http, ws: `${wsProtocol}//${parsed.host}` };
}

function isRelayServerOriginUrl(parsed: URL): boolean {
  return (
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === ''
  );
}
