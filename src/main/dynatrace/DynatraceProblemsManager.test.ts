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
import { DynatraceProblemsClient } from './DynatraceProblemsClient';

const config = {
  environmentUrl: 'https://abc123.apps.dynatrace.com',
  apiToken: 'dt0s16.platform-read-only-token',
  alertingProfiles: null,
  customDqlMatcher: null,
  workflowId: 'workflow-test',
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
    scopeExcluded: false,
    scopeExcludedAt: '',
    environmentUrl: config.environmentUrl,
    syncedAt: '2026-07-09T20:00:00.000Z',
  } satisfies Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
}

// Existing lifecycle fixtures also exercise the live transport; transport-specific contracts
// are covered by the ClassicProblemsClient and live synchronization suites.
function withLiveClient(client: object): DynatraceProblemsClient {
  const source = client as DynatraceProblemsClient;
  return Object.assign(client, {
    fetchLiveProblems: (
      configuration: Parameters<DynatraceProblemsClient['fetchProblems']>[0],
      scope: Parameters<DynatraceProblemsClient['fetchProblems']>[1],
    ) => source.fetchProblems(configuration, scope),
  }) as DynatraceProblemsClient;
}

describe('DynatraceProblemsManager', () => {
  it.each([
    Array.from(
      { length: 100 },
      (_, index) => `${1000000000000000000n + BigInt(index)}_1789492996054V2`,
    ),
    Array.from({ length: 12 }, (_, index) => `${'界'.repeat(500)}"\\${index}`),
  ])(
    'keeps automatic problem and subject updates within PocketBase filter limits',
    async (...ids) => {
      vi.useFakeTimers();
      const incoming = ids.map((id) => makeProblem(id, 'Updated problem'));
      const stored = incoming.map((problem, index) => ({
        ...problem,
        id: `record-${index}`,
        title: 'Previous problem',
        notificationTitle: '',
        notificationStatus: 'OPEN',
        notificationUpdatedAt: 0,
      }));
      const checkpoint = {
        id: 'sync',
        state: 'ok',
        lastSuccessAt: new Date().toISOString(),
        lastReconciledAt: new Date().toISOString(),
      };
      const firstSuccess = checkpoint.lastSuccessAt;
      const records = {
        getFullList: vi.fn(async ({ filter }: { filter?: string }) => {
          if (!filter?.startsWith('problemId=')) return stored;
          if (Buffer.byteLength(filter, 'utf8') > 3500)
            throw Object.assign(new Error('PocketBase filter limit exceeded'), { status: 400 });
          const selected = [...filter.matchAll(/problemId=("(?:\\.|[^"\\])*")/g)].map(
            (match) => JSON.parse(match[1]!) as string,
          );
          return stored.filter((problem) => selected.includes(problem.problemId));
        }),
        update: vi.fn(async (id: string, patch: object) =>
          Object.assign(
            stored.find((problem) => problem.id === id)!,
            patch,
          ),
        ),
      };
      const sync = {
        getFirstListItem: vi.fn(async () => checkpoint),
        update: vi.fn(async (_id: string, patch: object) => Object.assign(checkpoint, patch)),
      };
      const client = {
        fetchLiveProblems: vi.fn(async () => ({ problems: incoming, totalCount: incoming.length })),
        fetchNotificationTitles: vi.fn(async () => ({
          complete: true,
          titles: incoming.map((problem) => ({
            problemId: problem.problemId,
            notificationTitle: 'Updated subject',
            notificationStatus: 'OPEN',
            notificationUpdatedAt: 2000,
          })),
        })),
      };
      const manager = new DynatraceProblemsManager(
        { load: () => config } as unknown as DynatraceProblemsConfigStore,
        () =>
          ({
            collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
          }) as never,
        client as unknown as DynatraceProblemsClient,
      );
      try {
        manager.start();
        await vi.waitFor(() =>
          expect(
            stored.every(
              (problem) =>
                problem.title === 'Updated problem' &&
                problem.notificationTitle === 'Updated subject',
            ),
          ).toBe(true),
        );
        await vi.advanceTimersByTimeAsync(15_000);
        expect(client.fetchLiveProblems).toHaveBeenCalledTimes(2);
        expect(checkpoint.state).toBe('ok');
        expect(checkpoint.lastSuccessAt).not.toBe(firstSuccess);
      } finally {
        await manager.stopForRestore();
        vi.useRealTimers();
      }
    },
  );

  it('drains active sync writes and blocks queued reconciliation until restarted', async () => {
    let finishWrite!: () => void;
    const update = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const record = { getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }), update };
    const store = { load: vi.fn().mockReturnValue(null) };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => ({ collection: () => record }) as never,
    );
    const syncing = manager.syncNow();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    const queued = manager.syncNow(true);
    let stopped = false;
    const draining = manager.stopForRestore().then(() => {
      stopped = true;
    });
    await expect(manager.syncNow(true)).rejects.toThrow(/restore/i);
    expect(stopped).toBe(false);
    finishWrite();
    await Promise.all([syncing, queued, draining]);
    expect(update).toHaveBeenCalledOnce();
    manager.start();
    await expect(manager.syncNow()).resolves.toBe(0);
    manager.stop();
  });

  it('drains an already-started settings-clear write and rejects another clear during restore', async () => {
    let finishWrite!: () => void;
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const record = { getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }), update };
    const store = { clear: vi.fn().mockReturnValue(true) };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => ({ collection: () => record }) as never,
    );
    expect(manager.clearSettings()).toBe(true);
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    let stopped = false;
    const draining = manager.stopForRestore().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);
    expect(manager.clearSettings()).toBe(false);
    expect(store.clear).toHaveBeenCalledOnce();
    finishWrite();
    await draining;
    expect(stopped).toBe(true);
  });

  it('drains sibling upserts after another sync worker fails', async () => {
    let finishWrite!: () => void;
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('upsert failed'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      );
    const records = { getFullList: vi.fn().mockResolvedValue([]), create };
    const sync = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }),
      update: vi.fn().mockResolvedValue({}),
    };
    const store = { load: vi.fn().mockReturnValue(config) };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [makeProblem('one', 'one'), makeProblem('two', 'two')],
        totalCount: 2,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () =>
        ({
          collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
        }) as never,
      withLiveClient(client),
    );
    const result = manager.syncNow().catch((error: unknown) => error);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    let stopped = false;
    const draining = manager.stopForRestore().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopped).toBe(false);
    finishWrite();
    await expect(result).resolves.toEqual(new Error('upsert failed'));
    await draining;
    expect(stopped).toBe(true);
  });

  it('tests the prepared credentials and environment without saving them', async () => {
    const store = {
      prepare: vi.fn().mockReturnValue({
        environmentUrl: 'https://abc123.apps.dynatrace.com',
        apiToken: 'dt0s16.new-platform-token',
        alertingProfiles: null,
        customDqlMatcher: null,
      }),
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(3),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );

    await expect(
      manager.testSettings({
        environmentUrl: 'https://abc123.live.dynatrace.com',
        apiToken: 'dt0s16.new-platform-token',
      }),
    ).resolves.toEqual({ reachable: true, problemCount: 3 });
    expect(store.prepare).toHaveBeenCalledWith({
      environmentUrl: 'https://abc123.live.dynatrace.com',
      apiToken: 'dt0s16.new-platform-token',
    });
    expect(store.save).not.toHaveBeenCalled();
    expect(client.testConnection).toHaveBeenCalledWith({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.new-platform-token',
      alertingProfiles: null,
      customDqlMatcher: null,
    });
  });

  it('treats custom DQL as the exclusive scope when a legacy request also includes profiles', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      countMatchingProblems: vi.fn().mockResolvedValue(0),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );

    await expect(
      manager.testProblemScope({
        alertingProfiles: ['NOC Core'],
        customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
      }),
    ).resolves.toBe(0);
    expect(client.countMatchingProblems).toHaveBeenCalledWith({
      ...config,
      alertingProfiles: null,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });
    expect(store).not.toHaveProperty('saveProblemScope');
  });

  it('validates a scope before saving and triggers a forced reconciliation', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      saveProblemScope: vi.fn(),
      clear: vi.fn(),
    };
    const client = { countMatchingProblems: vi.fn().mockResolvedValue(0) };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );
    const sync = vi.spyOn(manager, 'syncNow').mockResolvedValue(0);
    const input = {
      alertingProfiles: [],
      customDqlMatcher: 'matchesPhrase(event.name, "No current match")',
    };

    await expect(manager.saveProblemScope(input)).resolves.toBe(0);

    expect(store.saveProblemScope).toHaveBeenCalledWith(input);
    expect(sync).toHaveBeenCalledWith(true);
  });

  it('rejects oversized remembered profiles before checking or saving DQL scope', async () => {
    const store = { load: vi.fn().mockReturnValue(config), saveProblemScope: vi.fn() };
    const client = { countMatchingProblems: vi.fn() };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );
    await expect(
      manager.saveProblemScope({
        alertingProfiles: [],
        customDqlMatcher: 'true',
        rememberedAlertingProfiles: ['x'.repeat(1000)],
      }),
    ).rejects.toThrow(/valid Dynatrace alerting profiles/);
    expect(client.countMatchingProblems).not.toHaveBeenCalled();
    expect(store.saveProblemScope).not.toHaveBeenCalled();
  });

  it('returns after saving without waiting for a large forced reconciliation', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      saveProblemScope: vi.fn(),
      clear: vi.fn(),
    };
    const client = { countMatchingProblems: vi.fn().mockResolvedValue(4) };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );
    let finishReconciliation: ((value: number) => void) | undefined;
    const reconciliation = new Promise<number>((resolve) => {
      finishReconciliation = resolve;
    });
    const sync = vi.spyOn(manager, 'syncNow').mockReturnValue(reconciliation);

    const save = manager.saveProblemScope({
      alertingProfiles: [],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith(true));
    let savedCount: number | null = null;
    void save.then((count) => {
      savedCount = count;
    });
    await Promise.resolve();

    expect(savedCount).toBe(4);
    finishReconciliation?.(0);
    await reconciliation;
  });

  it('does not replace the stored scope when Dynatrace rejects validation', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      saveProblemScope: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      countMatchingProblems: vi.fn().mockRejectedValue(new Error('Matcher syntax rejected')),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );
    const sync = vi.spyOn(manager, 'syncNow').mockResolvedValue(0);

    await expect(
      manager.saveProblemScope({
        alertingProfiles: [],
        customDqlMatcher: 'matchesPhrase(event.name, "broken")',
      }),
    ).rejects.toThrow('Matcher syntax rejected');

    expect(store.saveProblemScope).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('keeps a validated scope saved when its first reconciliation must retry', async () => {
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      saveProblemScope: vi.fn(),
      clear: vi.fn(),
    };
    const client = { countMatchingProblems: vi.fn().mockResolvedValue(4) };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => null,
      withLiveClient(client),
    );
    vi.spyOn(manager, 'syncNow').mockRejectedValue(new Error('Dynatrace temporarily unavailable'));
    const input = {
      alertingProfiles: [],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };

    await expect(manager.saveProblemScope(input)).resolves.toBe(4);
    expect(store.saveProblemScope).toHaveBeenCalledWith(input);
  });

  it('updates known problems, creates new problems, and publishes sync health', async () => {
    const firstProblem = makeProblem('PROBLEM-1', 'Existing problem');
    const secondProblem = makeProblem('PROBLEM-2', 'New problem');
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'record-1', problemId: 'PROBLEM-1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
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
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [firstProblem, secondProblem],
        totalCount: 2,
        resultTruncated: true,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(2);
    expect(problemCollection.update).toHaveBeenCalledWith('record-1', firstProblem, {
      requestKey: null,
    });
    expect(problemCollection.create).toHaveBeenCalledWith(secondProblem, { requestKey: null });
    expect(pocketBase.collection).toHaveBeenCalledWith(DYNATRACE_PROBLEM_SYNC_COLLECTION);
    expect(syncCollection.update).toHaveBeenCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        error: '',
        consecutiveFailures: 0,
        resultTruncated: true,
        scopeSource: 'unfiltered',
      }),
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
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await manager.syncNow();
    await manager.syncNow(true);

    expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(2);
    expect(manager.getAvailableAlertingProfileCatalog()).toEqual([
      'New Retail Profile',
      'Payments Production',
    ]);
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        availableAlertingProfiles: ['New Retail Profile', 'Payments Production'],
      }),
      { requestKey: null },
    );
  });

  it('refreshes the alerting profile catalog daily during ordinary incremental polls', async () => {
    const baseTime = Date.parse('2026-08-19T12:00:00.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const lastReconciledAt = new Date(baseTime - 30 * 60_000).toISOString();
    let syncRecord = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: new Date(baseTime - 60_000).toISOString(),
      lastReconciledAt,
      availableAlertingProfiles: ['Existing Profile'],
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockImplementation(async () => syncRecord),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(config), getPublicSettings: vi.fn() };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue(['Existing Profile', 'New Profile']),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [],
        changedProblems: null,
        totalCount: 0,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    try {
      await manager.syncNow();
      expect(manager.getAvailableAlertingProfileCatalog()).toEqual(['Existing Profile']);

      syncRecord = {
        ...syncRecord,
        lastSuccessAt: new Date(baseTime + 30 * 60_000).toISOString(),
      };
      now.mockReturnValue(baseTime + 31 * 60_000);
      await manager.syncNow();

      expect(manager.getAvailableAlertingProfileCatalog()).toEqual(['Existing Profile']);
      expect(client.fetchAlertingProfiles).not.toHaveBeenCalled();

      syncRecord = {
        ...syncRecord,
        lastSuccessAt: new Date(baseTime + 23 * 60 * 60_000 + 30 * 60_000).toISOString(),
      };
      now.mockReturnValue(baseTime + 23 * 60 * 60_000 + 31 * 60_000);
      await manager.syncNow();

      expect(manager.getAvailableAlertingProfileCatalog()).toEqual([
        'Existing Profile',
        'New Profile',
      ]);
      expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('preserves and throttles the cached profile catalog after an automatic refresh failure', async () => {
    const baseTime = Date.parse('2026-08-19T14:00:00.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    let syncRecord = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: new Date(baseTime - 60_000).toISOString(),
      lastReconciledAt: new Date(baseTime - 25 * 60 * 60_000).toISOString(),
      availableAlertingProfiles: ['Last Known Profile'],
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockImplementation(async () => syncRecord),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(config), getPublicSettings: vi.fn() };
    const client = {
      fetchAlertingProfiles: vi
        .fn()
        .mockRejectedValue(new Error('Dynatrace catalog temporarily unavailable')),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [],
        changedProblems: null,
        totalCount: 0,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    try {
      await expect(manager.syncNow()).resolves.toBe(0);
      expect(manager.getAvailableAlertingProfileCatalog()).toEqual(['Last Known Profile']);

      syncRecord = {
        ...syncRecord,
        lastSuccessAt: new Date(baseTime).toISOString(),
      };
      now.mockReturnValue(baseTime + 60_000);
      await expect(manager.syncNow()).resolves.toBe(0);

      expect(manager.getAvailableAlertingProfileCatalog()).toEqual(['Last Known Profile']);
      expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('throttles a successfully empty profile catalog until the next daily refresh', async () => {
    const baseTime = Date.parse('2026-08-19T16:00:00.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    let syncRecord = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: new Date(baseTime - 60_000).toISOString(),
      lastReconciledAt: new Date(baseTime - 25 * 60 * 60_000).toISOString(),
      availableAlertingProfiles: [] as string[],
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockImplementation(async () => syncRecord),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(config), getPublicSettings: vi.fn() };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [],
        changedProblems: null,
        totalCount: 0,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    try {
      await manager.syncNow();
      syncRecord = {
        ...syncRecord,
        lastSuccessAt: new Date(baseTime).toISOString(),
      };
      now.mockReturnValue(baseTime + 60_000);
      await manager.syncNow();

      expect(manager.getAvailableAlertingProfileCatalog()).toEqual([]);
      expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('marks excluded history out of scope without deleting problems, notes, or dispositions', async () => {
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
          {
            id: 'kept-record',
            problemId: 'KEPT',
            alertingProfiles: ['Alerts for NOC'],
            scopeExcluded: false,
          },
          {
            id: 'excluded-record',
            problemId: 'EXCLUDED',
            alertingProfiles: ['Default'],
            scopeExcluded: false,
          },
        ])
        .mockResolvedValueOnce([])
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
      inspectAlertingProfileField: vi.fn().mockResolvedValue({
        problemCount: 20,
        profiledProblemCount: 18,
        healthy: true,
      }),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [matchedProblem],
        totalCount: 1,
        resultTruncated: false,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(client.fetchProblems).toHaveBeenCalledWith(selectedConfig, { mode: 'reconcile' });
    expect(problemCollection.create).toHaveBeenCalledWith(matchedProblem, { requestKey: null });
    expect(problemCollection.update).toHaveBeenCalledWith(
      'excluded-record',
      { scopeExcluded: true, scopeExcludedAt: expect.any(String) },
      { requestKey: null },
    );
    expect(problemCollection.delete).not.toHaveBeenCalledWith('excluded-record', expect.anything());
    expect(noteCollection.delete).not.toHaveBeenCalled();
    expect(stateCollection.delete).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        availableAlertingProfiles: ['Alerts for NOC', 'Default', 'POS Store'],
        selectedAlertingProfiles: ['POS Store', 'Alerts for NOC'],
        profileFilterConfigured: true,
        scopeSource: 'alerting-profile',
        profileFieldHealthy: true,
        profileCatalogCount: 3,
        matchedProfileCount: 2,
      }),
      { requestKey: null },
    );
  });

  it('reconciles custom DQL scope from the authoritative full match set', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const matchedProblem = makeProblem('MATCHED', 'Still in custom scope');
    const existingMatched = { id: 'matched-record', ...matchedProblem };
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce([existingMatched])
        .mockResolvedValueOnce([
          {
            id: 'matched-record',
            problemId: 'MATCHED',
            alertingProfiles: [],
            scopeExcluded: false,
            scopeExcludedAt: '',
          },
          {
            id: 'lost-record',
            problemId: 'NO-LONGER-MATCHED',
            alertingProfiles: [],
            scopeExcluded: false,
            scopeExcludedAt: '',
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(matcherConfig),
      getPublicSettings: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [matchedProblem],
        totalCount: 1,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(problemCollection.update).toHaveBeenCalledTimes(1);
    expect(problemCollection.update).toHaveBeenCalledWith(
      'lost-record',
      { scopeExcluded: true, scopeExcludedAt: expect.any(String) },
      { requestKey: null },
    );
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'ok', scopeSource: 'custom-dql' }),
      { requestKey: null },
    );
  });

  it('reports a legacy combined configuration as custom-DQL scope', async () => {
    const combinedConfig = {
      ...config,
      alertingProfiles: ['NOC Core'],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const profileMatch = {
      ...makeProblem('PROFILE-MATCH', 'Selected profile problem'),
      alertingProfiles: ['NOC Core'],
    };
    const matcherOnlyMatch = {
      ...makeProblem('MATCHER-MATCH', 'Custom DQL problem'),
      alertingProfiles: ['Default'],
    };
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockImplementation(async (problem) => ({
        id: `record-${problem.problemId}`,
        ...problem,
      })),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(combinedConfig), getPublicSettings: vi.fn() };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue(['Default', 'NOC Core']),
      inspectAlertingProfileField: vi.fn().mockResolvedValue({
        problemCount: 2,
        profiledProblemCount: 2,
        healthy: true,
      }),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [profileMatch, matcherOnlyMatch],
        totalCount: 2,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(2);

    expect(problemCollection.create).toHaveBeenCalledWith(matcherOnlyMatch, { requestKey: null });
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'ok', scopeSource: 'custom-dql' }),
      { requestKey: null },
    );
  });

  it('refreshes an already qualified problem when a later update does not match custom DQL', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'not matchesValue(event.status_transition, "UPDATED")',
    };
    const existingProblem = {
      id: 'matched-record',
      ...makeProblem('MATCHED', 'Original emailed problem'),
      workflowTitle: 'NOC · Original alert',
      workflowDescription: 'NOC routing context',
      workflowTags: ['teams:network'],
      workflowAffectedEntityTypes: ['SERVICE'],
    };
    const updatedProblem = makeProblem('MATCHED', 'Latest title after an excluded update');
    const neverMatched = makeProblem('NEVER-MATCHED', 'Not relevant to the NOC');
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([existingProblem]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({
        id: 'sync-1',
        key: 'primary',
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
        lastReconciledAt: new Date().toISOString(),
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(matcherConfig), getPublicSettings: vi.fn() };
    const client = {
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [],
        changedProblems: [updatedProblem, neverMatched],
        totalCount: 0,
        resultTruncated: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(problemCollection.update).toHaveBeenCalledWith(
      'matched-record',
      {
        ...updatedProblem,
        workflowTitle: 'NOC · Original alert',
        workflowDescription: 'NOC routing context',
        workflowTags: ['teams:network'],
        workflowAffectedEntityTypes: ['SERVICE'],
      },
      { requestKey: null },
    );
    expect(problemCollection.update).not.toHaveBeenCalledWith(
      'matched-record',
      expect.objectContaining({ scopeExcluded: true }),
      expect.anything(),
    );
    expect(problemCollection.create).not.toHaveBeenCalled();
  });

  it('preserves stored workflow metadata while applying canonical updates when enrichment is incomplete', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const existingProblem = {
      id: 'matched-record',
      ...makeProblem('MATCHED', 'Original canonical title'),
      workflowTitle: 'NOC · Original alert',
      workflowDescription: 'NOC routing context',
      workflowTags: ['teams:network'],
      workflowAffectedEntityTypes: ['SERVICE'],
    };
    const updatedProblem = {
      ...makeProblem('MATCHED', 'Latest canonical title'),
      status: 'CLOSED' as const,
      endTime: 1_750_003_600_000,
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([existingProblem]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({
        id: 'sync-1',
        key: 'primary',
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
        lastReconciledAt: new Date().toISOString(),
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(matcherConfig), getPublicSettings: vi.fn() };
    const client = {
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [updatedProblem],
        changedProblems: [],
        totalCount: 1,
        resultTruncated: false,
        workflowMetadataComplete: false,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(problemCollection.update).toHaveBeenCalledWith(
      'matched-record',
      {
        ...updatedProblem,
        workflowTitle: 'NOC · Original alert',
        workflowDescription: 'NOC routing context',
        workflowTags: ['teams:network'],
        workflowAffectedEntityTypes: ['SERVICE'],
      },
      { requestKey: null },
    );
  });

  it('clears stale workflow metadata only after a complete enrichment response', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const existingProblem = {
      id: 'matched-record',
      ...makeProblem('MATCHED', 'Original canonical title'),
      workflowTitle: 'NOC · Original alert',
      workflowDescription: 'NOC routing context',
      workflowTags: ['teams:network'],
      workflowAffectedEntityTypes: ['SERVICE'],
    };
    const updatedProblem = makeProblem('MATCHED', 'Latest canonical title');
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([existingProblem]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({
        id: 'sync-1',
        key: 'primary',
        lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
        lastReconciledAt: new Date().toISOString(),
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(matcherConfig), getPublicSettings: vi.fn() };
    const client = {
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [updatedProblem],
        changedProblems: [],
        totalCount: 1,
        resultTruncated: false,
        workflowMetadataComplete: true,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(problemCollection.update).toHaveBeenCalledWith(
      'matched-record',
      {
        ...updatedProblem,
        workflowTitle: '',
        workflowDescription: '',
        workflowTags: [],
        workflowAffectedEntityTypes: [],
      },
      { requestKey: null },
    );
  });

  it('preserves the last complete custom scope when a reconciliation result is truncated', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync-1', key: 'primary' }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = { load: vi.fn().mockReturnValue(matcherConfig), getPublicSettings: vi.fn() };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [makeProblem('PARTIAL', 'Partial result')],
        totalCount: 10_000,
        resultTruncated: true,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).rejects.toThrow(/truncated.*preserved/i);

    expect(problemCollection.getFullList).not.toHaveBeenCalled();
    expect(problemCollection.update).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'error', reconciliationPending: true }),
      { requestKey: null },
    );
  });

  it('fails closed and preserves the last good scope when Dynatrace stops returning profile metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T18:00:00.000Z'));
    const selectedConfig = { ...config, alertingProfiles: ['NOC Core'] };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({
        id: 'sync-1',
        key: 'primary',
        lastSuccessAt: '2026-08-07T17:55:00.000Z',
        availableAlertingProfiles: ['NOC Core'],
        consecutiveFailures: 0,
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(selectedConfig),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      inspectAlertingProfileField: vi.fn().mockResolvedValue({
        problemCount: 17,
        profiledProblemCount: 0,
        healthy: false,
      }),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn(),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).rejects.toThrow(/metadata.*preserved/i);

    expect(client.fetchProblems).not.toHaveBeenCalled();
    expect(problemCollection.getFullList).not.toHaveBeenCalled();
    expect(problemCollection.update).not.toHaveBeenCalled();
    expect(problemCollection.delete).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'error',
        profileFieldHealthy: false,
        consecutiveFailures: 1,
        staleSince: '2026-08-07T18:00:00.000Z',
      }),
      { requestKey: null },
    );

    vi.useRealTimers();
  });

  it('fails closed when a scoped reconciliation cannot refresh the profile catalog', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T18:00:00.000Z'));
    const selectedConfig = { ...config, alertingProfiles: ['NOC Core'] };
    const syncRecord: Record<string, unknown> = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: '2026-08-07T17:55:00.000Z',
      lastReconciledAt: '2026-08-07T17:59:00.000Z',
      availableAlertingProfiles: ['NOC Core'],
      profileCatalogCount: 1,
      matchedProfileCount: 1,
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn(async () => syncRecord),
      update: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(syncRecord, patch);
        return syncRecord;
      }),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(selectedConfig),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi
        .fn()
        .mockRejectedValueOnce(new Error('Catalog unavailable'))
        .mockRejectedValueOnce(new Error('Catalog still unavailable'))
        .mockResolvedValueOnce(['NOC Core']),
      inspectAlertingProfileField: vi.fn().mockResolvedValue({
        problemCount: 10,
        profiledProblemCount: 10,
        healthy: true,
      }),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [],
        totalCount: 0,
        resultTruncated: false,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow(true)).rejects.toThrow('Catalog unavailable');
    vi.advanceTimersByTime(61_000);
    await expect(manager.syncNow()).rejects.toThrow('Catalog still unavailable');

    expect(client.inspectAlertingProfileField).not.toHaveBeenCalled();
    expect(client.fetchProblems).not.toHaveBeenCalled();
    expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(2);
    expect(problemCollection.getFullList).not.toHaveBeenCalled();
    expect(problemCollection.update).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'error',
        error: 'Catalog still unavailable',
        profileCatalogCount: 1,
        matchedProfileCount: 1,
        reconciliationPending: true,
      }),
      { requestKey: null },
    );

    vi.advanceTimersByTime(61_000);
    await expect(manager.syncNow()).resolves.toBe(0);

    expect(client.fetchAlertingProfiles).toHaveBeenCalledTimes(3);
    expect(client.inspectAlertingProfileField).toHaveBeenCalledOnce();
    expect(client.fetchProblems).toHaveBeenCalledOnce();
    expect(problemCollection.getFullList).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('persists a failed forced reconciliation and retries it before incremental polling resumes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T18:00:00.000Z'));
    const selectedConfig = { ...config, alertingProfiles: ['NOC Core'] };
    const syncRecord: Record<string, unknown> = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: '2026-08-07T17:55:00.000Z',
      lastReconciledAt: '2026-08-07T17:55:00.000Z',
      availableAlertingProfiles: ['NOC Core'],
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn(async () => syncRecord),
      update: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(syncRecord, patch);
        return syncRecord;
      }),
      create: vi.fn(),
    };
    const pocketBase = {
      collection: vi.fn((name: string) =>
        name === DYNATRACE_PROBLEMS_COLLECTION ? problemCollection : syncCollection,
      ),
    };
    const store = {
      load: vi.fn().mockReturnValue(selectedConfig),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue(['NOC Core']),
      inspectAlertingProfileField: vi
        .fn()
        .mockResolvedValueOnce({ problemCount: 12, profiledProblemCount: 0, healthy: false })
        .mockResolvedValueOnce({ problemCount: 12, profiledProblemCount: 12, healthy: true }),
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi
        .fn()
        .mockResolvedValue({ problems: [], totalCount: 0, resultTruncated: false }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow(true)).rejects.toThrow(/metadata.*preserved/i);
    expect(syncRecord.reconciliationPending).toBe(true);

    vi.advanceTimersByTime(61_000);
    await expect(manager.syncNow()).resolves.toBe(0);

    expect(client.fetchProblems).toHaveBeenCalledWith(selectedConfig, { mode: 'reconcile' });
    expect(syncRecord.reconciliationPending).toBe(false);
    expect(syncRecord.state).toBe('ok');

    vi.useRealTimers();
  });

  it('restores a future persisted retry deadline after a process restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T18:00:00.000Z'));
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue({
        id: 'sync-1',
        key: 'primary',
        lastSuccessAt: '2026-08-07T17:55:00.000Z',
        lastReconciledAt: '2026-08-07T17:55:00.000Z',
        nextRetryAt: '2026-08-07T18:02:00.000Z',
      }),
      update: vi.fn(),
      create: vi.fn(),
    };
    const pocketBase = { collection: vi.fn(() => syncCollection) };
    const store = {
      load: vi.fn().mockReturnValue(config),
      getPublicSettings: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const client = { fetchProblems: vi.fn(), testConnection: vi.fn() };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(0);

    expect(client.fetchProblems).not.toHaveBeenCalled();
    expect(syncCollection.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('records consecutive failures and Dynatrace retry guidance without replacing the last success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T18:00:00.000Z'));
    const previousSync = {
      id: 'sync-1',
      key: 'primary',
      lastSuccessAt: '2026-08-07T17:30:00.000Z',
      lastReconciledAt: '2026-08-07T17:30:00.000Z',
      staleSince: '2026-08-07T17:45:00.000Z',
      consecutiveFailures: 2,
    };
    const problemCollection = {
      getFullList: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
    };
    const syncCollection = {
      getFirstListItem: vi.fn().mockResolvedValue(previousSync),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn(),
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
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi
        .fn()
        .mockRejectedValue(new Error('Dynatrace rate-limited the Grail query.', { cause: 90_000 })),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).rejects.toThrow(/rate-limited/i);

    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'error',
        consecutiveFailures: 3,
        staleSince: '2026-08-07T17:45:00.000Z',
        nextRetryAt: '2026-08-07T18:01:30.000Z',
      }),
      { requestKey: null },
    );
    expect(syncCollection.update.mock.calls.at(-1)?.[1]).not.toHaveProperty('lastSuccessAt');

    vi.useRealTimers();
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
    const staleExcluded = {
      ...oldOpen,
      scopeExcluded: true,
      scopeExcludedAt: new Date(Date.now() - 366 * day).toISOString(),
    };
    const retainedProblems = [expiredClosed, recentClosed, oldOpen].map((problem) => ({
      ...problem,
      alertingProfiles: [],
      scopeExcluded: false,
    }));
    const problemCollection = {
      getFullList: vi
        .fn()
        .mockResolvedValueOnce(retainedProblems)
        .mockResolvedValueOnce(retainedProblems)
        .mockResolvedValueOnce([staleExcluded]),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(true),
    };
    const noteCollection = {
      getFullList: vi.fn().mockResolvedValue([
        { id: 'expired-note', problemId: 'EXPIRED-PROBLEM' },
        { id: 'stale-note', problemId: 'OLD-OPEN-PROBLEM' },
      ]),
      delete: vi.fn().mockResolvedValue(true),
    };
    const stateCollection = {
      getFullList: vi.fn().mockResolvedValue([
        { id: 'expired-state', problemId: 'EXPIRED-PROBLEM' },
        { id: 'stale-state', problemId: 'OLD-OPEN-PROBLEM' },
      ]),
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
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(0);

    expect(problemCollection.getFullList).toHaveBeenCalledWith({
      filter: expect.stringContaining('status="CLOSED"'),
      fields: 'id,problemId,status,endTime,scopeExcluded,scopeExcludedAt',
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
    expect(noteCollection.delete).toHaveBeenCalledWith('stale-note', { requestKey: null });
    expect(stateCollection.delete).toHaveBeenCalledWith('expired-state', { requestKey: null });
    expect(stateCollection.delete).toHaveBeenCalledWith('stale-state', { requestKey: null });
    expect(problemCollection.delete).toHaveBeenCalledTimes(2);
    expect(problemCollection.delete).toHaveBeenCalledWith('expired-record', { requestKey: null });
    expect(problemCollection.delete).toHaveBeenCalledWith('open-record', { requestKey: null });

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
      lastReconciledAt: '2026-07-10T19:30:00.000Z',
      availableAlertingProfiles: ['Payments Production'],
      resultTruncated: true,
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
      fetchNotificationTitles: vi
        .fn()
        .mockRejectedValue(new Error('Workflow name reads unavailable in this fixture')),
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [{ ...unchangedProblem, syncedAt: '2026-07-10T20:00:00.000Z' }],
        totalCount: 1,
        resultTruncated: false,
      }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      withLiveClient(client),
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(client.fetchProblems).toHaveBeenCalledWith(config, {
      mode: 'incremental',
      lookbackMinutes: 120,
    });
    expect(client.fetchAlertingProfiles).not.toHaveBeenCalled();
    expect(problemCollection.getFullList).toHaveBeenCalledTimes(2);
    expect(problemCollection.getFullList).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'problemId="UNCHANGED"' }),
    );
    expect(problemCollection.update).not.toHaveBeenCalled();
    expect(problemCollection.create).not.toHaveBeenCalled();
    expect(problemCollection.delete).not.toHaveBeenCalled();
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({
        state: 'ok',
        lastSuccessAt: '2026-07-10T20:00:00.000Z',
        resultTruncated: true,
      }),
      { requestKey: null },
    );
    expect(syncCollection.update.mock.calls.at(-1)?.[1]).not.toHaveProperty('lastReconciledAt');

    vi.useRealTimers();
  });
});

