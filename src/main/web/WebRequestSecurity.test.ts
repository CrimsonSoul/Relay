/* eslint-disable sonarjs/no-clear-text-protocols, sonarjs/no-hardcoded-ip */
import { describe, expect, it, vi } from 'vitest';
import { WebRequestSecurity } from './WebRequestSecurity';

describe('WebRequestSecurity', () => {
  it.each(['relay-server:8091', 'RELAY-SERVER:8091', '192.168.1.25:8091', '[fd12:3456::1]:8091'])(
    'accepts an exact hostname or private interface Host value: %s',
    (host) => {
      const security = new WebRequestSecurity({
        port: 8091,
        hostname: 'relay-server',
        getInterfaceAddresses: () => ['192.168.1.25', 'fd12:3456::1'],
      });

      expect(security.validateNetwork('192.168.1.90', host)).toEqual({
        ok: true,
        origin: `http://${host.toLowerCase()}`,
      });
    },
  );

  it.each([
    'relay-server.attacker.test:8091',
    'attacker-relay-server:8091',
    'relay-server:8092',
    '192.168.1.25.attacker.test:8091',
    '8.8.8.8:8091',
    '',
  ])('rejects rebinding, suffix, public, wrong-port, and empty Host values: %s', (host) => {
    const security = new WebRequestSecurity({
      port: 8091,
      hostname: 'relay-server',
      getInterfaceAddresses: () => ['192.168.1.25'],
    });

    expect(security.validateNetwork('192.168.1.90', host)).toEqual({ ok: false });
  });

  it('refreshes active interfaces once before rejecting a newly valid private Host', () => {
    const getInterfaceAddresses = vi
      .fn()
      .mockReturnValueOnce(['192.168.1.25'])
      .mockReturnValueOnce(['192.168.1.25', '10.20.30.40']);
    const security = new WebRequestSecurity({
      port: 8091,
      hostname: 'relay-server',
      getInterfaceAddresses,
    });

    expect(security.validateNetwork('10.20.30.41', '10.20.30.40:8091')).toMatchObject({ ok: true });
    expect(getInterfaceAddresses).toHaveBeenCalledTimes(2);
  });

  it.each(['8.8.8.8', '203.0.113.9', 'not-an-address'])(
    'rejects a public or malformed remote address before Host handling: %s',
    (remoteAddress) => {
      const security = new WebRequestSecurity({
        port: 8091,
        hostname: 'relay-server',
        getInterfaceAddresses: () => ['192.168.1.25'],
      });
      expect(security.validateNetwork(remoteAddress, 'relay-server:8091')).toEqual({ ok: false });
    },
  );

  it('requires an exact same-origin Origin for authenticated state changes', () => {
    const security = new WebRequestSecurity({
      port: 8091,
      hostname: 'relay-server',
      getInterfaceAddresses: () => ['192.168.1.25'],
    });
    const expectedOrigin = 'http://relay-server:8091';

    expect(security.validateOrigin('POST', expectedOrigin, expectedOrigin, true)).toBe(true);
    expect(security.validateOrigin('POST', 'http://attacker.test', expectedOrigin, true)).toBe(
      false,
    );
    expect(security.validateOrigin('POST', 'null', expectedOrigin, true)).toBe(false);
    expect(security.validateOrigin('POST', undefined, expectedOrigin, true)).toBe(false);
    expect(security.validateOrigin('GET', undefined, expectedOrigin, true)).toBe(true);
  });

  it('emits restrictive browser headers without permissive CORS', () => {
    const security = new WebRequestSecurity({
      port: 8091,
      hostname: 'relay-server',
      getInterfaceAddresses: () => ['192.168.1.25'],
    });
    const headers = security.responseHeaders();

    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
  });
});
