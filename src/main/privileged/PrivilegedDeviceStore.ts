import { safeStorage } from 'electron';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_PRIVILEGED_DEVICE_LABEL_LENGTH } from '@shared/privilegedAccess';

const REGISTRY_VERSION = 1;
const REGISTRY_FILENAME = 'privileged-device-keys.json';
const MAX_ACCOUNT_ID_LENGTH = 200;
const MAX_DEVICE_ID_LENGTH = 200;
const MAX_ENCRYPTED_KEY_LENGTH = 32_768;

export type PrivilegedDeviceStoreErrorCode = 'invalid-input' | 'pairing-required';

export class PrivilegedDeviceStoreError extends Error {
  constructor(
    readonly code: PrivilegedDeviceStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PrivilegedDeviceStoreError';
  }
}

export type PrivilegedSecureStorage = Pick<
  typeof safeStorage,
  'isEncryptionAvailable' | 'encryptString' | 'decryptString'
>;

export type PendingDeviceKey = {
  pendingKeyId: string;
  accountId: string;
  label: string;
  publicJwk: JsonWebKey;
  fingerprint: string;
};

export type LoadedDeviceKey = {
  accountId: string;
  deviceId: string;
  label: string;
  publicJwk: JsonWebKey;
  fingerprint: string;
};

export interface PrivilegedDeviceKeyStore {
  create(accountId: string, label: string): Promise<PendingDeviceKey>;
  load(accountId: string, deviceId: string): Promise<LoadedDeviceKey | null>;
  findForAccount(accountId: string): Promise<LoadedDeviceKey | null>;
  bind(accountId: string, pendingKeyId: string, deviceId: string): Promise<void>;
  remove(accountId: string, deviceId: string): Promise<void>;
  removePending(accountId: string, pendingKeyId: string): Promise<void>;
  sign(accountId: string, deviceId: string, bytes: Uint8Array): Promise<string>;
}

type DeviceStoreLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

type PrivilegedDeviceStoreOptions = {
  dataDir: string;
  secureStorage?: PrivilegedSecureStorage;
  logger?: DeviceStoreLogger;
  now?: () => number;
  createId?: () => string;
};

type StoredDeviceKey = {
  pendingKeyId: string;
  accountId: string;
  deviceId: string | null;
  label: string;
  publicJwk: JsonWebKey;
  fingerprint: string;
  encryptedPrivateKey: string;
  createdAt: string;
};

type StoredRegistry = {
  version: typeof REGISTRY_VERSION;
  keys: StoredDeviceKey[];
};

const silentLogger: DeviceStoreLogger = { warn: () => undefined };

function pairingRequired(): PrivilegedDeviceStoreError {
  return new PrivilegedDeviceStoreError(
    'pairing-required',
    'This device must be paired again for privileged access.',
  );
}