describe('workflow email title synchronization', () => {
  const subject = 'AZ-EMAZ-365 | Device Offline | PTMP-CPE01-3';
  function setup() {
    const now = new Date().toISOString();
    const stored: DynatraceProblemRecord = {
      ...makeProblem('problem-1', 'Network availability monitor outage'),
      id: 'record-1',
      notificationTitle: 'Previous workflow wording',
      notificationStatus: 'OPEN',
      notificationUpdatedAt: 1000,
    };
    const records = {
      getFullList: vi.fn().mockImplementation(async () => [{ ...stored }]),
      update: vi
        .fn()
        .mockImplementation(async (_id: string, patch: Partial<DynatraceProblemRecord>) =>
          Object.assign(stored, patch),
        ),
      create: vi.fn(),
    };
    const sync = {
      getFirstListItem: vi
        .fn()
        .mockResolvedValue({ id: 'sync', lastSuccessAt: now, lastReconciledAt: now }),
      update: vi.fn().mockResolvedValue({}),
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      fetchNotificationTitles: vi.fn().mockResolvedValue({
        titles: [
          {
            problemId: 'problem-1',
            notificationTitle: subject,
            notificationStatus: 'OPEN',
            notificationUpdatedAt: 2000,
          },
        ],
        complete: true,
      }),
    };
    const manager = new DynatraceProblemsManager(
      { load: () => config } as unknown as DynatraceProblemsConfigStore,
      () =>
        ({
          collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
        }) as never,
      withLiveClient(client),
    );
    return { manager, stored, records, sync, client };
  }
  it('updates a delayed email even when no canonical problems changed', async () => {
    const { manager, stored, records } = setup();
    await expect(manager.syncNow()).resolves.toBe(0);
    expect(stored.notificationTitle).toBe(subject);
    expect(stored.title).toBe('Network availability monitor outage');
    expect(records.update).toHaveBeenCalledWith(
      'record-1',
      { notificationTitle: subject, notificationStatus: 'OPEN', notificationUpdatedAt: 2000 },
      { requestKey: null },
    );
    expect(records.create).not.toHaveBeenCalled();
  });
  it('saves immediately and applies an available subject as a separate background update', async () => {
    const { manager, records, client } = setup();
    records.getFullList.mockResolvedValue([]);
    records.create.mockImplementation(async (value) => {
      const created = { id: 'new-row', ...value };
      records.getFullList.mockResolvedValue([created]);
      return created;
    });
    client.fetchProblems.mockResolvedValue({
      problems: [makeProblem('problem-1', 'Original')],
      totalCount: 1,
    } as never);
    await manager.syncNow();
    await manager.stopForRestore();
    expect(records.create.mock.calls[0]?.[0]).not.toHaveProperty('notificationTitle');
    expect(records.update).toHaveBeenCalledWith(
      'new-row',
      expect.objectContaining({ notificationTitle: subject, notificationStatus: 'OPEN' }),
      { requestKey: null },
    );
  });
  it('shows the canonical problem immediately and aborts a hung name query after ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const { manager, records, client } = setup();
      records.getFullList.mockResolvedValue([]);
      records.create.mockResolvedValue({ id: 'new-row', ...makeProblem('problem-1', 'Original') });
      client.fetchProblems.mockResolvedValue({
        problems: [makeProblem('problem-1', 'Original')],
        totalCount: 1,
      } as never);
      let finish!: (value: unknown) => void;
      client.fetchNotificationTitles.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const syncing = manager.syncNow();
      await vi.advanceTimersByTimeAsync(9999);
      expect(records.create).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(records.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Original' }), {
        requestKey: null,
      });
      expect(records.create.mock.calls[0]?.[0]).not.toHaveProperty('notificationTitle');
      await expect(syncing).resolves.toBe(1);
      expect(client.fetchNotificationTitles.mock.calls[0]?.[2]?.signal.aborted).toBe(true);
      finish({
        titles: [
          {
            problemId: 'problem-1',
            notificationTitle: 'Too late for this poll',
            notificationStatus: 'OPEN',
            notificationUpdatedAt: 2000,
          },
        ],
        complete: true,
      });
      await vi.advanceTimersByTimeAsync(1);
      expect(records.update).not.toHaveBeenCalled();
      expect(records.create).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a fast execution subject when a sibling lookup hangs until the deadline', async () => {
    vi.useFakeTimers();
    try {
      const { manager, records, client } = setup();
      records.getFullList.mockResolvedValue([]);
      const created: DynatraceProblemRecord[] = [];
      records.create.mockImplementation(async (problem) => {
        const record = { id: problem.problemId, ...problem };
        created.push(record);
        records.getFullList.mockResolvedValue(created);
        return record;
      });
      client.fetchProblems.mockResolvedValue({
        problems: [makeProblem('problem-1', 'Fast'), makeProblem('problem-2', 'Hung')],
        totalCount: 2,
      } as never);
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/storage/query/'))
          return Response.json({
            state: 'SUCCEEDED',
            requestToken: 'query-token',
            result: {
              records: [1, 2].map((id) => ({
                problemId: `problem-${id}`,
                executionId: `execution-${id}`,
                notificationStatus: 'ACTIVE',
                notificationTime: '2026-09-10T20:00:00.000Z',
              })),
            },
          });
        if (url.includes('/execution-2/'))
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          });
        if (url.endsWith('/tasks'))
          return Response.json({
            email_noc: {
              action: 'dynatrace.email:send-email',
              state: 'SUCCESS',
            },
          });
        return new Promise((resolve) =>
          setTimeout(() => resolve(Response.json({ subject })), 1000),
        );
      });
      const realClient = new DynatraceProblemsClient(fetchMock);
      client.fetchNotificationTitles.mockImplementation((configuration, scope, context) =>
        realClient.fetchNotificationTitles(
          { ...configuration, workflowId: undefined },
          scope,
          context,
        ),
      );
      const syncing = manager.syncNow();
      await vi.advanceTimersByTimeAsync(9999);
      expect(records.create).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(syncing).resolves.toBe(2);
      expect(records.update).toHaveBeenCalledWith(
        'problem-1',
        expect.objectContaining({
          notificationTitle: subject,
        }),
        { requestKey: null },
      );
      const hung = records.create.mock.calls.find(([problem]) => problem.problemId === 'problem-2');
      expect(hung?.[0]).not.toHaveProperty('notificationTitle');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retries a missing name on the next background interval without repeating Grail queries every second', async () => {
    vi.useFakeTimers();
    try {
      const { manager, records, client, stored } = setup();
      client.fetchProblems.mockResolvedValue({
        problems: [makeProblem('problem-1', 'Original')],
        totalCount: 1,
      } as never);
      client.fetchNotificationTitles.mockResolvedValueOnce({ titles: [], complete: false });
      await manager.syncNow();
      expect(stored.title).toBe('Original');
      await vi.advanceTimersByTimeAsync(10000);
      await manager.syncNow();
      expect(client.fetchNotificationTitles).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(50000);
      await manager.syncNow();
      await manager.stopForRestore();
      expect(client.fetchNotificationTitles).toHaveBeenCalledTimes(2);
      expect(records.update).toHaveBeenCalledWith(
        'record-1',
        expect.objectContaining({ notificationTitle: subject }),
        { requestKey: null },
      );
    } finally {
      vi.useRealTimers();
    }
  });
  const titleTicks = new WeakMap<DynatraceProblemsManager, number>();
  async function nextTitlePoll(manager: DynatraceProblemsManager): Promise<void> {
    const next = Math.max(Date.now(), titleTicks.get(manager) ?? 0) + 60000;
    titleTicks.set(manager, next);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(next);
    try {
      await manager.syncNow();
    } finally {
      clock.mockRestore();
    }
  }
  it('reconciles missed names after an optional read fails, even outside the incremental window', async () => {
    const { manager, client } = setup();
    await nextTitlePoll(manager);
    client.fetchNotificationTitles.mockRejectedValueOnce(new Error('Temporary outage'));
    await nextTitlePoll(manager);
    await nextTitlePoll(manager);
    expect(client.fetchNotificationTitles.mock.calls[1]?.[1]).toMatchObject({
      mode: 'incremental',
    });
    expect(client.fetchNotificationTitles.mock.calls[2]?.[1]).toEqual({ mode: 'reconcile' });
  });

  it('continues full catch-up while later or still-running executions remain', async () => {
    const { manager, client, stored } = setup();
    client.fetchNotificationTitles.mockResolvedValueOnce({
      titles: [
        {
          problemId: 'problem-1',
          notificationTitle: subject,
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 2000,
        },
      ],
      complete: false,
    });
    await nextTitlePoll(manager);
    expect(stored.notificationTitle).toBe(subject);
    await nextTitlePoll(manager);
    expect(client.fetchNotificationTitles.mock.calls[1]?.[1]).toEqual({ mode: 'reconcile' });
    await nextTitlePoll(manager);
    expect(client.fetchNotificationTitles.mock.calls[2]?.[1]).toMatchObject({
      mode: 'incremental',
    });
  });

  it('picks up another workflow rename without new Relay mapping code', async () => {
    const { manager, stored, client } = setup();
    await nextTitlePoll(manager);
    client.fetchNotificationTitles.mockResolvedValue({
      titles: [
        {
          problemId: 'problem-1',
          notificationTitle: 'Completely new workflow name',
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 3000,
        },
      ],
      complete: true,
    });
    await nextTitlePoll(manager);
    expect(stored.notificationTitle).toBe('Completely new workflow name');
  });
  it.each([500, 1000])('ignores stale or replayed notification time %i', async (time) => {
    const { manager, stored, records, client } = setup();
    client.fetchNotificationTitles.mockResolvedValue({
      titles: [
        {
          problemId: 'problem-1',
          notificationTitle: subject,
          notificationStatus: 'OPEN',
          notificationUpdatedAt: time,
        },
      ],
      complete: true,
    });
    await manager.syncNow();
    expect(stored.notificationTitle).toBe('Previous workflow wording');
    expect(records.update).not.toHaveBeenCalled();
  });
  it('cannot add out-of-scope problems or change an excluded problem', async () => {
    const { manager, stored, records, client } = setup();
    stored.scopeExcluded = true;
    client.fetchNotificationTitles.mockResolvedValue({
      titles: [
        {
          problemId: 'problem-1',
          notificationTitle: subject,
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 2000,
        },
        {
          problemId: 'outside',
          notificationTitle: 'Out of scope',
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 2000,
        },
      ],
      complete: true,
    });
    await manager.syncNow();
    expect(records.create).not.toHaveBeenCalled();
    expect(records.update).not.toHaveBeenCalled();
  });
  it('preserves the last name and still updates canonical state if notification reads fail', async () => {
    const { manager, stored, client, sync } = setup();
    client.fetchProblems.mockResolvedValue({
      problems: [
        {
          ...makeProblem('problem-1', 'Updated canonical title'),
          status: 'CLOSED',
          endTime: Date.now(),
        },
      ],
      totalCount: 1,
    } as never);
    client.fetchNotificationTitles.mockRejectedValue(
      new Error('403: business event access unavailable'),
    );
    await expect(manager.syncNow()).resolves.toBe(1);
    expect(stored.status).toBe('CLOSED');
    expect(stored.notificationTitle).toBe('Previous workflow wording');
    expect(sync.update).toHaveBeenLastCalledWith(
      'sync',
      expect.objectContaining({ state: 'ok' }),
      expect.anything(),
    );
  });
});

