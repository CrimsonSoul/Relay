import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

describe('DynatraceDashboardStore', () => {
  let dir: string;
  let store: DynatraceDashboardStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-dynatrace-'));
    store = new DynatraceDashboardStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads an empty list when the file does not exist', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds a validated dashboard and persists schema version one', () => {
    const saved = store.add({
      name: 'NOC Overview',
      url: 'https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard',
    });

    expect(saved.name).toBe('NOC Overview');
    expect(saved.id).toMatch(/^dt_/);
    expect(store.list()).toHaveLength(1);

    const raw = JSON.parse(readFileSync(join(dir, 'dynatrace-dashboards.json'), 'utf8'));
    expect(raw).toMatchObject({ schemaVersion: 1 });
    expect(raw.dashboards[0].url).toBe(saved.url);
  });

  it('updates a dashboard name and URL', () => {
    const saved = store.add({ name: 'Old', url: 'https://abc.live.dynatrace.com/dashboard' });
    const updated = store.update(saved.id, {
      name: 'New',
      url: 'https://apps.dynatrace.com/dashboard/new',
    });

    expect(updated?.name).toBe('New');
    expect(updated?.url).toBe('https://apps.dynatrace.com/dashboard/new');
  });

  it('removes a dashboard by id', () => {
    const saved = store.add({ name: 'Delete me', url: 'https://abc.live.dynatrace.com/dashboard' });
    expect(store.remove(saved.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('throws a concise error for invalid dashboard URLs', () => {
    expect(() => store.add({ name: 'Bad', url: 'https://example.com' })).toThrow(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
  });

  it('returns an empty list for corrupted JSON without overwriting it during read', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dynatrace-dashboards.json'), '{ bad json', 'utf8');
    expect(store.list()).toEqual([]);
  });
});
