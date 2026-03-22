import { spawn, type ChildProcess } from 'child_process';
import { loggers } from '../logger';

const logger = loggers.pocketbase;

export interface PocketBaseConfig {
  binaryPath: string;
  dataDir: string;
  migrationsDir: string;
  host: string;
  port: number;
}

export class PocketBaseProcess {
  private child: ChildProcess | null = null;
  private config: PocketBaseConfig;
  private restartCount = 0;
  private maxRestarts = 3;
  private onCrashCallback?: (error: string) => void;

  constructor(config: PocketBaseConfig) {
    this.config = config;
  }

  getUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  getLocalUrl(): string {
    return `http://127.0.0.1:${this.config.port}`;
  }

  getSpawnArgs(): string[] {
    return [
      'serve',
      `--http=${this.config.host}:${this.config.port}`,
      `--dir=${this.config.dataDir}`,
      `--migrationsDir=${this.config.migrationsDir}`,
    ];
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  onCrash(callback: (error: string) => void): void {
    this.onCrashCallback = callback;
  }

  async start(): Promise<void> {
    const args = this.getSpawnArgs();
    logger.info('Starting PocketBase', { binary: this.config.binaryPath, args });

    this.child = spawn(this.config.binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (data: Buffer) => {
      logger.debug('PocketBase stdout', { output: data.toString().trim() });
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      logger.warn('PocketBase stderr', { output: data.toString().trim() });
    });

    this.child.on('exit', (code, signal) => {
      logger.warn('PocketBase exited', { code, signal });
      this.child = null;

      if (code !== 0 && code !== null) {
        void this.handleCrash(`PocketBase exited with code ${code}`);
      }
    });

    await this.waitForHealthy();
    this.restartCount = 0;
    logger.info('PocketBase is healthy', { url: this.getUrl() });
  }

  async stop(): Promise<void> {
    if (!this.child) return;

    logger.info('Stopping PocketBase');

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('PocketBase did not exit gracefully, force killing');
        this.forceKill();
        resolve();
      }, 5000);

      this.child!.on('exit', () => {
        clearTimeout(timeout);
        this.child = null;
        resolve();
      });

      this.gracefulKill();
    });
  }

  private gracefulKill(): void {
    if (!this.child?.pid) return;

    if (process.platform === 'win32') {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      spawn('taskkill', ['/PID', this.child.pid.toString()]);
    } else {
      this.child.kill('SIGTERM');
    }
  }

  private forceKill(): void {
    if (!this.child?.pid) return;

    if (process.platform === 'win32') {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      spawn('taskkill', ['/F', '/PID', this.child.pid.toString()]);
    } else {
      this.child.kill('SIGKILL');
    }
    this.child = null;
  }

  private async handleCrash(reason: string): Promise<void> {
    this.restartCount++;
    if (this.restartCount <= this.maxRestarts) {
      logger.warn(`Restarting PocketBase (attempt ${this.restartCount}/${this.maxRestarts})`);
      try {
        await this.start();
      } catch (err) {
        logger.error('Failed to restart PocketBase', { error: err });
        this.onCrashCallback?.(`Failed to restart PocketBase after ${this.restartCount} attempts`);
      }
    } else {
      this.onCrashCallback?.(reason);
    }
  }

  private async waitForHealthy(timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    const healthUrl = `${this.getLocalUrl()}/api/health`;

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(healthUrl);
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`PocketBase failed to become healthy within ${timeoutMs}ms`);
  }
}