it.each(['success', 'failure'])(
  'keeps disabled final when a late %s poll settles after clear',
  async (outcome) => {
    let settle!: () => void;
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const sync = { getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }), update };
    let configured = true;
    const store = {
      load: () => (configured ? config : null),
      clear: () => {
        configured = false;
        return true;
      },
    };
    const client = {
      fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
      fetchProblems: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            settle = () =>
              outcome === 'failure'
                ? reject(new Error('late failure'))
                : resolve({ problems: [makeProblem('late', 'Late outage')], totalCount: 1 });
          }),
      ),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () =>
        ({
          collection: (name: string) =>
            name === DYNATRACE_PROBLEMS_COLLECTION ? { create } : sync,
        }) as never,
      withLiveClient(client),
    );
    const polling = manager.syncNow();
    await vi.waitFor(() => expect(client.fetchProblems).toHaveBeenCalledOnce());
    expect(manager.clearSettings()).toBe(true);
    settle();
    await polling;
    await manager.stopForRestore();
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(
      'sync',
      expect.objectContaining({ state: 'disabled' }),
      { requestKey: null },
    );
    expect(update.mock.calls.map(([, data]) => data.state)).not.toContain('ok');
    expect(update.mock.calls.map(([, data]) => data.state)).not.toContain('error');
  },
);

