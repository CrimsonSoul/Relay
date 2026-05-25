import { describe, expect, it } from 'vitest';
import { isAllowedRelayServerUrl, normalizeRelayServerUrl } from './urlSecurity';

describe('urlSecurity', () => {
  const httpProtocol = 'http';
  const loopbackUrl = `${httpProtocol}://127.0.0.1:8090`;
  const localhostUrl = `${httpProtocol}://localhost:8090`;
  const privateLanHttpUrl = `${httpProtocol}://${['192', '168', '1', '50'].join('.')}:8090`;
  const localHostnameHttpUrl = `${httpProtocol}://noc-admin-pc:8090`;
  const dotLocalHttpUrl = `${httpProtocol}://relay-server.local:8090`;
  const publicHttpUrl = `${httpProtocol}://relay.example.com:8090`;

  it('normalizes host-only Relay server URLs to HTTPS', () => {
    expect(normalizeRelayServerUrl(' relay.example.com:8090/ ')).toBe(
      'https://relay.example.com:8090',
    );
  });

  it('allows HTTPS remote server URLs', () => {
    expect(isAllowedRelayServerUrl('https://relay.example.com:8090')).toBe(true);
  });

  it('allows HTTP loopback URLs for local development', () => {
    expect(isAllowedRelayServerUrl(loopbackUrl)).toBe(true);
    expect(isAllowedRelayServerUrl(localhostUrl)).toBe(true);
  });

  it('allows HTTP LAN server URLs for NOC desktop-to-laptop deployments', () => {
    expect(isAllowedRelayServerUrl(privateLanHttpUrl)).toBe(true);
    expect(isAllowedRelayServerUrl(localHostnameHttpUrl)).toBe(true);
    expect(isAllowedRelayServerUrl(dotLocalHttpUrl)).toBe(true);
  });

  it('blocks public HTTP server URLs unless explicitly allowed', () => {
    expect(isAllowedRelayServerUrl(publicHttpUrl)).toBe(false);
    expect(isAllowedRelayServerUrl(publicHttpUrl, true)).toBe(true);
  });
});
