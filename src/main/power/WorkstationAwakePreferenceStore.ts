import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loggers } from '../logger';

type StoredWorkstationPreferences = {
  keepAwakeEnabled?: unknown;
};

export class WorkstationAwakePreferenceStore {
  private readonly preferencePath: string;

  constructor(dataDirectory: string) {
    this.preferencePath = join(dataDirectory, 'workstation-preferences.json');
  }

  loadEnabled(): boolean {
    if (!existsSync(this.preferencePath)) return true;

    try {
      const stored = JSON.parse(
        readFileSync(this.preferencePath, 'utf8'),
      ) as StoredWorkstationPreferences;
      return typeof stored.keepAwakeEnabled === 'boolean' ? stored.keepAwakeEnabled : false;
    } catch (error) {
      loggers.main.error('Failed to load workstation keep-awake preference', { error });
      return false;
    }
  }

  saveEnabled(enabled: boolean): void {
    const directory = dirname(this.preferencePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.preferencePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ keepAwakeEnabled: enabled }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.preferencePath);
  }
}