it('excludes the previous environment and reinstates its history when that environment returns', async () => {
  let current = { ...config };
  const stored = [
    { ...makeProblem('old', 'Old environment outage'), id: 'old-row' },
    {
      ...makeProblem('new', 'New environment outage'),
      id: 'new-row',
      environmentUrl: 'https://new.apps.dynatrace.com',
    },
  ];
  const records = {
    getFullList: vi.fn(async (options: { filter?: string }) => (options.filter ? [] : stored)),
    update: vi.fn(async (id: string, changes: Record<string, unknown>) =>
      Object.assign(
        stored.find((row) => row.id === id)!,
        changes,
      ),
    ),
    delete: vi.fn(),
  };
  const sync = {
    getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }),
    update: vi.fn().mockResolvedValue({}),
  };
  const store = { load: () => current };
  const client = {
    fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
    fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
    fetchNotificationTitles: vi.fn().mockRejectedValue(new Error('unavailable')),
  };
  const manager = new DynatraceProblemsManager(
    store as unknown as DynatraceProblemsConfigStore,
    () =>
      ({
        collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
      }) as never,
    withLiveClient(client),
  );
  current = { ...config, environmentUrl: 'https://new.apps.dynatrace.com' };
  await manager.syncNow(true);
  expect(stored[0]?.scopeExcluded).toBe(true);
  expect(stored[1]?.scopeExcluded).toBe(false);
  current = { ...config };
  await manager.syncNow(true);
  expect(stored[0]?.scopeExcluded).toBe(false);
  expect(stored[1]?.scopeExcluded).toBe(true);
  expect(records.delete).not.toHaveBeenCalled();
});

