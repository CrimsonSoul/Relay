/* eslint-disable sonarjs/no-hardcoded-ip */
import { describe, expect, it } from 'vitest';
import { isTrustedRelayNetworkAddress } from './privateNetwork';

describe('private Relay network classification', () => {
  it.each([
    '127.0.0.1',
    '10.20.30.40',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.50.10',
    '169.254.10.20',
    '100.64.0.1',
    '100.127.255.254',
    '::1',
    'fe80::1234',
    'fc00::1234',
    'fd12:3456::1',
    '::ffff:192.168.1.25',
  ])('accepts trusted LAN, link-local, loopback, and VPN address %s', (address) => {
    expect(isTrustedRelayNetworkAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '2001:4860:4860::8888',
    'not-an-address',
    '',
  ])('rejects public or malformed address %s', (address) => {
    expect(isTrustedRelayNetworkAddress(address)).toBe(false);
  });

  it('accepts an exact active VPN interface address without broadening its subnet', () => {
    const vpnAddress = '203.0.113.44';

    expect(isTrustedRelayNetworkAddress(vpnAddress, [vpnAddress])).toBe(true);
    expect(isTrustedRelayNetworkAddress('203.0.113.45', [vpnAddress])).toBe(false);
  });

  it('normalizes bracketed, scoped, and IPv4-mapped remote forms', () => {
    expect(isTrustedRelayNetworkAddress('[fd12:3456::1]')).toBe(true);
    expect(isTrustedRelayNetworkAddress('fe80::1234%utun4')).toBe(true);
    expect(isTrustedRelayNetworkAddress('::ffff:10.0.0.8')).toBe(true);
  });
});
