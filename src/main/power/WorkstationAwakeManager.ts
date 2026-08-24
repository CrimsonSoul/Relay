import type { WorkstationAwakeState } from '@shared/workstationAwake';

type PowerSaveBlockerAdapter = {
  start: (type: 'prevent-display-sleep') => number;
  stop: (id: number) => boolean;
  isStarted: (id: number) => boolean;
};

type WorkstationAwakeManagerOptions = {
  platform: NodeJS.Platform;
  powerSaveBlocker: PowerSaveBlockerAdapter;
  pulseInput: () => boolean;
};

export class WorkstationAwakeManager {
  private state: WorkstationAwakeState;
  private blockerId: number | null = null;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: WorkstationAwakeManagerOptions) {
    this.state = {
      supported: options.platform === 'win32',
      enabled: false,
      status: options.platform === 'win32' ? 'disabled' : 'unsupported',
    };
  }

  enable(): WorkstationAwakeState {
    if (!this.state.supported || this.state.enabled) return this.getState();
    let displayBlockerFailed = false;
    try {
      this.blockerId = this.options.powerSaveBlocker.start('prevent-display-sleep');
    } catch {
      displayBlockerFailed = true;
      this.blockerId = null;
    }
    this.state = displayBlockerFailed
      ? {
          supported: true,
          enabled: true,
          status: 'degraded',
          error: 'display-blocker-failed',
        }
      : { supported: true, enabled: true, status: 'active' };
    this.pulseInput();
    this.pulseTimer = setInterval(() => this.pulseInput(), 30_000);
    return this.getState();
  }

  disable(): WorkstationAwakeState {
    if (!this.state.supported || !this.state.enabled) return this.getState();
    if (this.pulseTimer) clearInterval(this.pulseTimer);
    this.pulseTimer = null;
    if (this.blockerId !== null && this.options.powerSaveBlocker.isStarted(this.blockerId)) {
      this.options.powerSaveBlocker.stop(this.blockerId);
    }
    this.blockerId = null;
    this.state = { supported: true, enabled: false, status: 'disabled' };
    return this.getState();
  }

  getState(): WorkstationAwakeState {
    return { ...this.state };
  }

  private pulseInput(): void {
    try {
      if (!this.options.pulseInput()) {
        this.state = {
          supported: true,
          enabled: true,
          status: 'degraded',
          error: 'input-pulse-failed',
        };
      } else if (
        this.state.error === 'input-pulse-failed' &&
        this.blockerId !== null &&
        this.options.powerSaveBlocker.isStarted(this.blockerId)
      ) {
        this.state = { supported: true, enabled: true, status: 'active' };
      }
    } catch {
      this.state = {
        supported: true,
        enabled: true,
        status: 'degraded',
        error: 'input-pulse-failed',
      };
    }
  }
}
