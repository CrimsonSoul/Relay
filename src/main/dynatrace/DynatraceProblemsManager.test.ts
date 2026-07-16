import { describe, expect, it, vi } from 'vitest';
import {
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  type DynatraceProblemRecord,
} from '@shared/dynatraceProblems';
import { DynatraceProblemsManager } from './DynatraceProblemsManager';
import type { DynatraceProblemsConfigStore } from './DynatraceProblemsConfigStore';
import type { DynatraceProblemsClient } from './DynatraceProblemsClient';

const config = {
  environmentUrl: 'https://abc123.apps.dynatrace.com',
  apiToken: 'dt0s16.platform-read-only-token',
  alertingProfiles: null,
};

function makeProblem(problemId: string, title: string) {
  return {
    problemId,
    displayId: `P-${problemId}`,
    title,
    status: 'OPEN',
    severity: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: 1_750_000_000_000,
    endTime: -1,
    rootCauseName: 'payments-api',
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    alertingProfiles: [],
    environmentUrl: config.environmentUrl,
    syncedAt: '2026-07-09T20:00:00.000Z',
  } satisfies Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
}

describe('DynatraceProblemsManager', () => {
  it('normalizes a classic tenant origin before testing the platform token', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchProblems: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(3),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(
      manager.testSettings({
        environmentUrl: 'https://abc123.live.dynatrace.com',
        apiToken: 'dt0s16.new-platform-token',
      }),
    ).resolves.toEqual({ reachable: true, problemCount: 3 });
    expect(client.testConnection).toHaveBeenCalledWith({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.new-platform-token',
      alertingProfiles: null,
    });
  });

  it('updates known problems, creates new problems, and publishes sync health', async () => {
    const firstProblem = makeProblem('PROBLEM-1', 'Existing problem');
    const secondProblem = makeProblem('PROBLEM-2', 'New problem');
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'record-1', problemId: 'PROBLEM-1' }])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'record-2', problemId: 'PROBLEM-2' }),
      delete: vi.fn().mockResolvedValue(true),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue(['Payments Production']),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [firstProblem, secondProblem],
        totalCount: 2,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(2);
    expect(problemCollection.update).toHaveBeenCalledWith('record-1', firstProblem, {
      requestKey: null,
    });
    expect(problemCollection.create).toHaveBeenCalledWith(secondProblem, { requestKey: null });
    expect(pocketBase.collection).toHaveBeenCalledWith(DYNATRACE_PROBLEM_SYNC_COLLECTION);
    expect(syncCollection.update).toHaveBeenCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'ok', error: '' }),
      { requestKey: null },
    );
  });

  it('reloads the alerting profile catalog during a forced manual reconciliation', async () => {
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi
        .fn()
        .mockResolvedValueOnce(['Payments Production'])
        .mockResolvedValueOnce(['New Retail Profile', 'Payments Production']),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await manager.syncNow();
    await manager.syncNow(true);

    expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(2);
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        availableAlertingProfiles: ['New Retail Profile', 'Payments Production'],
      }),
      { requestKey: null },
    );
  });

  it('stores only selected-profile problems and removes excluded history with its local records', async () => {
    const selectedConfig = { ...config, alertingProfiles: ['POS Store', 'Alerts for NOC'] };
    const matchedProblem = {
      ...makeProblem('MATCHED', 'Selected profile problem'),
      alertingProfiles: ['POS Store'],
    };
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'kept-record', problemId: 'KEPT', alertingProfiles: ['Alerts for NOC'] },
          { id: 'excluded-record', problemId: 'EXCLUDED', alertingProfiles: ['Default'] },
        ])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'matched-record', problemId: 'MATCHED' }),
      delete: vi.fn().mockResolvedValue(true),
    };
    const noteCollection = {
      getFullList: vi.fn().mockResolvedValue([{ id: 'excluded-note', problemId: 'EXCLUDED' }]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const stateCollection = {
      getFullList: vi.fn().mockResolvedValue([{ id: 'excluded-state', problemId: 'EXCLUDED' }]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    };
    const pocketBase = {
      collection: vi.fn((name: string) => {
        if (name === DYNATRACE_PROBLEMS_COLLECTION) return problemCollection;
        if (name === DYNATRACE_PROBLEM_NOTES_COLLECTION) return noteCollection;
        if (name === DYNATRACE_PROBLEM_STATES_COLLECTION) return stateCollection;
        return syncCollection;
      }),
    };
    const store = {
      load: vi.fn().mockReturnValue(selectedConfig),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      saveAlertingProfiles: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue(['Alerts for NOC', 'Default', 'POS Store']),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [matchedProblem], totalCount: 1 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(client.fetchProblems).toHaveBeenCalledWith(selectedConfig, { mode: 'reconcile' });
    expect(problemCollection.create).toHaveBeenCalledWith(matchedProblem, { requestKey: null });
    expect(problemCollection.delete).toHaveBeenCalledWith('excluded-record', {
      requestKey: null,
    });
    expect(problemCollection.delete).not.toHaveBeenCalledWith('kept-record', expect.anything());
    expect(noteCollection.delete).toHaveBeenCalledWith('excluded-note', { requestKey: null });
    expect(stateCollection.delete).toHaveBeenCalledWith('excluded-state', { requestKey: null });
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        availableAlertingProfiles: ['Alerts for NOC', 'Default', 'POS Store'],
        selectedAlertingProfiles: ['POS Store', 'Alerts for NOC'],
        profileFilterConfigured: true,
      }),
      { requestKey: null },
    );
  });

  it('keeps a rolling year of resolved history and removes its local notes and disposition together', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T20:00:00.000Z'));
    const day = 24 * 60 * 60 * 1_000;
    const expiredClosed = {
      id: 'expired-record',
      problemId: 'EXPIRED-PROBLEM',
      status: 'CLOSED',
      endTime: Date.now() - 366 * day,
    };
    const recentClosed = {
      id: 'recent-record',
      problemId: 'RECENT-PROBLEM',
      status: 'CLOSED',
      endTime: Date.now() - 364 * day,
    };
    const oldOpen = {
      id: 'open-record',
      problemId: 'OLD-OPEN-PROBLEM',
      status: 'OPEN',
      endTime: -1,
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValueOnce([expiredClosed, recentClosed, oldOpen]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(true),
    };
    const noteCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValue([{ id: 'expired-note', problemId: 'EXPIRED-PROBLEM' }]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const stateCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValue([{ id: 'expired-state', problemId: 'EXPIRED-PROBLEM' }]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    };
    const pocketBase = {
      collection: vi.fn((name: string) => {
        if (name === DYNATRACE_PROBLEMS_COLLECTION) return problemCollection;
        if (name === DYNATRACE_PROBLEM_NOTES_COLLECTION) return noteCollection;
        if (name === DYNATRACE_PROBLEM_STATES_COLLECTION) return stateCollection;
        return syncCollection;
      }),
    };
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(0);

    expect(problemCollection.getFullList).toHaveBeenLastCalledWith({
      filter: expect.stringContaining('status="CLOSED"'),
      fields: 'id,problemId,status,endTime',
      requestKey: null,
    });
    expect(noteCollection.getFullList).toHaveBeenCalledWith({
      fields: 'id,problemId',
      requestKey: null,
    });
    expect(stateCollection.getFullList).toHaveBeenCalledWith({
      fields: 'id,problemId',
      requestKey: null,
    });
    expect(noteCollection.delete).toHaveBeenCalledWith('expired-note', { requestKey: null });
    expect(stateCollection.delete).toHaveBeenCalledWith('expired-state', { requestKey: null });
    expect(problemCollection.delete).toHaveBeenCalledTimes(1);
    expect(problemCollection.delete).toHaveBeenCalledWith('expired-record', { requestKey: null });

    vi.useRealTimers();
  });

  it('polls only the change window and skips writes and pruning for unchanged problems', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T20:00:00.000Z'));
    const unchangedProblem = makeProblem('UNCHANGED', 'Stable problem');
    const existingProblem = {
      id: 'record-unchanged',
      ...unchangedProblem,
      syncedAt: '2026-07-10T19:45:00.000Z',
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([existingProblem]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(true),
    };
    const syncRecord = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: '2026-07-10T19:59:00.000Z',
      lastReconciledAt: '2026-07-10T12:00:00.000Z',
      availableAlertingProfiles: ['Payments Production'],
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue(syncRecord),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn(),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [{ ...unchangedProblem, syncedAt: '2026-07-10T20:00:00.000Z' }],
        totalCount: 1,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(client.fetchProblems).toHaveBeenCalledWith(config, {
      mode: 'incremental',
      lookbackMinutes: 10,
    });
    expect(client.fetchAlertingProfiles).not.toHaveBeenCalled();
    expect(problemCollection.getFullList).toHaveBeenCalledTimes(1);
    expect(problemCollection.getFullList).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'problemId="UNCHANGED"' }),
    );
    expect(problemCollection.update).not.toHaveBeenCalled();
    expect(problemCollection.create).not.toHaveBeenCalled();
    expect(problemCollection.delete).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'ok', lastSuccessAt: '2026-07-10T20:00:00.000Z' }),
      { requestKey: null },
    );
    expect(syncCollection.update.mock.calls.at(-1)?.[1]).not.toHaveProperty('lastReconciledAt');

    vi.useRealTimers();
  });
});
