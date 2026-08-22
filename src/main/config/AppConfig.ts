import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';
import type { ServerWebConfig } from '@shared/ipc';

export type { ServerWebConfig } from '@shared/ipc';

let electronModuleForTests: typeof import('electron') | null | undefined;

export function __setElectronModuleForTests(module: typeof import('electron') | null): void {
  electronModuleForTests = module;
}

/** Safe wrapper — safeStorage is unavailable in tests and non-Electron environments. */
function getElectronModule(): typeof import('electron') | null {
  if (electronModuleForTests !== undefined) return electronModuleForTests;
  try {
    return require('electron') as typeof import('electron');
  } catch {
    return null;
  }
}

function getSafeStorage(): typeof import('electron').safeStorage | null {
  return getElectronModule()?.safeStorage ?? null;
}

function isPackagedElectronRuntime(): boolean {
  return getElectronModule()?.app?.isPackaged === true;
}

export interface ServerConfig {
  mode: 'server';
  port: number;
  bindHost: '127.0.0.1' | '0.0.0.0';
  secret: string;
  web?: ServerWebConfig;
}

export const DEFAULT_SERVER_WEB_CONFIG: Readonly<ServerWebConfig> = Object.freeze({
  enabled: true,
  port: 8091,
});

export interface ClientConfig {
  mode: 'client';
  serverUrl: string;
  allowInsecureHttp?: boolean;
  secret: string;
}

export type RelayConfig = ServerConfig | ClientConfig;

/** On-disk config shape — secret is stored encrypted when safeStorage is available. */
interface StoredConfig {
  mode: string;
  port?: number;
  bindHost?: '127.0.0.1' | '0.0.0.0';
  lanAccessConfigured?: boolean;
  serverUrl?: string;
  allowInsecureHttp?: boolean;
  web?: ServerWebConfig;
  /** Encrypted secret (base64-encoded buffer) — used when safeStorage is available. */
  encryptedSecret?: string;
  /** Plaintext fallback — used only when safeStorage is unavailable (e.g. headless CI). */
  secret?: string;
}

function toRelayConfig(stored: StoredConfig, secret: string): RelayConfig {
  if (stored.mode === 'server') {
    const isLegacyLocalOnlyConfig =
      stored.bindHost === '127.0.0.1' && stored.lanAccessConfigured !== true;

    return {
      mode: 'server',
      port: stored.port ?? 8090,
      bindHost: isLegacyLocalOnlyConfig ? '0.0.0.0' : (stored.bindHost ?? '0.0.0.0'),
      secret,
      web: stored.web ?? { ...DEFAULT_SERVER_WEB_CONFIG },
    };
  }

  const clientConfig: ClientConfig = {
    mode: 'client',
    serverUrl: stored.serverUrl ?? '',
    secret,
  };
  if (stored.allowInsecureHttp === true) {
    clientConfig.allowInsecureHttp = true;
  }
  return clientConfig;
}

/**
 * Why the stored configuration could not be turned into a usable RelayConfig.
 * `unreadable` means the workspace IS configured — the file just cannot be
 * decoded right now — and must never be treated as a first run.
 */
export type AppConfigReadResult =
  | { status: 'absent' }
  | { status: 'loaded'; config: RelayConfig }
  | { status: 'unreadable'; reason: string };

const UNREADABLE_SECRET_REASON =
  'Relay found its saved workspace configuration but could not read the stored passphrase. ' +
  'Sign in to the original Windows/macOS user account, or restore a Relay backup, and start Relay again.';
const UNREADABLE_FILE_REASON =
  'Relay found its saved workspace configuration but could not read it. ' +
  'Restore a Relay backup, or delete config.json from the Relay data folder to start over.';

export class AppConfig {
  private readonly configPath: string;

  constructor(private readonly dataDir: string) {
    this.configPath = join(dataDir, 'config.json');
  }

