import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkstationAwakePreferenceStore } from './WorkstationAwakePreferenceStore';

describe('WorkstationAwakePreferenceStore', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories) rmSync(directory, { recursive: true, force: true });
    tempDirectories.length = 0;
  });

  function makeDataDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'relay-workstation-awake-'));
    tempDirectories.push(directory);
    return directory;
  }

  it('defaults to enabled when no preference has been saved', () => {
    const store = new WorkstationAwakePreferenceStore(makeDataDirectory());

    expect(store.loadEnabled()).toBe(true);
  });

  it('persists an explicit opt-out in the local application profile', () => {
    const dataDirectory = makeDataDirectory();
    const store = new WorkstationAwakePreferenceStore(dataDirectory);

    store.saveEnabled(false);

    expect(store.loadEnabled()).toBe(false);
    expect(
      JSON.parse(readFileSync(join(dataDirectory, 'workstation-preferences.json'), 'utf8')),
    ).toEqual({ keepAwakeEnabled: false });
  });

  it('fails closed when the preference file is corrupt', () => {
    const dataDirectory = makeDataDirectory();
    writeFileSync(join(dataDirectory, 'workstation-preferences.json'), '{broken json', 'utf8');
    const store = new WorkstationAwakePreferenceStore(dataDirectory);

    expect(store.loadEnabled()).toBe(false);
  });
});
