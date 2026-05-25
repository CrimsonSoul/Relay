import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';

/** Safe wrapper — safeStorage is unavailable in tests and non-Electron environments. */
function getSafeStorage(): typeof import('electron').safeStorage | null {
  try {
    const { safeStorage } = require('electron') as typeof import('electron');
    return safeStorage;
  } catch {
    return null;
  }
}

export interface ServerConfig {
  mode: 'server';
  port: number;
  bindHost: '127.0.0.1' | '0.0.0.0';
  secret: string;
}

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
  serverUrl?: string;
  allowInsecureHttp?: boolean;
  /** Encrypted secret (base64-encoded buffer) — used when safeStorage is available. */
  encryptedSecret?: string;
  /** Plaintext fallback — used only when safeStorage is unavailable (e.g. headless CI). */
  secret?: string;
}

export class AppConfig {
  private readonly configPath: string;

  constructor(private readonly dataDir: string) {
    this.configPath = join(dataDir, 'config.json');
  }

  load(): RelayConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const stored = JSON.parse(raw) as StoredConfig;

      // Decrypt secret if stored encrypted
      let secret: string;
      const ss = getSafeStorage();
      if (stored.encryptedSecret && ss?.isEncryptionAvailable()) {
        secret = ss.decryptString(Buffer.from(stored.encryptedSecret, 'base64'));
      } else if (stored.secret) {
        secret = stored.secret;
      } else {
        loggers.main.error('Config has no readable secret', { path: this.configPath });
        return null;
      }

      if (stored.mode === 'server') {
        return {
          mode: 'server',
          port: stored.port ?? 8090,
          bindHost: stored.bindHost ?? '0.0.0.0',
          secret,
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
    } catch (err) {
      loggers.main.error('Failed to parse config file', { path: this.configPath, error: err });
      return null;
    }
  }

  save(config: RelayConfig): void {
    mkdirSync(this.dataDir, { recursive: true });

    const stored: StoredConfig = { mode: config.mode };

    if (config.mode === 'server') {
      stored.port = config.port;
      stored.bindHost = config.bindHost;
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
      stored.secret = config.secret;
    }

    writeFileSync(this.configPath, JSON.stringify(stored, null, 2), 'utf-8');
  }

  isConfigured(): boolean {
    return this.load() !== null;
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
