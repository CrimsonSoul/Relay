import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { secureStorageMock, resetStorage } = vi.hoisted(() => {
  const store = new Map<string, unknown>();

  return {
    resetStorage: () => store.clear(),
    secureStorageMock: {
      getItemSync: vi.fn((key: string) => store.get(key)),
      setItemSync: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
    },
  };
});

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../utils/secureStorage', () => ({
  secureStorage: secureStorageMock,
}));

vi.mock('../../utils/logger', () => ({
  loggers: { app: loggerMock },
}));

vi.mock('./useMounted', () => ({
  useMounted: () => ({ current: true }),
}));

vi.mock('@shared/ipc', () => ({
  CLOUD_STATUS_PROVIDERS: {
    aws: { label: 'AWS', statusUrl: '' },
    azure: { label: 'Azure', statusUrl: '' },
    m365: { label: 'Microsoft 365', statusUrl: '' },
    github: { label: 'GitHub', statusUrl: '' },
    cloudflare: { label: 'Cloudflare', statusUrl: '' },
    google: { label: 'Google Cloud', statusUrl: '' },
    anthropic: { label: 'Anthropic', statusUrl: '' },
    openai: { label: 'OpenAI', statusUrl: '' },
    salesforce: { label: 'Salesforce', statusUrl: '' },
  },
}));

vi.mock('@shared/logging', () => ({
  ErrorCategory: { NETWORK: 'NETWORK' },
}));

