import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DynatraceDashboardStore } from './DynatraceDashboardStore';

describe('DynatraceDashboardStore', () => {
  let dir: string;
  let store: DynatraceDashboardStore;

  function storePath(): string {
    return join(dir, 'dynatrace-dashboards.json');
  }

  function writeStoredDashboards(dashboards: unknown[]): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath(), JSON.stringify({ schemaVersion: 1, dashboards }), 'utf8');
  }

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

    const raw = JSON.parse(readFileSync(storePath(), 'utf8'));
    expect(raw).toMatchObject({ schemaVersion: 1 });
    expect(raw.dashboards[0].url).toBe(saved.url);
  });

  it('defaults blank dashboard names to Dynatrace Dashboard', () => {
    const saved = store.add({
      name: '   ',
      url: 'https://abc.live.dynatrace.com/dashboard',
    });

    expect(saved.name).toBe('Dynatrace Dashboard');
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

  it('returns null or false for unknown ids', () => {
    expect(
      store.update('dt_missing', {
        name: 'New',
        url: 'https://apps.dynatrace.com/dashboard/new',
      }),
    ).toBeNull();
    expect(store.setBounds('dt_missing', { width: 800, height: 600 })).toBeNull();
    expect(store.remove('dt_missing')).toBe(false);
  });

  it('removes a dashboard by id', () => {
    const saved = store.add({ name: 'Delete me', url: 'https://abc.live.dynatrace.com/dashboard' });
    expect(store.remove(saved.id)).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('persists valid dashboard bounds', () => {
    const saved = store.add({ name: 'Bounds', url: 'https://abc.live.dynatrace.com/dashboard' });
    const updated = store.setBounds(saved.id, { x: 10, y: 20, width: 1024, height: 768 });

    expect(updated?.bounds).toEqual({ x: 10, y: 20, width: 1024, height: 768 });
    expect(store.list()[0]?.bounds).toEqual({ x: 10, y: 20, width: 1024, height: 768 });

    const raw = JSON.parse(readFileSync(storePath(), 'utf8'));
    expect(raw.dashboards[0].bounds).toEqual({ x: 10, y: 20, width: 1024, height: 768 });
  });

  it('throws for invalid bounds without persisting them', () => {
    const saved = store.add({ name: 'Bounds', url: 'https://abc.live.dynatrace.com/dashboard' });

    expect(() => store.setBounds(saved.id, { width: 0, height: 600 })).toThrow(
      'Invalid Dynatrace dashboard bounds.',
    );
    expect(() =>
      store.setBounds(saved.id, { width: 800, height: Number.POSITIVE_INFINITY }),
    ).toThrow('Invalid Dynatrace dashboard bounds.');
    expect(() => store.setBounds(saved.id, { x: Number.NaN, width: 800, height: 600 })).toThrow(
      'Invalid Dynatrace dashboard bounds.',
    );
    expect(store.list()[0]?.bounds).toBeUndefined();
  });

  it('throws a concise error for invalid dashboard URLs', () => {
    expect(() => store.add({ name: 'Bad', url: 'https://example.com' })).toThrow(
      'Enter a Dynatrace URL under dynatrace.com.',
    );
  });

  it('returns an empty list for corrupted JSON without overwriting it during read', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(storePath(), '{ bad json', 'utf8');
    expect(store.list()).toEqual([]);
  });

  it('returns a safe list for parseable malformed JSON and keeps mutations safe', () => {
    writeStoredDashboards([null]);

    expect(store.list()).toEqual([]);
    expect(
      store.update('dt_missing', {
        name: 'New',
        url: 'https://apps.dynatrace.com/dashboard/new',
      }),
    ).toBeNull();
    expect(store.remove('dt_missing')).toBe(false);
    expect(store.setBounds('dt_missing', { width: 800, height: 600 })).toBeNull();
  });

  it('drops stored dashboards with invalid URLs', () => {
    writeStoredDashboards([
      {
        id: 'dt_valid',
        name: 'Valid',
        url: 'https://abc.live.dynatrace.com/dashboard',
      },
      {
        id: 'dt_invalid',
        name: 'Invalid',
        url: 'https://example.com/dashboard',
      },
    ]);

    expect(store.list()).toEqual([
      {
        id: 'dt_valid',
        name: 'Valid',
        url: 'https://abc.live.dynatrace.com/dashboard',
      },
    ]);
  });

  it('drops stored dashboards with invalid bounds', () => {
    writeStoredDashboards([
      {
        id: 'dt_valid',
        name: 'Valid',
        url: 'https://abc.live.dynatrace.com/dashboard',
        bounds: { x: 1, y: 2, width: 800, height: 600 },
      },
      {
        id: 'dt_invalid',
        name: 'Invalid',
        url: 'https://abc.live.dynatrace.com/dashboard',
        bounds: { width: -1, height: 600 },
      },
    ]);

    expect(store.list()).toEqual([
      {
        id: 'dt_valid',
        name: 'Valid',
        url: 'https://abc.live.dynatrace.com/dashboard',
        bounds: { x: 1, y: 2, width: 800, height: 600 },
      },
    ]);
  });
});