  /**
   * Decode the stored configuration without any repair side effects, so save()
   * can consult it without re-entering itself through the encryption upgrade.
   */
  private readStoredConfig(): {
    result: AppConfigReadResult;
    needsEncryptionUpgrade: boolean;
  } {
    if (!existsSync(this.configPath)) {
      return { result: { status: 'absent' }, needsEncryptionUpgrade: false };
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const stored = JSON.parse(raw) as StoredConfig;

      // Decrypt secret if stored encrypted
      let secret: string;
      const ss = getSafeStorage();
      const encryptionAvailable = ss?.isEncryptionAvailable() === true;
      if (stored.encryptedSecret && ss && encryptionAvailable) {
        secret = ss.decryptString(Buffer.from(stored.encryptedSecret, 'base64'));
      } else if (stored.secret) {
        if (isPackagedElectronRuntime() && !encryptionAvailable) {
          loggers.main.error(
            'Secure storage is unavailable; refusing to load plaintext Relay secret',
            { path: this.configPath },
          );
          return {
            result: { status: 'unreadable', reason: UNREADABLE_SECRET_REASON },
            needsEncryptionUpgrade: false,
          };
        }
        secret = stored.secret;
      } else if (stored.encryptedSecret) {
        loggers.main.error('Secure storage cannot decrypt the stored Relay secret', {
          path: this.configPath,
        });
        return {
          result: { status: 'unreadable', reason: UNREADABLE_SECRET_REASON },
          needsEncryptionUpgrade: false,
        };
      } else {
        loggers.main.error('Config has no readable secret', { path: this.configPath });
        return {
          result: { status: 'unreadable', reason: UNREADABLE_FILE_REASON },
          needsEncryptionUpgrade: false,
        };
      }

      return {
        result: { status: 'loaded', config: toRelayConfig(stored, secret) },
        needsEncryptionUpgrade: Boolean(stored.secret) && encryptionAvailable,
      };
    } catch (err) {
      loggers.main.error('Failed to read config file', { path: this.configPath, error: err });
      return {
        result: { status: 'unreadable', reason: UNREADABLE_FILE_REASON },
        needsEncryptionUpgrade: false,
      };
    }
  }

  /**
   * Read the stored configuration, keeping "never configured" separate from
   * "configured but currently unreadable". Callers that only need the happy
   * path can keep using load().
   */
  readState(): AppConfigReadResult {
    const { result, needsEncryptionUpgrade } = this.readStoredConfig();
    if (result.status === 'loaded' && needsEncryptionUpgrade) {
      this.save(result.config);
    }
    return result;
  }

  load(): RelayConfig | null {
    const state = this.readState();
    return state.status === 'loaded' ? state.config : null;
  }

  save(config: RelayConfig): void {
    // Refuse to replace a configuration that exists but cannot be read. Writing
    // a fresh secret over it would silently invalidate the credentials every
    // remote client and browser session already holds.
    const { result: existing } = this.readStoredConfig();
    if (existing.status === 'unreadable') {
      loggers.main.error('Refusing to overwrite an unreadable Relay configuration', {
        path: this.configPath,
      });
      throw new Error(existing.reason);
    }

    mkdirSync(this.dataDir, { recursive: true });

    const stored: StoredConfig = { mode: config.mode };

    if (config.mode === 'server') {
      stored.port = config.port;
      stored.bindHost = config.bindHost;
      stored.lanAccessConfigured = true;
      stored.web = config.web ?? { ...DEFAULT_SERVER_WEB_CONFIG };
    } else {
      stored.serverUrl = config.serverUrl;
      if (config.allowInsecureHttp) {
        stored.allowInsecureHttp = true;
      }
    }

    // Encrypt secret at rest using OS credential storage when available
    const ss = getSafeStorage();
    if (ss?.isEncryptionAvailable()) {
      stored.encryptedSecret = ss.encryptString(config.secret).toString('base64');
    } else {
      if (isPackagedElectronRuntime()) {
        throw new Error('Secure storage is unavailable; refusing to write plaintext Relay secret');
      }
      stored.secret = config.secret;
    }

    // Write-then-rename so a crash mid-write can never truncate the live config.
    const tmpPath = `${this.configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(stored, null, 2), 'utf-8');
    renameSync(tmpPath, this.configPath);
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  updateServerWebConfig(web: ServerWebConfig): boolean {
    const current = this.load();
    if (
      current?.mode !== 'server' ||
      !Number.isInteger(web.port) ||
      web.port < 1024 ||
      web.port > 65535 ||
      web.port === current.port ||
      (web.enabled && current.bindHost !== '0.0.0.0')
    ) {
      return false;
    }
    try {
      this.save({ ...current, web: { ...web } });
      return true;
    } catch (error) {
      loggers.main.error('Failed to update Relay Web configuration', { error });
      return false;
    }
  }

  /** Deletes the config file so the app returns to the setup screen on next load. */
  clear(): boolean {
    try {
      if (existsSync(this.configPath)) {
        unlinkSync(this.configPath);
      }
      return true;
    } catch (err) {
      loggers.main.error('Failed to clear config file', { path: this.configPath, error: err });
      return false;
    }
  }

  getDataDir(): string {
    return this.dataDir;
  }
}
