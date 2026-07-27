import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeAPI,
  CloudStatusData,
  CloudStatusItem,
  CloudStatusSnapshotRecord,
} from '@shared/ipc';

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
    pubDate: '2026-07-20T17:00:00.000Z',
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

function nextPoll(data: CloudStatusData): CloudStatusData {
  return { ...data, lastUpdated: data.lastUpdated + 60_000 };
}

describe('useAppCloudStatus', () => {
  const showToast = vi.fn();
  const openProvider = vi.fn();
  const getCloudStatus = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime('2026-07-20T18:00:00.000Z');
    vi.clearAllMocks();
    resetStorage();
    collectionState.data = [];
    collectionState.loading = false;
    collectionState.error = null;
    getCloudStatus.mockResolvedValue(status());
    // The hook only reads `getCloudStatus`; `Partial<BridgeAPI>` keeps that stub
    // checked against the real bridge contract without asserting a whole bridge.
    const bridge: Partial<BridgeAPI> = { getCloudStatus };
    vi.stubGlobal('api', bridge);
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

  it('uses the first uncached realtime snapshot as a silent outage baseline', async () => {
    const shared = status([item()]);
    collectionState.data = [snapshot(shared)];
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData).toEqual(shared));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('notifies only when a new outage arrives after the baseline', async () => {
    collectionState.data = [snapshot(status([item({ id: 'warning-1', severity: 'warning' })]))];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    collectionState.data = [
      snapshot(
        status([
          item({ id: 'warning-1', severity: 'warning' }),
          item({ id: 'outage-1', title: 'S3 outage', severity: 'error' }),
        ]),
      ),
    ];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'AWS Outage: S3 outage',
        'error',
        expect.objectContaining({
          title: 'Cloud outage',
          delivery: 'cloud-outage',
          action: expect.objectContaining({ label: 'View provider' }),
        }),
      ),
    );
    const options = showToast.mock.calls[0]?.[2];
    options?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('aws');
  });

  it('does not repeat an active outage received over realtime', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([item()]))];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());

    showToast.mockClear();
    collectionState.data = [snapshot(status([item()]))];
    rerender();

    expect(showToast).not.toHaveBeenCalled();
  });

  it('notifies when a known warning escalates to an outage', async () => {
    collectionState.data = [snapshot(status([item({ severity: 'warning' })]))];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
    rerender();

    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('notifies when a resolved outage later reopens with the same id', async () => {
    collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([item({ severity: 'resolved' })]))];
    rerender();
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([item({ severity: 'error' })]))];
    rerender();

    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('batches simultaneous new outages into one cloud toast', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [
      snapshot(
        status([
          item({ id: 'outage-1', title: 'S3 outage' }),
          item({ id: 'outage-2', provider: 'azure', title: 'Storage outage' }),
        ]),
      ),
    ];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'AWS Outage: S3 outage (+1 more)',
        'error',
        expect.objectContaining({ delivery: 'cloud-outage' }),
      ),
    );
    expect(showToast).toHaveBeenCalledOnce();
  });

  it.each(['info', 'resolved'] as const)(
    'does not notify for %s-only updates',
    async (severity) => {
      collectionState.data = [snapshot(status())];
      const { rerender } = renderHook(() => useAppCloudStatus(showToast));
      await act(async () => Promise.resolve());

      collectionState.data = [snapshot(status([item({ severity })]))];
      rerender();
      await act(async () => Promise.resolve());

      expect(showToast).not.toHaveBeenCalled();
    },
  );

  it('requires two consecutive snapshots before notifying for a degradation', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    const degraded = status([
      item({ id: 'degraded-1', severity: 'warning', title: 'Elevated API latency' }),
    ]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    collectionState.data = [snapshot(nextPoll(degraded))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'AWS Degraded: Elevated API latency',
        'warning',
        expect.objectContaining({
          title: 'Cloud degradation',
          delivery: 'cloud-degradation',
          action: expect.objectContaining({ label: 'View provider' }),
        }),
      ),
    );
    const options = showToast.mock.calls[0]?.[2];
    options?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('aws');
  });

  it('does not count the same provider poll twice', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const degraded = status([item({ severity: 'warning', title: 'Elevated API latency' })]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    collectionState.data = [snapshot(nextPoll(degraded))];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('keeps a degradation already present at startup as a silent baseline', async () => {
    const degraded = status([
      item({ id: 'degraded-1', severity: 'warning', title: 'Elevated API latency' }),
    ]);
    collectionState.data = [snapshot(degraded)];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(nextPoll(degraded))];
    rerender();
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not repeat or update a degradation toast until the provider recovers', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const degraded = status([item({ severity: 'warning', title: 'Elevated API latency' })]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(degraded);
    collectionState.data = [snapshot(confirmedDegradation)];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());

    showToast.mockClear();
    collectionState.data = [
      snapshot({
        ...status([
          item({ severity: 'warning', title: 'Elevated API latency' }),
          item({ id: 'degraded-2', severity: 'warning', title: 'Investigating latency' }),
        ]),
        lastUpdated: confirmedDegradation.lastUpdated + 60_000,
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('becomes eligible again only after an operational snapshot', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const degraded = status([item({ severity: 'warning', title: 'Elevated API latency' })]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(degraded);
    collectionState.data = [snapshot(confirmedDegradation)];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());

    showToast.mockClear();
    const operational = {
      ...status(),
      lastUpdated: confirmedDegradation.lastUpdated + 60_000,
    };
    collectionState.data = [snapshot(operational)];
    rerender();
    await act(async () => Promise.resolve());

    const reopenedDegradation = {
      ...degraded,
      lastUpdated: operational.lastUpdated + 60_000,
    };
    collectionState.data = [snapshot(reopenedDegradation)];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();
    collectionState.data = [snapshot(nextPoll(reopenedDegradation))];
    rerender();

    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('does not treat a provider feed error as recovery', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const degraded = status([item({ severity: 'warning', title: 'Elevated API latency' })]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(degraded);
    collectionState.data = [snapshot(confirmedDegradation)];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());

    showToast.mockClear();
    collectionState.data = [
      snapshot({
        ...nextPoll(confirmedDegradation),
        errors: [{ provider: 'aws', message: 'Feed unavailable' }],
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());

    const returnedDegradation = {
      ...degraded,
      lastUpdated: confirmedDegradation.lastUpdated + 120_000,
    };
    collectionState.data = [snapshot(returnedDegradation)];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(nextPoll(returnedDegradation))];
    rerender();
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not notify for scheduled maintenance', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const maintenance = status([
      item({ severity: 'warning', title: 'Scheduled database maintenance' }),
    ]);
    collectionState.data = [snapshot(maintenance)];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(nextPoll(maintenance))];
    rerender();
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('treats emergency maintenance as an actionable degradation', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const emergency = status([
      item({ severity: 'warning', title: 'Emergency maintenance affecting API traffic' }),
    ]);
    collectionState.data = [snapshot(emergency)];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(nextPoll(emergency))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'AWS Degraded: Emergency maintenance affecting API traffic',
        'warning',
        expect.objectContaining({ delivery: 'cloud-degradation' }),
      ),
    );
  });

  it('batches simultaneous provider degradations in stable provider order', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    const degraded = status([
      item({
        id: 'azure-degraded',
        provider: 'azure',
        severity: 'warning',
        title: 'Storage latency',
      }),
      item({ id: 'aws-degraded', severity: 'warning', title: 'Elevated API latency' }),
    ]);
    collectionState.data = [snapshot(degraded)];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(nextPoll(degraded))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'AWS Degraded: Elevated API latency (+1 more)',
        'warning',
        expect.objectContaining({ delivery: 'cloud-degradation' }),
      ),
    );
    const options = showToast.mock.calls[0]?.[2];
    options?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('aws');
  });

  it('does not replay a cached outage when the same realtime snapshot arrives', async () => {
    const cached = status([item()]);
    secureStorageMock.setItemSync('cached_cloud_status', { fetchedAt: Date.now(), data: cached });
    collectionState.data = [snapshot(cached)];

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData).toEqual(cached));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not restore stale outage ids from cache', async () => {
    const stale = item({ id: 'incident-1', pubDate: '2026-07-10T17:00:00.000Z' });
    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now(),
      data: status([stale]),
    });
    collectionState.data = [snapshot(status([item({ id: 'incident-1' })]))];

    renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('does not toast when a stale error arrives after the baseline', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([item({ pubDate: '2026-07-10T17:00:00.000Z' })]))];
    rerender();

    await act(async () => Promise.resolve());
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
