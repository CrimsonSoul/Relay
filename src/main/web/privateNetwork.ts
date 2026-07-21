import { isIP } from 'node:net';

function normalizeAddress(value: string): string {
  let address = value.trim().toLowerCase();
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const scopeIndex = address.indexOf('%');
  if (scopeIndex >= 0) address = address.slice(0, scopeIndex);
  return address;
}

function isTrustedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;
  const first = octets[0]!;
  const second = octets[1]!;
  if (first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return first === 100 && second >= 64 && second <= 127;
}

function isTrustedIpv6(address: string): boolean {
  if (address === '::1') return true;
  if (address.startsWith('::ffff:')) {
    const mapped = address.slice('::ffff:'.length);
    return isIP(mapped) === 4 && isTrustedIpv4(mapped);
  }
  const firstSegment = Number.parseInt(address.split(':', 1)[0] || '0', 16);
  if (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) return true;
  return firstSegment >= 0xfe80 && firstSegment <= 0xfebf;
}

export function isTrustedRelayNetworkAddress(
  value: string,
  approvedInterfaceAddresses: readonly string[] = [],
): boolean {
  const address = normalizeAddress(value);
  if (!address) return false;
  const approved = new Set(approvedInterfaceAddresses.map(normalizeAddress));
  if (approved.has(address)) return true;
  const version = isIP(address);
  if (version === 4) return isTrustedIpv4(address);
  if (version === 6) return isTrustedIpv6(address);
  return false;
}
