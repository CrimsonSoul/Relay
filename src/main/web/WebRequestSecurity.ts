import { hostname as getHostname, networkInterfaces } from 'node:os';
import { isTrustedRelayNetworkAddress } from './privateNetwork';

type WebRequestSecurityOptions = {
  port: number;
  hostname?: string;
  getInterfaceAddresses?: () => string[];
  connectOrigins?: readonly string[];
};

type NetworkValidation = { ok: true; origin: string } | { ok: false };

function activeInterfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((entry) => !entry.internal)
    .map((entry) => entry.address);
}

function hostWithPort(host: string, port: number): string {
  const normalized = host.trim().toLowerCase();
  const formattedHost = normalized.includes(':') ? `[${normalized}]` : normalized;
  return `${formattedHost}:${port}`;
}

function isSafeHostHeader(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[\s/@?#\\]/u.test(value);
}

export class WebRequestSecurity {
  private interfaceAddresses: string[];
  private readonly port: number;
  private readonly hostname: string;
  private readonly getInterfaceAddresses: () => string[];
  private readonly connectOrigins: readonly string[];

  constructor(options: WebRequestSecurityOptions) {
    this.port = options.port;
    this.hostname = (options.hostname ?? getHostname()).trim().toLowerCase();
    this.getInterfaceAddresses = options.getInterfaceAddresses ?? activeInterfaceAddresses;
    this.connectOrigins = options.connectOrigins ?? [];
    this.interfaceAddresses = this.getInterfaceAddresses();
  }

  validateNetwork(
    remoteAddress: string | undefined,
    hostHeader: string | undefined,
  ): NetworkValidation {
    if (!remoteAddress || !hostHeader) return { ok: false };
    let refreshed = false;
    if (!isTrustedRelayNetworkAddress(remoteAddress, this.interfaceAddresses)) {
      this.refreshInterfaces();
      refreshed = true;
      if (!isTrustedRelayNetworkAddress(remoteAddress, this.interfaceAddresses))
        return { ok: false };
    }

    const normalizedHost = hostHeader.trim().toLowerCase();
    if (!isSafeHostHeader(normalizedHost) || !this.allowedHosts().has(normalizedHost)) {
      if (!refreshed) this.refreshInterfaces();
      if (!isSafeHostHeader(normalizedHost) || !this.allowedHosts().has(normalizedHost)) {
        return { ok: false };
      }
    }
    return { ok: true, origin: `http://${normalizedHost}` };
  }

  validateOrigin(
    method: string,
    originHeader: string | undefined,
    expectedOrigin: string,
    _authenticated: boolean,
  ): boolean {
    const methodUpper = method.toUpperCase();
    if (methodUpper === 'GET' || methodUpper === 'HEAD') {
      return originHeader === undefined || originHeader === expectedOrigin;
    }
    return originHeader === expectedOrigin;
  }

  responseHeaders(): Readonly<Record<string, string>> {
    const connectSources = ["'self'", ...this.connectOrigins].join(' ');
    return {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': [
        "default-src 'self'",
        `connect-src ${connectSources}`,
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    };
  }

  private refreshInterfaces(): void {
    this.interfaceAddresses = this.getInterfaceAddresses();
  }

  private allowedHosts(): Set<string> {
    return new Set([
      hostWithPort(this.hostname, this.port),
      hostWithPort('localhost', this.port),
      hostWithPort('127.0.0.1', this.port),
      hostWithPort('::1', this.port),
      ...this.interfaceAddresses.map((address) => hostWithPort(address, this.port)),
    ]);
  }
}
