import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudStatusData, CloudStatusItem, CloudStatusSnapshotRecord } from '@shared/ipc';

const { secureStorageMock, resetStorage } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    resetStorage: () => values.clear(),
    secureStorageMock: {
      getItemSync: vi.fn((key: string) => values.get(key)),
      setItemSync: vi.fn((key: string, value: unknown) => values.set(key, value)),
    },
  };
});

const { collectionState, mockUseCollection } = vi.hoisted(() => ({
  collectionState: {
    data: [] as CloudStatusSnapshotRecord[],
    loading: false,
    error: null as string | null,
  },
  mockUseCollection: vi.fn(),
}));

vi.mock('../../utils/secureStorage', () => ({ secureStorage: secureStorageMock }));
vi.mock('../../utils/logger', () => ({
  loggers: { app: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
}));
vi.mock('../useCollection', () => ({
  useCollection: (...args: unknown[]) => {
    mockUseCollection(...args);
    return { ...collectionState, refetch: vi.fn() };
  },
}));

import { loggers } from '../../utils/logger';
import { useAppCloudStatus } from '../useAppCloudStatus';

function emptyProviders(): CloudStatusData['providers'] {
  return {
    aws: [],
    azure: [],
    m365: [],
    jira: [],
    github: [],
    cloudflare: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  };
}

function item(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return {
    id: 'incident-1',
    provider: 'aws',
    title: 'S3 outage',
    description: '',
    pubDate: '2026-07-10T18:00:00.000Z',
    link: '',
    severity: 'error',
    ...overrides,
  };
}

function status(items: CloudStatusItem[] = []): CloudStatusData {
  const providers = emptyProviders();
  for (const current of items) providers[current.provider].push(current);
  return { providers, errors: [], lastUpdated: Date.now() };
}

function snapshot(data: CloudStatusData): CloudStatusSnapshotRecord {
  return {
    id: 'snapshot-1',
    key: 'current',
    contentHash: 'hash',
    created: '2026-07-10T18:00:00.000Z',
    updated: '2026-07-10T18:00:00.000Z',
    ...data,
  };
}

describe('useAppCloudStatus', () => {
  const showToast = vi.fn();
  const getCloudStatus = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    resetStorage();
    collectionState.data = [];
    collectionState.loading = false;
    collectionState.error = null;
    getCloudStatus.mockResolvedValue(status());
    (globalThis as Window & { api: { getCloudStatus: typeof getCloudStatus } }).api = {
      getCloudStatus,
    } as unknown as typeof globalThis.api;
  });

  afterEach(() => vi.useRealTimers());

  it('renders the realtime server snapshot without making an initial provider request', async () => {
    const shared = status([item({ severity: 'info' })]);
    collectionState.data = [snapshot(shared)];

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData).toEqual(shared));
    expect(getCloudStatus).not.toHaveBeenCalled();
    expect(mockUseCollection).toHaveBeenCalledWith('cloud_status_snapshot', {
      filter: 'key="current"',
    });
  });

  it('keeps the last snapshot as an offline fallback regardless of age', async () => {
    const cached = status([item({ severity: 'info' })]);
    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now() - 30 * 24 * 60 * 60_000,
      data: cached,
    });

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData).toEqual(cached));
    expect(getCloudStatus).not.toHaveBeenCalled();
  });

  it('caches each shared snapshot locally', async () => {
    const shared = status();
    collectionState.data = [snapshot(shared)];

    renderHook(() => useAppCloudStatus(showToast));
    await waitFor(() =>
      expect(secureStorageMock.setItemSync).toHaveBeenCalledWith(
        'cached_cloud_status',
        expect.objectContaining({ data: shared }),
      ),
    );
  });

  it('notifies once for a new warning or outage received over realtime', async () => {
    collectionState.data = [snapshot(status([item()]))];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('AWS Outage: S3 outage', 'error'));

    showToast.mockClear();
    collectionState.data = [snapshot(status([item()]))];
    rerender();

    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not notify for informational events', async () => {
    collectionState.data = [snapshot(status([item({ severity: 'info' })]))];

    renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('uses IPC only for an explicit manual refresh', async () => {
    const manual = status([item({ severity: 'info' })]);
    getCloudStatus.mockResolvedValue(manual);
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    let refresh: Promise<void>;
    act(() => {
      refresh = result.current.refetch();
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await refresh;
    });

    expect(getCloudStatus).toHaveBeenCalledTimes(1);
    expect(result.current.statusData).toEqual(manual);
    expect(result.current.loading).toBe(false);
  });

  it('does not start a renderer polling loop', async () => {
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(getCloudStatus).not.toHaveBeenCalled();
  });

  it('keeps cached data and logs when a manual refresh fails', async () => {
    const cached = status();
    secureStorageMock.setItemSync('cached_cloud_status', { fetchedAt: Date.now(), data: cached });
    getCloudStatus.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      const refresh = result.current.refetch();
      await vi.advanceTimersByTimeAsync(500);
      await refresh;
    });

    expect(result.current.statusData).toEqual(cached);
    expect(loggers.app.error).toHaveBeenCalledWith(
      'Cloud status fetch failed',
      expect.objectContaining({ error: 'Network error', category: 'NETWORK' }),
    );
  });
});
