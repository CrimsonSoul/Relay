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
  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd');
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function normalizeRelayServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  const minLength = withProtocol.indexOf('://') + 3;
  let end = withProtocol.length;
  while (end > minLength && withProtocol[end - 1] === '/') {
    end--;
  }
  return withProtocol.slice(0, end);
}

export function isLoopbackRelayServerUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export function isLanRelayServerUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;

  const hostname = parsed.hostname.toLowerCase();
  return (
    LOOPBACK_HOSTS.has(hostname) ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname) ||
    hostname.endsWith('.local') ||
    !hostname.includes('.')
  );
}

export function isAllowedRelayServerUrl(value: string, allowInsecureHttp = false): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol !== 'http:') return false;
  return allowInsecureHttp || isLanRelayServerUrl(value);
}
