import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { escapeFilter, parseP256PublicJwk, revokeActiveDevices } from '../privilegedRecords';

function p256PublicJwk() {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  return {
    jwk: { kty, crv, x, y },
    fingerprint: createHash('sha256')
      .update(publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex'),
  };
}

describe('parseP256PublicJwk', () => {
  it('returns the canonical key and its SPKI fingerprint', () => {
    const { jwk, fingerprint } = p256PublicJwk();

    const parsed = parseP256PublicJwk(jwk);

    expect(parsed?.fingerprint).toBe(fingerprint);
    expect(parsed?.jwk).toEqual({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y });
    expect(parsed?.key.asymmetricKeyType).toBe('ec');
  });

  it.each([
    ['a non-object', 'not-a-key'],
    ['an array', []],
    ['null', null],
    ['an extra member', { ...p256PublicJwk().jwk, d: 'private' }],
    ['a missing member', { kty: 'EC', crv: 'P-256', x: p256PublicJwk().jwk.x }],
    ['another curve', { ...p256PublicJwk().jwk, crv: 'P-384' }],
    ['another key type', { ...p256PublicJwk().jwk, kty: 'RSA' }],
    ['an empty coordinate', { ...p256PublicJwk().jwk, y: '' }],
    ['a point off the curve', { ...p256PublicJwk().jwk, x: 'AAAA', y: 'AAAA' }],
  ])('rejects %s', (_label, value) => {
    expect(parseP256PublicJwk(value)).toBeNull();
  });
});

describe('escapeFilter', () => {
  it('escapes backslashes before quotes', () => {
    expect(escapeFilter(String.raw`a\"b`)).toBe(String.raw`a\\\"b`);
  });
});

describe('revokeActiveDevices', () => {
  it('revokes each active device for the account with a revision bump', async () => {
    const getFullList = vi.fn(async () => [
      { id: 'device-1', revision: 2 },
      { id: 'device-2', revision: 7 },
    ]);
    const update = vi.fn(async () => ({}));
    const pb = { collection: vi.fn(() => ({ getFullList, update })) };

    await revokeActiveDevices(pb as never, {
      accountId: 'account-"x"',
      actorAccountId: 'account-owner',
      revokedAt: '2026-07-20T12:00:00.000Z',
    });

    expect(getFullList).toHaveBeenCalledWith({
      filter: String.raw`accountId="account-\"x\"" && state="active"`,
      requestKey: null,
    });
    expect(update.mock.calls).toEqual([
      [
        'device-1',
        {
          state: 'revoked',
          revokedAt: '2026-07-20T12:00:00.000Z',
          revokedByAccountId: 'account-owner',
          revision: 3,
        },
        { requestKey: null },
      ],
      [
        'device-2',
        {
          state: 'revoked',
          revokedAt: '2026-07-20T12:00:00.000Z',
          revokedByAccountId: 'account-owner',
          revision: 8,
        },
        { requestKey: null },
      ],
    ]);
  });
});
