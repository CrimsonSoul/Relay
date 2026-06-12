import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { loggers } from '../logger';

const logger = loggers.pocketbase;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PocketBaseConfig {
  binaryPath: string;
  dataDir: string;
  host: string;
  port: number;
  platform?: NodeJS.Platform;
}

export class PocketBaseProcess {
  private child: ChildProcess | null = null;
  private readonly config: PocketBaseConfig;
  private restartCount = 0;
  private firstCrashAt: number | null = null;
  private readonly maxRestarts = 3;
  private readonly restartWindowMs = 60_000;
  private readonly restartDelaysMs = [1_000, 5_000, 15_000];
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
    this.cleanupStalePocketBaseProcesses();

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

    let startupSettled = false;
    let rejectStartupError: ((error: Error) => void) | null = null;
    const startupError = new Promise<never>((_, reject) => {
      rejectStartupError = reject;
    });

    this.child.once('error', (error) => {
      logger.error('PocketBase process error', { error });
      this.child = null;

      if (rejectStartupError) {
        rejectStartupError(error);
        rejectStartupError = null;
        return;
      }

      if (!this.stopping) {
        void this.handleCrash(error.message);
      }
    });

    this.child.on('exit', (code, signal) => {
      logger.warn('PocketBase exited', { code, signal });
      this.child = null;

      if (!startupSettled && rejectStartupError) {
        rejectStartupError(
          new Error(`PocketBase exited during startup with code ${code} signal ${signal}`),
        );
        rejectStartupError = null;
        return;
      }

      // A signal kill (code null, signal set) or abnormal code is a crash.
      // A clean self-initiated exit (code 0) while we did not ask for it is
      // also unexpected — restart so the server never stays silently down.
      if (!this.stopping && (code !== 0 || signal !== null)) {
        void this.handleCrash(`PocketBase exited with code ${code} signal ${signal}`);
      }
    });

    try {
      await Promise.race([this.waitForHealthy(), startupError]);
    } catch (error) {
      startupSettled = true;
      rejectStartupError = null;
      this.killSpawnedChildAfterStartupFailure();
      throw error;
    } finally {
      startupSettled = true;
      rejectStartupError = null;
    }

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

      // Force kill after 5s if still alive — process.kill is synchronous,
      // so the 'exit' event fires immediately after
      const forceKillTimeout = setTimeout(() => {
        if (this.child?.pid) {
          logger.warn('PocketBase did not exit gracefully, force killing');
          try {
            process.kill(this.child.pid, 'SIGKILL');
          } catch {
            // already dead
          }
        }
      }, 5000);

      this.child!.once('exit', () => {
        clearTimeout(safetyTimeout);
        clearTimeout(forceKillTimeout);
        this.child = null;
        this.stopping = false;
        resolve();
      });

      // PocketBase is a headless Go binary — WM_CLOSE (taskkill without /F) won't work.
      // Use /F on Windows; SIGTERM on Unix gives PB a chance to flush WAL.
      if (process.platform === 'win32') {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        const taskkill = spawn('taskkill', ['/F', '/PID', this.child!.pid!.toString()]);
        taskkill.on('error', (error) => {
          logger.warn('Failed to stop PocketBase with taskkill', { error });
        });
      } else {
        this.child!.kill('SIGTERM');
      }
    });
  }

  /** Synchronous force-kill for use during app quit. SQLite WAL is crash-safe. */
  killSync(): void {
    if (!this.child?.pid) return;
    this.stopping = true;
    const pid = this.child.pid;
    logger.info('Force-killing PocketBase (sync)', { pid });

    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/T', '/PID', pid.toString()], { timeout: 5000 }); // eslint-disable-line sonarjs/no-os-command-from-path
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Process may already be dead
    }
    this.child = null;
  }

  private getPlatform(): NodeJS.Platform {
    return this.config.platform ?? process.platform;
  }

  private cleanupStalePocketBaseProcesses(): void {
    if (this.getPlatform() !== 'win32') return;

    for (const pid of this.getListeningPidsOnPort()) {
      if (!this.isPocketBasePid(pid)) continue;
      logger.warn('Killing stale PocketBase process before startup', {
        pid,
        port: this.config.port,
      });
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', pid], { timeout: 5000 }); // eslint-disable-line sonarjs/no-os-command-from-path
      } catch (error) {
        logger.warn('Failed to kill stale PocketBase process', { pid, error });
      }
    }
  }

  private getListeningPidsOnPort(): string[] {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const pids = new Set<string>();

      for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const localAddress = parts[1] ?? '';
        const state = (parts[3] ?? '').toUpperCase();
        const pid = parts[4] ?? '';

        if (
          state === 'LISTENING' &&
          localAddress.endsWith(`:${this.config.port}`) &&
          /^\d+$/.test(pid)
        ) {
          pids.add(pid);
        }
      }

      return [...pids];
    } catch (error) {
      logger.warn('Failed to inspect Windows ports before PocketBase startup', { error });
      return [];
    }
  }

  private isPocketBasePid(pid: string): boolean {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const output = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      return /(^|["\s,])pocketbase(?:\.exe)?(["\s,]|$)/i.test(output);
    } catch (error) {
      logger.warn('Failed to identify process before PocketBase startup cleanup', { pid, error });
      return false;
    }
  }

  private async handleCrash(reason: string): Promise<void> {
    const now = Date.now();
    if (this.firstCrashAt === null || now - this.firstCrashAt > this.restartWindowMs) {
      this.firstCrashAt = now;
      this.restartCount = 0;
    }

    this.restartCount++;
    if (this.restartCount <= this.maxRestarts) {
      const backoffMs =
        this.restartDelaysMs[Math.min(this.restartCount - 1, this.restartDelaysMs.length - 1)];
      logger.warn(
        `Restarting PocketBase in ${backoffMs}ms (attempt ${this.restartCount}/${this.maxRestarts})`,
      );
      await delay(backoffMs);
      if (this.stopping) return; // app began shutting down during the backoff
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

  private killSpawnedChildAfterStartupFailure(): void {
    const child = this.child;
    if (!child) return;
    this.child = null;

    if (child.exitCode !== null) return;

    try {
      if (this.getPlatform() === 'win32' && child.pid) {
        execFileSync('taskkill', ['/F', '/T', '/PID', child.pid.toString()], { timeout: 5000 }); // eslint-disable-line sonarjs/no-os-command-from-path
      } else {
        child.kill('SIGKILL');
      }
    } catch (error) {
      logger.warn('Failed to kill PocketBase after startup failure', { error });
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
