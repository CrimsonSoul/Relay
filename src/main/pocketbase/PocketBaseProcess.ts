import { spawn, execSync, type ChildProcess } from 'child_process';
import { loggers } from '../logger';

const logger = loggers.pocketbase;

export interface PocketBaseConfig {
  binaryPath: string;
  dataDir: string;
  host: string;
  port: number;
}

export class PocketBaseProcess {
  private child: ChildProcess | null = null;
  private config: PocketBaseConfig;
  private restartCount = 0;
  private maxRestarts = 3;
  private stopping = false;
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

      if (!this.stopping && code !== 0 && code !== null) {
        void this.handleCrash(`PocketBase exited with code ${code}`);
      }
    });

    await this.waitForHealthy();
    this.restartCount = 0;
    logger.info('PocketBase is healthy', { url: this.getUrl() });
  }

  async stop(): Promise<void> {
    if (!this.child || this.stopping) return;
    this.stopping = true;

    logger.info('Stopping PocketBase');

    return new Promise<void>((resolve) => {
      // Always resolve via the 'exit' event so the process is truly dead
      const safetyTimeout = setTimeout(() => {
        logger.warn('PocketBase stop safety timeout, continuing');
        this.child = null;
        this.stopping = false;
        resolve();
      }, 10000);

      this.child!.once('exit', () => {
        clearTimeout(safetyTimeout);
        this.child = null;
        this.stopping = false;
        resolve();
      });

      // PocketBase is a headless Go binary — WM_CLOSE (taskkill without /F) won't work.
      // Use /F on Windows; SIGTERM on Unix gives PB a chance to flush WAL.
      if (process.platform === 'win32') {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        spawn('taskkill', ['/F', '/PID', this.child!.pid!.toString()]);
      } else {
        this.child!.kill('SIGTERM');
      }

      // Force kill after 5s if still alive — process.kill is synchronous,
      // so the 'exit' event fires immediately after
      setTimeout(() => {
        if (this.child?.pid) {
          logger.warn('PocketBase did not exit gracefully, force killing');
          try {
            process.kill(this.child.pid, 'SIGKILL');
          } catch {
            // already dead
          }
        }
      }, 5000);
    });
  }

  /** Synchronous force-kill for use during app quit. SQLite WAL is crash-safe. */
  killSync(): void {
    if (!this.child?.pid) return;
    const pid = this.child.pid;
    logger.info('Force-killing PocketBase (sync)', { pid });

    try {
      if (process.platform === 'win32') {
        // eslint-disable-next-line sonarjs/os-command
        execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process may already be dead
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
