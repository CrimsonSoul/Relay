import { describe, expect, it, vi } from 'vitest';
import { DynatraceProblemsManager } from './DynatraceProblemsManager';
import type {
  DynatraceProblemsConfig,
  DynatraceProblemsConfigStore,
} from './DynatraceProblemsConfigStore';
import type { DynatraceProblemsClient } from './DynatraceProblemsClient';

function setup() {
  let config: DynatraceProblemsConfig = {
    environmentUrl: 'https://test.apps.dynatrace.com',
    apiToken: 'fixture',
    alertingProfiles: null,
    customDqlMatcher: 'event.name == "old"',
    workflowId: 'workflow-1',
    workflowDqlTask: 'noc',
  };
  const checkpoint = {
    id: 'sync-1',
    lastSuccessAt: new Date().toISOString(),
    lastReconciledAt: new Date().toISOString(),
  };
  const collection = {
    getFirstListItem: vi.fn(async () => checkpoint),
    getFullList: vi.fn(async () => []),
    update: vi.fn(async (_id: string, data: object) => Object.assign(checkpoint, data)),
    create: vi.fn(),
  };
  const store = {
    load: () => config,
    saveProblemScope: vi.fn((scope) => {
      config = { ...config, ...scope };
      return config;
    }),
  };
  const empty = {
    problems: [],
    changedProblems: [],
    totalCount: 0,
    workflowMetadataComplete: true,
  };
  const client = {
    refreshWorkflowScope: vi.fn(
      async (current: DynatraceProblemsConfig): Promise<DynatraceProblemsConfig> => ({
        ...current,
        customDqlMatcher: 'event.name == "new"',
      }),
    ),
    fetchLiveProblems: vi.fn(async () => empty),
    fetchProblems: vi.fn(async () => empty),
    fetchNotificationTitles: vi.fn(async () => ({ titles: [], complete: true })),
  };
  const manager = new DynatraceProblemsManager(
    store as unknown as DynatraceProblemsConfigStore,
    () => ({ collection: () => collection }) as never,
    client as unknown as DynatraceProblemsClient,
  );
  return { manager, store, client, collection, empty };
}

describe('automatic workflow DQL synchronization', () => {
  it('persists the current filter before the live poll without starting a historical query', async () => {
    const { manager, store, client } = setup();
    try {
      await manager.syncLiveNow();
      expect(store.saveProblemScope).toHaveBeenCalledWith(
        expect.objectContaining({
          customDqlMatcher: 'event.name == "new"',
          workflowDqlTask: 'noc',
        }),
      );
      expect(client.fetchLiveProblems).toHaveBeenCalledWith(
        expect.objectContaining({ customDqlMatcher: 'event.name == "new"' }),
        expect.anything(),
        [],
      );
      expect(client.fetchProblems).not.toHaveBeenCalled();
      await manager.syncLiveNow();
      expect(store.saveProblemScope).toHaveBeenCalledTimes(1);
    } finally {
      await manager.stopForRestore();
    }
  });
  it('keeps saved scope and lifecycle polling when the source is unavailable', async () => {
    const { manager, store, client } = setup();
    client.refreshWorkflowScope.mockRejectedValue(new Error('Workflow source unavailable'));
    try {
      await manager.syncLiveNow();
      expect(store.saveProblemScope).not.toHaveBeenCalled();
      expect(client.fetchLiveProblems).toHaveBeenCalledWith(
        expect.objectContaining({
          customDqlMatcher: 'event.name == "old"',
          workflowScopeError: 'Workflow source unavailable',
        }),
        expect.anything(),
        [],
      );
    } finally {
      await manager.stopForRestore();
    }
  });
  it('prevents an older historical response from committing after the filter changes', async () => {
    const { manager, client, collection, empty } = setup();
    client.refreshWorkflowScope.mockImplementationOnce(async (current) => current);
    let finish!: (value: typeof empty) => void;
    client.fetchProblems.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const history = manager.syncNow(true);
    try {
      await vi.waitFor(() => expect(client.fetchProblems).toHaveBeenCalled());
      await manager.syncLiveNow();
      const writes = collection.update.mock.calls.length;
      finish(empty);
      await history;
      expect(collection.update).toHaveBeenCalledTimes(writes);
    } finally {
      finish?.(empty);
      await manager.stopForRestore();
    }
  });
});
