import { afterEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  type DynatraceProblemRecord,
} from '@shared/dynatraceProblems';
import { DynatraceProblemsManager } from './DynatraceProblemsManager';
import type {
  DynatraceProblemsConfig,
  DynatraceProblemsConfigStore,
} from './DynatraceProblemsConfigStore';
import type {
  DynatraceProblemsClient,
  DynatraceProblemsFetchResult,
  DynatraceNotificationReadContext,
} from './DynatraceProblemsClient';

const config: DynatraceProblemsConfig = {
  environmentUrl: 'https://test.apps.dynatrace.com',
  apiToken: 'secret',
  alertingProfiles: null,
  customDqlMatcher: null,
};
function problem(status: 'OPEN' | 'CLOSED' = 'OPEN') {
  return {
    problemId: 'problem-1',
    title: 'Original title',
    displayId: 'P-1',
    status,
    severity: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: Date.now() - 86400000,
    endTime: status === 'OPEN' ? -1 : Date.now(),
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    alertingProfiles: [],
    rootCauseName: '',
    environmentUrl: config.environmentUrl,
    syncedAt: new Date().toISOString(),
  } satisfies Omit<DynatraceProblemRecord, 'id'>;
}
function result(problems = [problem()]): DynatraceProblemsFetchResult {
  return {
    problems,
    changedProblems: null,
    workflowMetadataComplete: true,
    resultTruncated: false,
    totalCount: problems.length,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(configuration = config) {
  const rows = new Map<string, DynatraceProblemRecord>();
  const syncState: Record<string, unknown> = {
    id: 'sync',
    state: 'ok',
    lastSuccessAt: new Date().toISOString(),
  };
  const records = {
    getFullList: vi.fn(async (options?: { filter?: string }) => {
      const values = [...rows.values()];
      if (options?.filter?.includes('status="OPEN"'))
        return values.filter((row) => row.status === 'OPEN' && !row.scopeExcluded);
      return values;
    }),
    create: vi.fn(async (value: Omit<DynatraceProblemRecord, 'id'>) => {
      const row = { id: value.problemId, ...value };
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (id: string, value: Partial<DynatraceProblemRecord>) => {
      const row = rows.get(id);
      if (!row) throw new Error('Missing record');
      Object.assign(row, value);
      return row;
    }),
  };
  const sync = {
    getFirstListItem: vi.fn(async () => ({ ...syncState })),
    update: vi.fn(async (_id: string, value: object) => Object.assign(syncState, value)),
  };
  const client = {
    fetchProblems: vi.fn().mockResolvedValue(result()),
    fetchLiveProblems: vi.fn().mockResolvedValue(result()),
    fetchAlertingProfiles: vi.fn().mockResolvedValue([]),
    fetchNotificationTitles: vi.fn().mockRejectedValue(new Error('No optional title access')),
  };
  const manager = new DynatraceProblemsManager(
    { load: () => configuration } as DynatraceProblemsConfigStore,
    () =>
      ({
        collection: (name: string) => (name === DYNATRACE_PROBLEMS_COLLECTION ? records : sync),
      }) as unknown as PocketBase,
    client as unknown as DynatraceProblemsClient,
    () => false,
  );
  return { manager, rows, records, client, syncState };
}
afterEach(() => vi.useRealTimers());

describe('live Dynatrace synchronization', () => {
  it('saves live problems while history is pending and never lets delayed history reopen a closed problem', async () => {
    const { manager, client, rows } = setup();
    const historical = deferred<DynatraceProblemsFetchResult>();
    client.fetchProblems.mockReturnValue(historical.promise);
    const historySync = manager.syncNow(true);
    await vi.waitFor(() => expect(client.fetchProblems).toHaveBeenCalledOnce());
    await manager.syncLiveNow();
    expect(rows.get('problem-1')?.status).toBe('OPEN');
    client.fetchLiveProblems.mockResolvedValue(result([problem('CLOSED')]));
    await manager.syncLiveNow();
    historical.resolve(result([problem('OPEN')]));
    await historySync;
    expect(rows.get('problem-1')?.status).toBe('CLOSED');
    await manager.stopForRestore();
  });

  it('preserves a live DQL match that is still absent from the historical Grail result', async () => {
    const { manager, client, rows } = setup({
      ...config,
      customDqlMatcher: 'true',
      workflowId: 'workflow-1',
    });
    const historical = deferred<DynatraceProblemsFetchResult>();
    client.fetchProblems.mockReturnValue(historical.promise);
    client.fetchLiveProblems.mockResolvedValue({ ...result(), changedProblems: [problem()] });
    const historySync = manager.syncNow(true);
    await vi.waitFor(() => expect(client.fetchProblems).toHaveBeenCalledOnce());
    await manager.syncLiveNow();
    historical.resolve(result([]));
    await historySync;
    expect(rows.get('problem-1')).toMatchObject({ status: 'OPEN', scopeExcluded: false });
    await manager.stopForRestore();
  });

  it('continues updating admitted problems while DQL admission is unavailable', async () => {
    const { manager, client, rows, syncState } = setup({
      ...config,
      customDqlMatcher: 'true',
      workflowId: 'workflow-1',
    });
    rows.set('problem-1', {
      id: 'problem-1',
      ...problem(),
      workflowTitle: 'NOC name',
      scopeExcluded: false,
    });
    client.fetchLiveProblems.mockResolvedValue({
      ...result([]),
      changedProblems: [problem('CLOSED')],
      workflowMetadataComplete: false,
      scopeError: 'Workflow read unavailable',
    });
    await manager.syncLiveNow();
    expect(rows.get('problem-1')).toMatchObject({ status: 'CLOSED', workflowTitle: 'NOC name' });
    expect(syncState).toMatchObject({ state: 'error', error: 'Workflow read unavailable' });
    await manager.stopForRestore();
  });

  it('writes immediately and continues live updates while a title read hangs, without retrying it every second', async () => {
    vi.useFakeTimers();
    const { manager, client, records, rows } = setup();
    const titles = deferred<never>();
    let context: DynatraceNotificationReadContext | undefined;
    client.fetchNotificationTitles.mockImplementation((_config, _scope, received) => {
      context = received;
      return titles.promise;
    });
    await manager.syncLiveNow();
    expect(records.create).toHaveBeenCalledOnce();
    expect(context?.signal.aborted).toBe(false);
    client.fetchLiveProblems.mockResolvedValue(result([problem('CLOSED')]));
    await manager.syncLiveNow();
    expect(rows.get('problem-1')?.status).toBe('CLOSED');
    await vi.advanceTimersByTimeAsync(10000);
    expect(context?.signal.aborted).toBe(true);
    expect(client.fetchNotificationTitles).toHaveBeenCalledOnce();
    await manager.stopForRestore();
  });

  it('polls every fifteen seconds even while a reconciliation remains pending', async () => {
    vi.useFakeTimers();
    const { manager, client } = setup();
    const historical = deferred<DynatraceProblemsFetchResult>();
    client.fetchProblems.mockReturnValue(historical.promise);
    manager.start();
    await vi.advanceTimersByTimeAsync(45000);
    expect(client.fetchLiveProblems).toHaveBeenCalledTimes(4);
    expect(client.fetchProblems).toHaveBeenCalledOnce();
    expect(client.fetchNotificationTitles).toHaveBeenCalledOnce();
    historical.resolve(result());
    await manager.stopForRestore();
  });
});
