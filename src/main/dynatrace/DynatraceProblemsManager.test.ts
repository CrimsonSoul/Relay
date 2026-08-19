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
  customDqlMatcher: null,
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
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [matchedProblem],
        totalCount: 1,
        resultTruncated: false,
        observedProblemIds: null,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [profileMatch, matcherOnlyMatch],
        totalCount: 2,
        resultTruncated: false,
        observedProblemIds: null,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(2);

    expect(problemCollection.create).toHaveBeenCalledWith(matcherOnlyMatch, { requestKey: null });
    expect(syncCollection.update).toHaveBeenLastCalledWith(
      'sync-1',
      expect.objectContaining({ state: 'ok', scopeSource: 'custom-dql' }),
      { requestKey: null },
    );
  });

  it('hides only observed changed problems that stop matching during incremental polling', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'dt.davis.mute.status == "NOT_MUTED"',
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
            problemId: 'LOST',
            alertingProfiles: [],
            scopeExcluded: false,
            scopeExcludedAt: '',
          },
        ]),
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
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [matchedProblem],
        totalCount: 1,
        resultTruncated: false,
        observedProblemIds: ['MATCHED', 'LOST'],
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
    );

    await expect(manager.syncNow()).resolves.toBe(1);

    expect(problemCollection.update).toHaveBeenCalledTimes(1);
    expect(problemCollection.update).toHaveBeenCalledWith(
      'lost-record',
      { scopeExcluded: true, scopeExcludedAt: expect.any(String) },
      { requestKey: null },
    );
  });

  it('preserves the last complete custom scope when a reconciliation result is truncated', async () => {
    const matcherConfig = {
      ...config,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    };
    const problemCollection = { getFullList: vi.fn(), update: vi.fn(), create: vi.fn() };
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
      fetchProblems: vi.fn().mockResolvedValue({
        problems: [makeProblem('PARTIAL', 'Partial result')],
        totalCount: 10_000,
        resultTruncated: true,
        observedProblemIds: null,
      }),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      fetchProblems: vi.fn(),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
      fetchProblems: vi
        .fn()
        .mockResolvedValue({ problems: [], totalCount: 0, resultTruncated: false }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      client as unknown as DynatraceProblemsClient,
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
    const problemCollection = { getFullList: vi.fn(), update: vi.fn(), create: vi.fn() };
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
      fetchProblems: vi
        .fn()
        .mockRejectedValue(new Error('Dynatrace rate-limited the Grail query.', { cause: 90_000 })),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      fetchProblems: vi.fn().mockResolvedValue({ problems: [], totalCount: 0 }),
      testConnection: vi.fn(),
    };
    const manager = new DynatraceProblemsManager(
      store as unknown as DynatraceProblemsConfigStore,
      () => pocketBase as never,
      client as unknown as DynatraceProblemsClient,
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
      lastReconciledAt: '2026-07-10T12:00:00.000Z',
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
