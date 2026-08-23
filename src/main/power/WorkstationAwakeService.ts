import type { WorkstationAwakeState } from '@shared/workstationAwake';

type WorkstationAwakeRuntime = {
  enable: () => WorkstationAwakeState;
  disable: () => WorkstationAwakeState;
  getState: () => WorkstationAwakeState;
};

type WorkstationAwakePreferences = {
  loadEnabled: () => boolean;
  saveEnabled: (enabled: boolean) => void;
};

export class WorkstationAwakeService {
  constructor(
    private readonly runtime: WorkstationAwakeRuntime,
    private readonly preferences: WorkstationAwakePreferences,
  ) {}

  initialize(): WorkstationAwakeState {
    return this.preferences.loadEnabled() ? this.runtime.enable() : this.runtime.disable();
  }

  setEnabled(enabled: boolean): WorkstationAwakeState {
    this.preferences.saveEnabled(enabled);
    return enabled ? this.runtime.enable() : this.runtime.disable();
  }

  getState(): WorkstationAwakeState {
    return this.runtime.getState();
  }

  shutdown(): void {
    this.runtime.disable();
  }
}