function normalizedBoundedInput(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new PrivilegedDeviceStoreError(
      'invalid-input',
      `${name} must be between 1 and ${max} characters.`,
    );
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPublicP256Jwk(value: unknown): value is JsonWebKey {
  if (!isRecord(value)) return false;
  return (
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    typeof value.x === 'string' &&
    value.x.length > 0 &&
    typeof value.y === 'string' &&
    value.y.length > 0 &&
    value.d === undefined
  );
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isStoredDeviceKey(value: unknown): value is StoredDeviceKey {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.pendingKeyId, MAX_DEVICE_ID_LENGTH) &&
    isBoundedString(value.accountId, MAX_ACCOUNT_ID_LENGTH) &&
    (value.deviceId === null || isBoundedString(value.deviceId, MAX_DEVICE_ID_LENGTH)) &&
    isBoundedString(value.label, MAX_PRIVILEGED_DEVICE_LABEL_LENGTH) &&
    isPublicP256Jwk(value.publicJwk) &&
    typeof value.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(value.fingerprint) &&
    isBoundedString(value.encryptedPrivateKey, MAX_ENCRYPTED_KEY_LENGTH) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function parseRegistry(value: unknown): StoredRegistry | null {
  if (!isRecord(value) || value.version !== REGISTRY_VERSION || !Array.isArray(value.keys)) {
    return null;
  }
  if (!value.keys.every(isStoredDeviceKey)) return null;
  const pendingIds = new Set(value.keys.map((key) => key.pendingKeyId));
  if (pendingIds.size !== value.keys.length) return null;
  return { version: REGISTRY_VERSION, keys: value.keys };
}

function fingerprintOf(publicKey: ReturnType<typeof createPublicKey>): string {
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(spki).digest('hex');
}

function publicView(key: StoredDeviceKey): LoadedDeviceKey | null {
  if (key.deviceId === null) return null;
  return {
    accountId: key.accountId,
    deviceId: key.deviceId,
    label: key.label,
    publicJwk: key.publicJwk,
    fingerprint: key.fingerprint,
  };
}

export class PrivilegedDeviceStore implements PrivilegedDeviceKeyStore {
  private readonly registryPath: string;
  private readonly secureStorage: PrivilegedSecureStorage;
  private readonly logger: DeviceStoreLogger;
  private readonly now: () => number;
  private readonly createId: () => string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: PrivilegedDeviceStoreOptions) {
    this.registryPath = join(options.dataDir, REGISTRY_FILENAME);
    this.secureStorage = options.secureStorage ?? safeStorage;
    this.logger = options.logger ?? silentLogger;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  create(accountId: string, label: string): Promise<PendingDeviceKey> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedLabel = normalizedBoundedInput(
      label,
      'Device label',
      MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
    );

    return this.enqueueWrite(async () => {
      this.assertSecureStorage();
      const registry = await this.readRegistry();
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const publicJwk = publicKey.export({ format: 'jwk' });
      let encryptedPrivateKey: Buffer;
      try {
        encryptedPrivateKey = this.secureStorage.encryptString(privatePem);
      } catch {
        this.warnUnavailable(normalizedAccountId);
        throw pairingRequired();
      }

      const stored: StoredDeviceKey = {
        pendingKeyId: this.createId(),
        accountId: normalizedAccountId,
        deviceId: null,
        label: normalizedLabel,
        publicJwk,
        fingerprint: fingerprintOf(publicKey),
        encryptedPrivateKey: encryptedPrivateKey.toString('base64'),
        createdAt: new Date(this.now()).toISOString(),
      };
      await this.writeRegistry({ ...registry, keys: [...registry.keys, stored] });
      return {
        pendingKeyId: stored.pendingKeyId,
        accountId: stored.accountId,
        label: stored.label,
        publicJwk: stored.publicJwk,
        fingerprint: stored.fingerprint,
      };
    });
  }

  async load(accountId: string, deviceId: string): Promise<LoadedDeviceKey | null> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedDeviceId = normalizedBoundedInput(deviceId, 'Device ID', MAX_DEVICE_ID_LENGTH);
    await this.writeQueue;
    try {
      this.assertSecureStorage();
      const registry = await this.readRegistry();
      const key = registry.keys.find(
        (candidate) =>
          candidate.accountId === normalizedAccountId && candidate.deviceId === normalizedDeviceId,
      );
      if (!key) return null;
      this.decryptAndValidatePrivateKey(key);
      return publicView(key);
    } catch {
      this.warnUnavailable(normalizedAccountId, normalizedDeviceId);
      return null;
    }
  }

  async findForAccount(accountId: string): Promise<LoadedDeviceKey | null> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    await this.writeQueue;
    try {
      this.assertSecureStorage();
      const registry = await this.readRegistry();
      const key = registry.keys.find(
        (candidate) => candidate.accountId === normalizedAccountId && candidate.deviceId !== null,
      );
      if (!key) return null;
      this.decryptAndValidatePrivateKey(key);
      return publicView(key);
    } catch {
      this.warnUnavailable(normalizedAccountId);
      return null;
    }
  }

  bind(accountId: string, pendingKeyId: string, deviceId: string): Promise<void> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedPendingKeyId = normalizedBoundedInput(
      pendingKeyId,
      'Pending key ID',
      MAX_DEVICE_ID_LENGTH,
    );
    const normalizedDeviceId = normalizedBoundedInput(deviceId, 'Device ID', MAX_DEVICE_ID_LENGTH);

    return this.enqueueWrite(async () => {
      this.assertSecureStorage();
      const registry = await this.readRegistry();
      const index = registry.keys.findIndex(
        (key) =>
          key.accountId === normalizedAccountId &&
          key.pendingKeyId === normalizedPendingKeyId &&
          key.deviceId === null,
      );
      const deviceAlreadyBound = registry.keys.some(
        (key) => key.accountId === normalizedAccountId && key.deviceId === normalizedDeviceId,
      );
      if (index < 0 || deviceAlreadyBound) throw pairingRequired();
      const key = registry.keys[index] as StoredDeviceKey;
      const keys = [...registry.keys];
      keys[index] = { ...key, deviceId: normalizedDeviceId };
      await this.writeRegistry({ ...registry, keys });
    });
  }

  remove(accountId: string, deviceId: string): Promise<void> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedDeviceId = normalizedBoundedInput(deviceId, 'Device ID', MAX_DEVICE_ID_LENGTH);

    return this.enqueueWrite(async () => {
      const registry = await this.readRegistry();
      const keys = registry.keys.filter(
        (key) => !(key.accountId === normalizedAccountId && key.deviceId === normalizedDeviceId),
      );
      if (keys.length !== registry.keys.length) await this.writeRegistry({ ...registry, keys });
    });
  }

  removePending(accountId: string, pendingKeyId: string): Promise<void> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedPendingKeyId = normalizedBoundedInput(
      pendingKeyId,
      'Pending key ID',
      MAX_DEVICE_ID_LENGTH,
    );

    return this.enqueueWrite(async () => {
      const registry = await this.readRegistry();
      const keys = registry.keys.filter(
        (key) =>
          !(
            key.accountId === normalizedAccountId &&
            key.pendingKeyId === normalizedPendingKeyId &&
            key.deviceId === null
          ),
      );
      if (keys.length !== registry.keys.length) await this.writeRegistry({ ...registry, keys });
    });
  }

  async sign(accountId: string, deviceId: string, bytes: Uint8Array): Promise<string> {
    const normalizedAccountId = normalizedBoundedInput(
      accountId,
      'Account ID',
      MAX_ACCOUNT_ID_LENGTH,
    );
    const normalizedDeviceId = normalizedBoundedInput(deviceId, 'Device ID', MAX_DEVICE_ID_LENGTH);
    await this.writeQueue;
    try {
      this.assertSecureStorage();
      const registry = await this.readRegistry();
      const key = registry.keys.find(
        (candidate) =>
          candidate.accountId === normalizedAccountId && candidate.deviceId === normalizedDeviceId,
      );
      if (!key) throw pairingRequired();
      const privateKey = this.decryptAndValidatePrivateKey(key);
      return signBytes('sha256', bytes, privateKey).toString('base64url');
    } catch {
      this.warnUnavailable(normalizedAccountId, normalizedDeviceId);
      throw pairingRequired();
    }
  }

  private assertSecureStorage(): void {
    try {
      if (this.secureStorage.isEncryptionAvailable()) return;
    } catch {
      // Fall through to the generic pairing-required error.
    }
    throw pairingRequired();
  }

  private decryptAndValidatePrivateKey(key: StoredDeviceKey) {
    const privatePem = this.secureStorage.decryptString(
      Buffer.from(key.encryptedPrivateKey, 'base64'),
    );
    const privateKey = createPrivateKey(privatePem);
    const derivedPublicKey = createPublicKey(privateKey);
    const metadataPublicKey = createPublicKey({ format: 'jwk', key: key.publicJwk });
    if (
      fingerprintOf(derivedPublicKey) !== key.fingerprint ||
      fingerprintOf(metadataPublicKey) !== key.fingerprint
    ) {
      throw pairingRequired();
    }
    return privateKey;
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readRegistry(): Promise<StoredRegistry> {
    try {
      const details = await stat(this.registryPath);
      if (!details.isFile()) throw pairingRequired();
      if (process.platform !== 'win32' && (details.mode & 0o077) !== 0) throw pairingRequired();
      const parsed = parseRegistry(JSON.parse(await readFile(this.registryPath, 'utf8')));
      if (!parsed) throw pairingRequired();
      return parsed;
    } catch (error) {
      if (isMissingFileError(error)) return { version: REGISTRY_VERSION, keys: [] };
      throw pairingRequired();
    }
  }

  private async writeRegistry(registry: StoredRegistry): Promise<void> {
    const directory = join(this.registryPath, '..');
    await mkdir(directory, { mode: 0o700, recursive: true });
    const temporaryPath = `${this.registryPath}.${this.createId()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(registry, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await rename(temporaryPath, this.registryPath);
      if (process.platform !== 'win32') await chmod(this.registryPath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private warnUnavailable(accountId: string, deviceId?: string): void {
    this.logger.warn('Privileged device key is unavailable; pairing is required.', {
      accountId,
      deviceId,
      reason: 'pairing-required',
    });
  }
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
