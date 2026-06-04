import { describe, expect, it } from 'vitest';
import {
  getRelayServerConnectOrigins,
  isAllowedRelayServerUrl,
  normalizeRelayServerUrl,
} from './urlSecurity';

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

  it('rejects credentials, paths, search params, and hashes while normalizing', () => {
    expect(normalizeRelayServerUrl('https://user:pass@relay.example.com')).toBe('');
    expect(normalizeRelayServerUrl('https://relay.example.com/pb')).toBe('');
    expect(normalizeRelayServerUrl('https://relay.example.com?team=ops')).toBe('');
    expect(normalizeRelayServerUrl('https://relay.example.com#setup')).toBe('');
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

  it('rejects non-origin Relay server URLs even when the protocol is otherwise allowed', () => {
    expect(isAllowedRelayServerUrl('https://relay.example.com/path')).toBe(false);
    expect(isAllowedRelayServerUrl('https://relay.example.com?x=1')).toBe(false);
    expect(isAllowedRelayServerUrl('https://user:pass@relay.example.com')).toBe(false);
  });

  it('derives CSP-safe HTTP and websocket origins from server URLs', () => {
    expect(
      getRelayServerConnectOrigins('https://relay.example.com:8090/path; script-src *'),
    ).toEqual({
      http: 'https://relay.example.com:8090',
      ws: 'wss://relay.example.com:8090',
    });
  });

  it('does not derive CSP connect origins from non-HTTP URL schemes', () => {
    expect(getRelayServerConnectOrigins('javascript:alert(1)')).toBeNull();
    expect(getRelayServerConnectOrigins('file:///tmp/relay')).toBeNull();
  });
});
