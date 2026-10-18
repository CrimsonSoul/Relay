import { createHash, createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  type RelayPrivilegedDeviceRecord,
} from '@shared/privilegedAccess';

export function escapeFilter(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

// Revokes every active device bound to an account, one revision bump per device.
export async function revokeActiveDevices(
  pb: PocketBase,
  input: { accountId: string; actorAccountId: string; revokedAt: string },
): Promise<void> {
  const devices = await pb
    .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
    .getFullList<RelayPrivilegedDeviceRecord>({
      filter: `accountId="${escapeFilter(input.accountId)}" && state="active"`,
      requestKey: null,
    });
  for (const device of devices) {
    await pb.collection(RELAY_PRIVILEGED_DEVICES_COLLECTION).update(
      device.id,
      {
        state: 'revoked',
        revokedAt: input.revokedAt,
        revokedByAccountId: input.actorAccountId,
        revision: device.revision + 1,
      },
      { requestKey: null },
    );
  }
}

export type ParsedP256PublicKey = { jwk: JsonWebKey; key: KeyObject; fingerprint: string };

// Accepts only a bare P-256 public JWK (exactly crv, kty, x and y). The
// fingerprint is the SHA-256 of the key's SPKI DER encoding.
export function parseP256PublicJwk(value: unknown): ParsedP256PublicKey | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = new Set(['crv', 'kty', 'x', 'y']);
  if (
    keys.length !== expected.size ||
    !keys.every((key) => expected.has(key)) ||
    record.kty !== 'EC' ||
    record.crv !== 'P-256' ||
    typeof record.x !== 'string' ||
    record.x.length === 0 ||
    typeof record.y !== 'string' ||
    record.y.length === 0
  ) {
    return null;
  }
  const jwk: JsonWebKey = { crv: 'P-256', kty: 'EC', x: record.x, y: record.y };
  try {
    const key = createPublicKey({ format: 'jwk', key: jwk });
    const spki = key.export({ format: 'der', type: 'spki' });
    return { jwk, key, fingerprint: createHash('sha256').update(spki).digest('hex') };
  } catch {
    return null;
  }
}
