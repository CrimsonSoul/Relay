const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_EXTERNAL_URL_LENGTH = 2_081;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

const IPV4_OCTET_PATTERN = /^(?:0|[1-9]\d{0,2})$/;

function isPrivateIpv4(hostname: string): boolean {
  const labels = hostname.split('.');
  // Every label must be a canonical decimal octet; parseInt would accept "3x" or "1evil",
  // which WHATWG URL treats as a DNS name rather than an address.
  if (labels.length !== 4 || !labels.every((label) => IPV4_OCTET_PATTERN.test(label))) {
    return false;
  }
  const parts = labels.map(Number);
  if (parts.some((part) => part > 255)) {
    return false;
  }

  // The length check above guarantees both octets exist; NaN defaults fail closed
  // (every comparison below is false for NaN) if that ever stops holding.
  const [first = Number.NaN, second = Number.NaN] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === '::1') return true;
  const firstSegment = normalized.split(':')[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(firstSegment)) return false;
  const firstHextet = Number.parseInt(firstSegment, 16);

  return (
    // Unique local addresses, fc00::/7.
    (firstHextet & 0xfe00) === 0xfc00 ||
    // Link-local addresses, fe80::/10.
    (firstHextet & 0xffc0) === 0xfe80
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

/** Origin-only rendering of an untrusted URL for log messages — query strings
 *  and paths can carry tokens that would bypass key-based log redaction. */
export function describeUrlForLog(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '<unparseable-url>';
  }
}

/** A deliberately narrow external-navigation shape for operator-entered ticket links. */
export function normalizeServiceDeskUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > MAX_EXTERNAL_URL_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }
  const parsed = parseUrl(value);
  if (
    parsed?.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !parsed.hostname
  ) {
    return null;
  }
  const canonical = parsed.toString();
  return CONTROL_CHARACTER_PATTERN.test(canonical) ? null : canonical;
}

function isRelayServerOriginUrl(parsed: URL): boolean {
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === ''
  );
}
