import { createHash, createPublicKey, verify } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  PrivilegedDeviceStore,
  PrivilegedDeviceStoreError,
  type PrivilegedSecureStorage,
} from '../PrivilegedDeviceStore';

const ACCOUNT_ID = 'account-admin';
const DEVICE_ID = 'device-work-laptop';
const DEVICE_LABEL = 'Ryan work laptop';

function fingerprintOf(publicJwk: JsonWebKey): string {
  const publicKey = createPublicKey({ format: 'jwk', key: publicJwk });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(spki).digest('hex');
}

function createSecureStorage(): PrivilegedSecureStorage & {
  encryptedPlaintexts: string[];
  decryptions: Buffer[];
} {
  const encryptedPlaintexts: string[] = [];
  const decryptions: Buffer[] = [];
  return {
    encryptedPlaintexts,
    decryptions,
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plaintext: string) => {
      encryptedPlaintexts.push(plaintext);
      return Buffer.from(`protected:${Buffer.from(plaintext).toString('base64')}`);
    }),
    decryptString: vi.fn((encrypted: Buffer) => {
      decryptions.push(encrypted);
      const stored = encrypted.toString();
      if (!stored.startsWith('protected:')) throw new Error('corrupt encrypted value');
      return Buffer.from(stored.slice('protected:'.length), 'base64').toString();
    }),
  };
}

