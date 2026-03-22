import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
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
  secret: string;
}

export interface ClientConfig {
  mode: 'client';
  serverUrl: string;
  secret: string;
}

export type RelayConfig = ServerConfig | ClientConfig;

/** On-disk config shape — secret is stored encrypted when safeStorage is available. */
interface StoredConfig {
  mode: string;
  port?: number;
  serverUrl?: string;
  /** Encrypted secret (base64-encoded buffer) — used when safeStorage is available. */
  encryptedSecret?: string;
  /** Plaintext fallback — used only when safeStorage is unavailable (e.g. headless CI). */
  secret?: string;
}

export class AppConfig {
  private configPath: string;

  constructor(private dataDir: string) {
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
        return { mode: 'server', port: stored.port ?? 8090, secret };
      }
      return { mode: 'client', serverUrl: stored.serverUrl ?? '', secret };
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
    } else {
      stored.serverUrl = config.serverUrl;
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

  getDataDir(): string {
    return this.dataDir;
  }
}
