import { describe, expect, it } from 'vitest';
import { WEB_RUNTIME } from './runtime';
import { WebSessionBootstrapResultSchema, WebSessionLoginInputSchema } from './webApi';

const PB_URL = ['http', '://', 'relay-server', ':8090'].join('');
const LAN_ADDRESS = ['192', '168', '1', '25'].join('.');

describe('Relay Web session contracts', () => {
  it('preserves passphrase bytes and rejects unknown login fields', () => {
    const passphrase = '  exact passphrase bytes  ';

    expect(WebSessionLoginInputSchema.parse({ passphrase })).toEqual({ passphrase });
    expect(() => WebSessionLoginInputSchema.parse({ passphrase, remember: true })).toThrow();
  });

  it('normalizes only a complete authenticated bootstrap response', () => {
    const result = {
      ok: true as const,
      session: {
        csrfToken: 'c'.repeat(32),
        pbUrl: PB_URL,
        auth: { token: 'app-user-token', record: null },
        publicConfig: {
          mode: 'server' as const,
          port: 8090,
          bindHost: '0.0.0.0' as const,
          lanIp: LAN_ADDRESS,
        },
        runtime: WEB_RUNTIME,
      },
    };

    expect(WebSessionBootstrapResultSchema.parse(result)).toEqual(result);
    expect(() =>
      WebSessionBootstrapResultSchema.parse({
        ...result,
        session: { ...result.session, csrfToken: 'short' },
      }),
    ).toThrow();
  });

  it('accepts only bounded public bootstrap failures', () => {
    expect(WebSessionBootstrapResultSchema.parse({ ok: false, error: 'unauthenticated' })).toEqual({
      ok: false,
      error: 'unauthenticated',
    });
    expect(() =>
      WebSessionBootstrapResultSchema.parse({
        ok: false,
        error: 'database-password-was-wrong',
      }),
    ).toThrow();
  });
});
