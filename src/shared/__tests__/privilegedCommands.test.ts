import { describe, expect, it } from 'vitest';
import {
  MAX_PRIVILEGED_COMMAND_BYTES,
  PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS,
  PRIVILEGED_COMMAND_MAX_LIFETIME_MS,
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  getRelayAdministrationSettingValueError,
  isPrivilegedSha256,
  isPublicPrivilegedCommandName,
  validateSignedPrivilegedCommandEnvelope,
  type SignedPrivilegedCommandEnvelope,
} from '../privilegedCommands';

const NOW = Date.parse('2026-07-15T20:00:00.000Z');

function makeEnvelope(
  overrides: Partial<SignedPrivilegedCommandEnvelope<'privileged.status.read'>> = {},
): SignedPrivilegedCommandEnvelope<'privileged.status.read'> {
  return {
    version: 1,
    requestId: 'request-123',
    accountId: 'account-123',
    deviceId: 'device-123',
    roleClaim: 'admin',
    command: 'privileged.status.read',
    payload: { clientVersion: '1.0.0' },
    payloadHash: 'a'.repeat(64),
    expectedRevision: null,
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_LIFETIME_MS).toISOString(),
    signature: 'A'.repeat(86),
    ...overrides,
  };
}

describe('privileged command canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalizePrivilegedValue({
        z: 1,
        nested: { beta: true, alpha: 'value' },
        list: [{ y: 2, x: 1 }, 'second'],
      }),
    ).toBe('{"list":[{"x":1,"y":2},"second"],"nested":{"alpha":"value","beta":true},"z":1}');
  });

  it('produces the same UTF-8 signing bytes for equivalent objects', () => {
    const first = makeEnvelope({ payload: { clientVersion: '1.0.0' } });
    const second = {
      ...makeEnvelope(),
      payload: Object.fromEntries([['clientVersion', '1.0.0']]),
    } as SignedPrivilegedCommandEnvelope<'privileged.status.read'>;

    expect(canonicalPrivilegedSigningBytes(first)).toEqual(canonicalPrivilegedSigningBytes(second));
    expect(new TextDecoder().decode(canonicalPrivilegedSigningBytes(first))).not.toContain(
      'signature',
    );
  });

  it('rejects undefined, non-finite, and excessively nested values', () => {
    expect(() => canonicalizePrivilegedValue({ value: undefined })).toThrow(/unsupported/i);
    expect(() => canonicalizePrivilegedValue(Number.POSITIVE_INFINITY)).toThrow(/finite/i);

    let nested: unknown = 'end';
    for (let index = 0; index < 20; index += 1) nested = { nested };
    expect(() => canonicalizePrivilegedValue(nested)).toThrow(/nested/i);
  });
});

