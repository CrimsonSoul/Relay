import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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

export class AppConfig {
  private configPath: string;

  constructor(private dataDir: string) {
    this.configPath = join(dataDir, 'config.json');
  }

  load(): RelayConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw) as RelayConfig;
    } catch {
      return null;
    }
  }

  save(config: RelayConfig): void {
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  isConfigured(): boolean {
    return this.load() !== null;
  }

  getDataDir(): string {
    return this.dataDir;
  }
}