describe('PrivilegedDeviceStore', () => {
  let dataDir: string;
  let secureStorage: ReturnType<typeof createSecureStorage>;
  let logger: { warn: Mock<(message: string, metadata?: Record<string, unknown>) => void> };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'relay-privileged-device-'));
    secureStorage = createSecureStorage();
    logger = { warn: vi.fn() };
  });

  afterEach(async () => {
    await rm(dataDir, { force: true, recursive: true });
  });

  function createStore(): PrivilegedDeviceStore {
    return new PrivilegedDeviceStore({ dataDir, logger, secureStorage });
  }

  async function createBoundDevice(store = createStore()) {
    const pending = await store.create(ACCOUNT_ID, DEVICE_LABEL);
    await store.bind(ACCOUNT_ID, pending.pendingKeyId, DEVICE_ID);
    return { pending, store };
  }

  it('generates a P-256 key and exports a stable public JWK fingerprint', async () => {
    const store = createStore();
    const pending = await store.create(ACCOUNT_ID, DEVICE_LABEL);

    expect(pending.publicJwk).toMatchObject({ crv: 'P-256', kty: 'EC' });
    expect(pending.publicJwk.d).toBeUndefined();
    expect(pending.fingerprint).toBe(fingerprintOf(pending.publicJwk));

    await store.bind(ACCOUNT_ID, pending.pendingKeyId, DEVICE_ID);
    const loaded = await store.load(ACCOUNT_ID, DEVICE_ID);
    expect(loaded).toMatchObject({
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      fingerprint: pending.fingerprint,
      publicJwk: pending.publicJwk,
    });
  });

  it('encrypts the PKCS#8 private key and decrypts it only when loading or signing', async () => {
    const { store } = await createBoundDevice();
    const registry = await readFile(join(dataDir, 'privileged-device-keys.json'), 'utf8');

    expect(secureStorage.encryptedPlaintexts).toHaveLength(1);
    expect(secureStorage.encryptedPlaintexts[0]).toContain('BEGIN PRIVATE KEY');
    expect(registry).not.toContain('BEGIN PRIVATE KEY');

    await store.load(ACCOUNT_ID, DEVICE_ID);
    const signature = await store.sign(ACCOUNT_ID, DEVICE_ID, Buffer.from('signed command'));
    const loaded = await store.load(ACCOUNT_ID, DEVICE_ID);
    const publicKey = createPublicKey({ format: 'jwk', key: loaded?.publicJwk as JsonWebKey });

    expect(secureStorage.decryptions.length).toBeGreaterThanOrEqual(3);
    expect(
      verify(
        'sha256',
        Buffer.from('signed command'),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('persists atomically with owner-only permissions and serializes concurrent writers', async () => {
    const store = createStore();
    await Promise.all([
      store.create(ACCOUNT_ID, 'Primary workstation'),
      store.create('account-publisher', 'Publisher workstation'),
    ]);

    const registryPath = join(dataDir, 'privileged-device-keys.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8')) as { keys: unknown[] };
    const entries = await readdir(dataDir);
    const details = await stat(registryPath);

    expect(registry.keys).toHaveLength(2);
    expect(entries).toEqual(['privileged-device-keys.json']);
    if (process.platform !== 'win32') expect(details.mode & 0o777).toBe(0o600);
  });

  it('returns pairing-required behavior when secure storage is unavailable', async () => {
    secureStorage.isEncryptionAvailable = vi.fn(() => false);
    const store = createStore();

    await expect(store.create(ACCOUNT_ID, DEVICE_LABEL)).rejects.toMatchObject({
      code: 'pairing-required',
    });
    await expect(store.sign(ACCOUNT_ID, DEVICE_ID, Buffer.from('payload'))).rejects.toMatchObject({
      code: 'pairing-required',
    });
    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
  });

  it('treats malformed registry data and undecryptable keys as pairing-required', async () => {
    const store = createStore();
    await writeFile(join(dataDir, 'privileged-device-keys.json'), '{broken', { mode: 0o600 });

    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
    await expect(store.create(ACCOUNT_ID, DEVICE_LABEL)).rejects.toBeInstanceOf(
      PrivilegedDeviceStoreError,
    );

    await rm(join(dataDir, 'privileged-device-keys.json'));
    const bound = await createBoundDevice(store);
    secureStorage.decryptString = vi.fn(() => {
      throw new Error('cannot decrypt');
    });

    await expect(bound.store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
    await expect(
      bound.store.sign(ACCOUNT_ID, DEVICE_ID, Buffer.from('payload')),
    ).rejects.toMatchObject({ code: 'pairing-required' });
  });

  it('rejects public key metadata that no longer matches the protected private key', async () => {
    const { store } = await createBoundDevice();
    const other = await store.create('account-publisher', 'Publisher workstation');
    const registryPath = join(dataDir, 'privileged-device-keys.json');
    const registry = JSON.parse(await readFile(registryPath, 'utf8')) as {
      keys: Array<{ deviceId: string | null; publicJwk: JsonWebKey }>;
    };
    const boundKey = registry.keys.find((key) => key.deviceId === DEVICE_ID);
    if (!boundKey) throw new Error('Expected a bound test device.');
    boundKey.publicJwk = other.publicJwk;
    await writeFile(registryPath, JSON.stringify(registry), { mode: 0o600 });

    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
    await expect(store.sign(ACCOUNT_ID, DEVICE_ID, Buffer.from('payload'))).rejects.toMatchObject({
      code: 'pairing-required',
    });
  });

  it('does not expose a device across account boundaries', async () => {
    const { pending, store } = await createBoundDevice();

    await expect(store.load('different-account', DEVICE_ID)).resolves.toBeNull();
    await expect(
      store.sign('different-account', DEVICE_ID, Buffer.from('payload')),
    ).rejects.toMatchObject({ code: 'pairing-required' });
    await expect(
      store.bind('different-account', pending.pendingKeyId, 'other-device'),
    ).rejects.toMatchObject({ code: 'pairing-required' });
  });

  it('removes only the matching account device key', async () => {
    const { store } = await createBoundDevice();

    await store.remove('different-account', DEVICE_ID);
    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.not.toBeNull();

    await store.remove(ACCOUNT_ID, DEVICE_ID);
    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
  });

  it('removes only the matching unbound pairing key', async () => {
    const store = createStore();
    const retained = await store.create(ACCOUNT_ID, 'Retained pending key');
    const discarded = await store.create(ACCOUNT_ID, 'Discarded pending key');

    await store.removePending('different-account', discarded.pendingKeyId);
    await store.bind(ACCOUNT_ID, retained.pendingKeyId, DEVICE_ID);
    await store.removePending(ACCOUNT_ID, discarded.pendingKeyId);

    const registry = JSON.parse(
      await readFile(join(dataDir, 'privileged-device-keys.json'), 'utf8'),
    ) as { keys: Array<{ pendingKeyId: string }> };
    expect(registry.keys.map((key) => key.pendingKeyId)).toEqual([retained.pendingKeyId]);
    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.not.toBeNull();
  });

  it('finds the bound protected key for an account without exposing pending keys', async () => {
    const store = createStore();
    await store.create(ACCOUNT_ID, 'Pending replacement');
    const pending = await store.create(ACCOUNT_ID, DEVICE_LABEL);
    await store.bind(ACCOUNT_ID, pending.pendingKeyId, DEVICE_ID);

    await expect(store.findForAccount(ACCOUNT_ID)).resolves.toMatchObject({
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      label: DEVICE_LABEL,
    });
    await expect(store.findForAccount('different-account')).resolves.toBeNull();
  });

  it('retires the account earlier bound key when a replacement device is bound', async () => {
    const { store } = await createBoundDevice();
    const replacement = await store.create(ACCOUNT_ID, 'Repaired workstation');
    const otherAccount = await store.create('account-publisher', 'Publisher workstation');
    await store.bind('account-publisher', otherAccount.pendingKeyId, 'device-publisher');

    await store.bind(ACCOUNT_ID, replacement.pendingKeyId, 'device-repaired');

    // The revoked device must not be what the next sign-in probes, or the account
    // re-pairs forever while every probe replays the dead key.
    await expect(store.findForAccount(ACCOUNT_ID)).resolves.toMatchObject({
      deviceId: 'device-repaired',
    });
    await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
    await expect(store.findForAccount('account-publisher')).resolves.toMatchObject({
      deviceId: 'device-publisher',
    });
  });

  it('does not log private key material when protected data is corrupt', async () => {
    const { store } = await createBoundDevice();
    const privateKey = secureStorage.encryptedPlaintexts[0] as string;
    secureStorage.decryptString = vi.fn(() => {
      throw new Error(`sensitive:${privateKey}`);
    });

    await store.load(ACCOUNT_ID, DEVICE_ID);
    const logged = JSON.stringify(logger.warn.mock.calls);

    expect(logger.warn).toHaveBeenCalled();
    expect(logged).not.toContain('BEGIN PRIVATE KEY');
    expect(logged).not.toContain('sensitive:');
  });

  it.skipIf(process.platform === 'win32')(
    'fails safely when an existing registry loses owner-only permissions',
    async () => {
      const { store } = await createBoundDevice();
      await chmod(join(dataDir, 'privileged-device-keys.json'), 0o644);

      await expect(store.load(ACCOUNT_ID, DEVICE_ID)).resolves.toBeNull();
      await expect(store.create(ACCOUNT_ID, 'Replacement')).rejects.toMatchObject({
        code: 'pairing-required',
      });
    },
  );
});