it('continues polling but skips automatic history deletion when verified backup is unavailable', async () => {
  const record = {
    ...makeProblem('expired', 'Old history'),
    id: 'expired',
    status: 'CLOSED',
    endTime: 1,
  };
  const records = {
    getFullList: vi.fn().mockResolvedValue([record]),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const sync = {
    getFirstListItem: vi.fn().mockResolvedValue({ id: 'sync' }),
    update: vi.fn().mockResolvedValue({}),
  };
  const client = {
    fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
    fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
    fetchNotificationTitles: vi.fn().mockRejectedValue(new Error('unavailable')),
  };
  const manager = new DynatraceProblemsManager(
    { load: () => config } as unknown as DynatraceProblemsConfigStore,
    () =>
      ({
        collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
      }) as never,
    withLiveClient(client),
    () => false,
  );
  await expect(manager.syncNow(true)).resolves.toBe(0);
  expect(client.fetchProblems).toHaveBeenCalledOnce();
  expect(records.delete).not.toHaveBeenCalled();
  expect(records.getFullList).not.toHaveBeenCalledWith(
    expect.objectContaining({ filter: expect.stringContaining('status="CLOSED"') }),
  );
  expect(sync.update).toHaveBeenLastCalledWith('sync', expect.objectContaining({ state: 'ok' }), {
    requestKey: null,
  });
});

// Lifecycle fixtures use preauthorized responses; OAuthIntegration verifies actual credential exchange.
vi.mock('./DynatraceAuthentication', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./DynatraceAuthentication')>();
  const authentication = new actual.DynatraceAuthentication();
  authentication.token = vi.fn(async (config) => config.apiToken);
  return { ...actual, dynatraceAuthentication: () => authentication };
});