vi.mock('@shared/types', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyProviders = (): CloudStatusData['providers'] =>
  ({
    aws: [],
    azure: [],
    m365: [],
    github: [],
    cloudflare: [],
    google: [],
    anthropic: [],
    openai: [],
    salesforce: [],
  }) as unknown as CloudStatusData['providers'];

function makeStatusData(items: CloudStatusItem[] = []): CloudStatusData {
  const providers = emptyProviders();
  for (const item of items) {
    (providers as Record<string, CloudStatusItem[]>)[item.provider]?.push(item);
  }
  return { providers, lastUpdated: Date.now(), errors: [] };
}

function makeItem(overrides: Partial<CloudStatusItem> & { id: string }): CloudStatusItem {
  return {
    provider: 'aws',
    title: 'Test incident',
    description: 'desc',
    pubDate: new Date().toISOString(),
    link: 'https://example.com',
    severity: 'error',
    ...overrides,
  } as CloudStatusItem;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAppCloudStatus', () => {
  const showToast = vi.fn();

  const mockApi = {
    getCloudStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    resetStorage();
    (globalThis as Window & { api: typeof mockApi }).api =
      mockApi as unknown as typeof globalThis.api;
    // Default: API resolves with empty data
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // We import inside each call so mocks are already in place
  async function importHook() {
    const mod = await import('../useAppCloudStatus');
    return mod.useAppCloudStatus;
  }

  // ------- initial state -------

  it('returns null statusData initially before fetch completes', async () => {
    // Make the API hang so the fetch never resolves during this check
    mockApi.getCloudStatus.mockReturnValue(new Promise(() => {}));

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    expect(result.current.statusData).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  // ------- fetch on mount -------

  it('fetches cloud status on mount', async () => {
    const data = makeStatusData();
    mockApi.getCloudStatus.mockResolvedValue(data);

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    // Advance past the 500ms spinner delay in the non-silent fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(result.current.statusData).toEqual(data);
    });
    expect(mockApi.getCloudStatus).toHaveBeenCalledTimes(1);
  });

  // ------- caches fetched data -------

  it('caches fetched data in secureStorage', async () => {
    const data = makeStatusData();
    mockApi.getCloudStatus.mockResolvedValue(data);

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(secureStorageMock.setItemSync).toHaveBeenCalledWith(
      'cached_cloud_status',
      expect.objectContaining({ data, fetchedAt: expect.any(Number) }),
    );
  });

  // ------- restores from cache -------

  it('restores statusData from cache on mount', async () => {
    const items = [makeItem({ id: 'cached-1', severity: 'info' })];
    const cachedData = makeStatusData(items);

    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now(),
      data: cachedData,
    });

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    // Cached data should be available synchronously after first render
    await waitFor(() => {
      expect(result.current.statusData).toEqual(cachedData);
    });
  });

  it('does not restore stale cache beyond TTL', async () => {
    const cachedData = makeStatusData([makeItem({ id: 'old-1' })]);

    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago, beyond 10-min TTL
      data: cachedData,
    });

    // API returns fresh empty data
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData());

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    // Before fetch resolves, statusData should still be null (stale cache ignored)
    expect(result.current.statusData).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(result.current.statusData).not.toBeNull();
      // Fresh data from the API, not the stale cache
      expect(Object.values(result.current.statusData!.providers).flat()).toHaveLength(0);
    });
  });

  // ------- toast for new error/warning events -------

  it('shows toast for new error severity events', async () => {
    const items = [
      makeItem({ id: 'err-1', severity: 'error', title: 'S3 outage', provider: 'aws' }),
    ];
    const data = makeStatusData(items);
    mockApi.getCloudStatus.mockResolvedValue(data);

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(showToast).toHaveBeenCalledWith('AWS Outage: S3 outage', 'error');
  });

  it('shows toast for new warning severity events', async () => {
    const items = [
      makeItem({ id: 'warn-1', severity: 'warning', title: 'Degraded API', provider: 'github' }),
    ];
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData(items));

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(showToast).toHaveBeenCalledWith('GitHub Degraded: Degraded API', 'error');
  });

  it('shows toast with count suffix when multiple new events arrive', async () => {
    const items = [
      makeItem({ id: 'e1', severity: 'error', title: 'Outage A', provider: 'aws' }),
      makeItem({ id: 'e2', severity: 'warning', title: 'Slow B', provider: 'azure' }),
    ];
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData(items));

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Error severity item is shown first, with +1 more suffix
    expect(showToast).toHaveBeenCalledWith('AWS Outage: Outage A (+1 more)', 'error');
  });

  // ------- does NOT toast for info/resolved -------

  it('does NOT toast for info severity events', async () => {
    const items = [makeItem({ id: 'info-1', severity: 'info', title: 'Maintenance window' })];
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData(items));

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it('does NOT toast for resolved severity events', async () => {
    const items = [makeItem({ id: 'res-1', severity: 'resolved', title: 'Issue resolved' })];
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData(items));

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  // ------- does NOT re-toast seen events -------

  it('does NOT re-toast events that were already seen', async () => {
    const items = [makeItem({ id: 'dup-1', severity: 'error', title: 'Outage' })];
    const data = makeStatusData(items);
    mockApi.getCloudStatus.mockResolvedValue(data);

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    // First fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    showToast.mockClear();

    // Second fetch via polling (same data)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it('does NOT toast cached events on first fresh fetch', async () => {
    // Pre-seed cache with an error event
    const cachedItems = [makeItem({ id: 'cached-err', severity: 'error', title: 'Cached outage' })];
    const cachedData = makeStatusData(cachedItems);
    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now(),
      data: cachedData,
    });

    // API returns the same event
    mockApi.getCloudStatus.mockResolvedValue(cachedData);

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // Seen IDs were seeded from cache, so no toast
    expect(showToast).not.toHaveBeenCalled();
  });

  // ------- API errors -------

  it('handles API errors gracefully without crashing', async () => {
    mockApi.getCloudStatus.mockRejectedValue(new Error('Network error'));

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.statusData).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Cloud status fetch failed',
      expect.objectContaining({ error: 'Network error', category: 'NETWORK' }),
    );
  });

  it('handles missing API bridge without crashing', async () => {
    (globalThis as Window & { api?: unknown }).api = undefined;

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.statusData).toBeNull();
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Cloud status fetch failed',
      expect.objectContaining({ error: 'API bridge not available' }),
    );
  });

  // ------- polling -------

  it('polls for cloud status every 60 seconds', async () => {
    mockApi.getCloudStatus.mockResolvedValue(makeStatusData());

    const useAppCloudStatus = await importHook();
    renderHook(() => useAppCloudStatus(showToast));

    // Initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mockApi.getCloudStatus).toHaveBeenCalledTimes(1);

    // First polling tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockApi.getCloudStatus).toHaveBeenCalledTimes(2);

    // Second polling tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockApi.getCloudStatus).toHaveBeenCalledTimes(3);
  });

  // ------- refetch -------

  it('refetch() triggers a new fetch', async () => {
    const data1 = makeStatusData();
    const data2 = makeStatusData([makeItem({ id: 'new-1', severity: 'info', title: 'New info' })]);

    mockApi.getCloudStatus.mockResolvedValueOnce(data1).mockResolvedValueOnce(data2);

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    // Wait for initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(result.current.statusData).toEqual(data1);
    });

    // Call refetch
    await act(async () => {
      const refetchPromise = result.current.refetch();
      await vi.advanceTimersByTimeAsync(600);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(result.current.statusData).toEqual(data2);
    });
    expect(mockApi.getCloudStatus).toHaveBeenCalledTimes(2);
  });

  it('refetch() sets loading to true while fetching', async () => {
    let resolveApi: (v: CloudStatusData) => void;
    mockApi.getCloudStatus.mockImplementation(
      () =>
        new Promise<CloudStatusData>((resolve) => {
          resolveApi = resolve;
        }),
    );

    const useAppCloudStatus = await importHook();
    const { result } = renderHook(() => useAppCloudStatus(showToast));

    // Initial non-silent fetch should set loading
    expect(result.current.loading).toBe(true);

    // Resolve initial fetch
    await act(async () => {
      resolveApi!(makeStatusData());
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Now call refetch (non-silent) and verify loading goes to true
    let refetchPromise: Promise<void>;
    act(() => {
      refetchPromise = result.current.refetch();
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveApi!(makeStatusData());
      await vi.advanceTimersByTimeAsync(600);
      await refetchPromise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