describe('privileged command validation', () => {
  it('accepts a strict current signed envelope', () => {
    expect(validateSignedPrivilegedCommandEnvelope(makeEnvelope(), NOW)).toEqual({
      ok: true,
      envelope: makeEnvelope(),
    });
  });

  it('rejects expired, overlong, and far-future envelopes', () => {
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({ expiresAt: new Date(NOW - 1).toISOString() }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'expired' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({
          expiresAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_LIFETIME_MS + 1).toISOString(),
        }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({
          issuedAt: new Date(NOW + PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS + 1).toISOString(),
          expiresAt: new Date(
            NOW + PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS + PRIVILEGED_COMMAND_MAX_LIFETIME_MS,
          ).toISOString(),
        }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('rejects malformed hashes, request IDs, payloads, and unknown keys', () => {
    expect(isPrivilegedSha256('a'.repeat(64))).toBe(true);
    expect(isPrivilegedSha256('A'.repeat(64))).toBe(false);

    expect(
      validateSignedPrivilegedCommandEnvelope(makeEnvelope({ payloadHash: 'A'.repeat(64) }), NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(makeEnvelope({ requestId: 'x'.repeat(129) }), NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope(
        makeEnvelope({ payload: { clientVersion: '' } }),
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
    expect(
      validateSignedPrivilegedCommandEnvelope({ ...makeEnvelope(), unknown: true }, NOW),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('keeps internal reauthentication commands out of the public command surface', () => {
    expect(isPublicPrivilegedCommandName('privileged.status.read')).toBe(true);
    expect(isPublicPrivilegedCommandName('administration.snapshot.read')).toBe(true);
    expect(isPublicPrivilegedCommandName('operator.create')).toBe(true);
    expect(isPublicPrivilegedCommandName('publisher.assign')).toBe(true);
    expect(isPublicPrivilegedCommandName('administration.setting.replace')).toBe(true);
    expect(isPublicPrivilegedCommandName('privileged.reauth.confirm')).toBe(false);
  });

  it.each([
    ['administration.snapshot.read', {}],
    ['operator.create', { displayName: '  Jane   Operator ' }],
    [
      'operator.rename',
      { operatorId: 'operator-2', displayName: 'Jane Operator', expectedRevision: 3 },
    ],
    ['operator.active.set', { operatorId: 'operator-2', active: false, expectedRevision: 3 }],
    [
      'publisher.assign',
      { operatorId: 'operator-2', expectedStateRevision: 4, reauthRequestId: 'reauth-1' },
    ],
    [
      'privileged.device.rename',
      { deviceId: 'device-2', label: ' Work laptop ', expectedRevision: 2 },
    ],
    [
      'privileged.device.revoke',
      { deviceId: 'device-2', expectedRevision: 2, reauthRequestId: 'reauth-1' },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.environment-url',
        value: { environmentUrl: 'https://abc123.apps.dynatrace.com' },
        expectedRevision: 1,
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.platform-token',
        value: { apiToken: 'dt0s16.example-token' },
        expectedRevision: 1,
        reauthRequestId: 'reauth-1',
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.alerting-profiles',
        value: { profiles: ['NOC Core', 'Payments'] },
        expectedRevision: 1,
      },
    ],
  ] as const)('strictly accepts the %s payload', (command, payload) => {
    const result = validateSignedPrivilegedCommandEnvelope(
      { ...makeEnvelope(), command, payload } as SignedPrivilegedCommandEnvelope,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok && command === 'operator.create') {
      expect(result.envelope.payload).toEqual({ displayName: 'Jane Operator' });
    }
    if (result.ok && command === 'privileged.device.rename') {
      expect(result.envelope.payload).toEqual({
        deviceId: 'device-2',
        label: 'Work laptop',
        expectedRevision: 2,
      });
    }
  });

  it.each([
    ['administration.snapshot.read', { unexpected: true }],
    ['operator.create', { displayName: '' }],
    ['operator.rename', { operatorId: 'operator-2', displayName: 'Jane', expectedRevision: -1 }],
    ['operator.active.set', { operatorId: 'operator-2', active: 'false', expectedRevision: 3 }],
    [
      'publisher.assign',
      { operatorId: 'operator-2', expectedStateRevision: 4, reauthRequestId: '' },
    ],
    [
      'privileged.device.rename',
      { deviceId: 'device-2', label: 'x'.repeat(81), expectedRevision: 2 },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'backup.destination',
        value: { path: '/private/company' },
        expectedRevision: 1,
      },
    ],
    [
      'administration.setting.replace',
      {
        setting: 'dynatrace.environment-url',
        value: { environmentUrl: 'http://example.com', token: 'leak' },
        expectedRevision: 1,
      },
    ],
  ] as const)('rejects malformed or unsupported %s payloads', (command, payload) => {
    expect(
      validateSignedPrivilegedCommandEnvelope(
        { ...makeEnvelope(), command, payload } as SignedPrivilegedCommandEnvelope,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'invalid-request' });
  });

  it('validates only the explicit setting value map', () => {
    expect(
      getRelayAdministrationSettingValueError('dynatrace.environment-url', {
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.platform-token', {
        apiToken: 'dt0s16.example-token',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.platform-token', {
        apiToken: 'dt0s16.example-token',
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.alerting-profiles', {
        profiles: ['NOC Core'],
      }),
    ).toBeNull();
    expect(
      getRelayAdministrationSettingValueError('dynatrace.alerting-profiles', {
        profiles: ['NOC Core', 'NOC Core'],
      }),
    ).toMatch(/duplicate/i);
  });

  it('publishes the approved command size bound', () => {
    expect(MAX_PRIVILEGED_COMMAND_BYTES).toBe(64 * 1024);
  });
});
