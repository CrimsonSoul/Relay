import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeAPI,
  CloudStatusData,
  CloudStatusItem,
  CloudStatusSnapshotRecord,
  ExtensionCloudStatusData,
  ExtensionCloudStatusProvider,
  ExtensionCloudStatusSnapshotRecord,
  LegacyCloudStatusData,
  LegacyCloudStatusProvider,
  LegacyCloudStatusSnapshotRecord,
  MistCloudStatusData,
  MistCloudStatusProvider,
  MistCloudStatusSnapshotRecord,
} from '@shared/ipc';
import {
  appendCloudStatusItem,
  emptyCloudStatusProviders,
  emptyExtensionCloudStatusProviders,
  emptyLegacyCloudStatusProviders,
  emptyMistCloudStatusProviders,
  splitCloudStatusData,
} from '@shared/cloudStatus';

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

const { collectionStates, mockUseCollection } = vi.hoisted(() => ({
  collectionStates: {
    cloud_status_snapshot: {
      data: [] as LegacyCloudStatusSnapshotRecord[],
      loading: false,
      error: null as string | null,
      hasLoadedSnapshot: false,
    },
    cloud_status_mist_snapshot: {
      data: [] as MistCloudStatusSnapshotRecord[],
      loading: false,
      error: null as string | null,
      hasLoadedSnapshot: false,
    },
    cloud_status_extension_snapshot: {
      data: [] as ExtensionCloudStatusSnapshotRecord[],
      loading: false,
      error: null as string | null,
      hasLoadedSnapshot: false,
    },
  },
  mockUseCollection: vi.fn(),
}));

vi.mock('../../utils/secureStorage', () => ({ secureStorage: secureStorageMock }));
vi.mock('../../utils/logger', () => ({
  loggers: { app: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } },
}));
vi.mock('../useCollection', () => ({
  useCollection: (name: keyof typeof collectionStates, options: unknown) => {
    mockUseCollection(name, options);
    return { ...collectionStates[name], refetch: vi.fn() };
  },
}));

import { loggers } from '../../utils/logger';
import { useAppCloudStatus } from '../useAppCloudStatus';

const legacyState = collectionStates.cloud_status_snapshot;
const mistState = collectionStates.cloud_status_mist_snapshot;
const extensionState = collectionStates.cloud_status_extension_snapshot;

const collectionState = {
  set data(records: CloudStatusSnapshotRecord[]) {
    if (records.length === 0) {
      legacyState.data = [];
      mistState.data = [];
      extensionState.data = [];
      legacyState.hasLoadedSnapshot = false;
      mistState.hasLoadedSnapshot = false;
      extensionState.hasLoadedSnapshot = false;
      return;
    }
    const record = records[0]!;
    const { legacy, mist, extension } = splitCloudStatusData(record);
    const metadata = {
      id: record.id,
      key: record.key,
      contentHash: record.contentHash,
      created: record.created,
      updated: record.updated,
    };
    legacyState.data = [{ ...metadata, ...legacy }];
    mistState.data = [{ ...metadata, ...mist }];
    extensionState.data = [{ ...metadata, ...extension }];
    legacyState.hasLoadedSnapshot = true;
    mistState.hasLoadedSnapshot = true;
    extensionState.hasLoadedSnapshot = true;
  },
  set loading(value: boolean) {
    legacyState.loading = value;
    mistState.loading = value;
    extensionState.loading = value;
  },
  set error(value: string | null) {
    legacyState.error = value;
    mistState.error = value;
    extensionState.error = value;
  },
};

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
  const providers = emptyCloudStatusProviders();
  for (const current of items) appendCloudStatusItem(providers, current);
  return { providers, errors: [], lastUpdated: Date.now() };
}

function legacyStatus(items: CloudStatusItem[] = []): LegacyCloudStatusData {
  const providers = emptyLegacyCloudStatusProviders();
  for (const current of items) {
    if (current.provider in providers) {
      appendCloudStatusItem(providers, current as CloudStatusItem<LegacyCloudStatusProvider>);
    }
  }
  return { providers, errors: [], lastUpdated: Date.now() };
}

function mistStatus(items: CloudStatusItem[] = []): MistCloudStatusData {
  const providers = emptyMistCloudStatusProviders();
  for (const current of items) {
    if (current.provider in providers) {
      appendCloudStatusItem(providers, current as CloudStatusItem<MistCloudStatusProvider>);
    }
  }
  return { providers, errors: [], lastUpdated: Date.now() };
}

function extensionStatus(items: CloudStatusItem[] = []): ExtensionCloudStatusData {
  const providers = emptyExtensionCloudStatusProviders();
  for (const current of items) {
    if (current.provider in providers) {
      appendCloudStatusItem(providers, current as CloudStatusItem<ExtensionCloudStatusProvider>);
    }
  }
  return { providers, errors: [], lastUpdated: Date.now() };
}

function dropboxItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return item({
    id: 'dropbox-incident-1',
    provider: 'dropbox',
    title: 'Dropbox is not working as expected for some users',
    link: 'https://status.dropbox.com/incidents/example',
    ...overrides,
  });
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

function legacySnapshot(data: LegacyCloudStatusData): LegacyCloudStatusSnapshotRecord {
  return {
    id: 'legacy-snapshot',
    key: 'current',
    contentHash: 'legacy-hash',
    created: '2026-07-10T18:00:00.000Z',
    updated: '2026-07-10T18:00:00.000Z',
    ...data,
  };
}

function mistSnapshot(data: MistCloudStatusData): MistCloudStatusSnapshotRecord {
  return {
    id: 'mist-snapshot',
    key: 'current',
    contentHash: 'mist-hash',
    created: '2026-07-10T18:00:00.000Z',
    updated: '2026-07-10T18:00:00.000Z',
    ...data,
  };
}

function extensionSnapshot(data: ExtensionCloudStatusData): ExtensionCloudStatusSnapshotRecord {
  return {
    id: 'extension-snapshot',
    key: 'current',
    contentHash: 'extension-hash',
    created: '2026-07-10T18:00:00.000Z',
    updated: '2026-07-10T18:00:00.000Z',
    ...data,
  };
}

function mistItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return item({
    id: 'mist-incident-1',
    provider: 'mist_global',
    title: 'Mist login outage',
    link: 'https://status.mist.com/notices/test-incident',
    ...overrides,
  });
}

function dynatraceItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return item({
    id: 'dynatrace-incident-1',
    provider: 'dynatrace',
    title: 'Dynatrace platform outage',
    link: 'https://dynatrace.status.io/pages/incident/incident-1',
    affectedScopes: ['AWS · Americas'],
    ...overrides,
  });
}

function proofpointItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return item({
    id: '000026896',
    provider: 'proofpoint',
    title: 'Proofpoint service interruption',
    link: 'https://proofpoint.my.site.com/community/s/article/example',
    affectedScopes: ['Email Protection'],
    ...overrides,
  });
}

function crowdstrikeItem(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return item({
    id: 'crowdstrike-statusgator-down',
    provider: 'crowdstrike',
    title: 'CrowdStrike outage reported by StatusGator',
    link: 'https://statusgator.com/services/crowdstrike',
    ...overrides,
  });
}

function nextPoll(data: CloudStatusData): CloudStatusData {
  return { ...data, lastUpdated: data.lastUpdated + 60_000 };
}

async function publishStatus(rerender: () => void, data: CloudStatusData): Promise<void> {
  collectionState.data = [snapshot(data)];
  rerender();
  await act(async () => Promise.resolve());
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
    legacyState.hasLoadedSnapshot = false;
    mistState.hasLoadedSnapshot = false;
    extensionState.hasLoadedSnapshot = false;
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
    expect(mockUseCollection).toHaveBeenCalledWith('cloud_status_mist_snapshot', {
      filter: 'key="current"',
    });
    expect(mockUseCollection).toHaveBeenCalledWith('cloud_status_extension_snapshot', {
      filter: 'key="current"',
    });
  });

  it('waits for every snapshot partition before establishing the baseline', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    extensionState.data = [extensionSnapshot(extensionStatus())];
    extensionState.hasLoadedSnapshot = true;
    mistState.loading = true;

    const { result, rerender } = renderHook(() => useAppCloudStatus(showToast));

    expect(result.current.statusData).toBeNull();
    mistState.loading = false;
    mistState.hasLoadedSnapshot = true;
    mistState.data = [mistSnapshot(mistStatus([mistItem()]))];
    rerender();

    await waitFor(() => expect(result.current.statusData?.providers.mist_global).toHaveLength(1));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('marks Mist unknown without alerts when an older server lacks the collection', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    extensionState.data = [extensionSnapshot(extensionStatus())];
    extensionState.hasLoadedSnapshot = true;
    mistState.loading = false;
    mistState.error = 'Missing collection';
    mistState.hasLoadedSnapshot = false;

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData?.errors).toHaveLength(4));
    expect(result.current.statusData?.providers.mist_global).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('marks extension providers unknown without alerts when an older server lacks the extension', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    mistState.data = [mistSnapshot(mistStatus())];
    mistState.hasLoadedSnapshot = true;
    extensionState.loading = false;
    extensionState.error = 'Missing collection';
    extensionState.hasLoadedSnapshot = false;

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() =>
      expect(result.current.statusData?.errors).toContainEqual({
        provider: 'dynatrace',
        message: 'Dynatrace status is unavailable from this Relay server.',
      }),
    );
    expect(result.current.statusData?.providers.dynatrace).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'proofpoint',
      message: 'Proofpoint status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.proofpoint).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'crowdstrike',
      message: 'CrowdStrike status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.crowdstrike).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'dropbox',
      message: 'Dropbox status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.dropbox).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'equinix',
      message: 'Equinix status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.equinix).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('marks newer extension providers unknown when an older snapshot contains only Dynatrace', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    mistState.data = [mistSnapshot(mistStatus())];
    mistState.hasLoadedSnapshot = true;
    extensionState.data = [
      extensionSnapshot({
        providers: { dynatrace: [] },
        errors: [],
        lastUpdated: Date.now(),
      } as unknown as ExtensionCloudStatusData),
    ];
    extensionState.hasLoadedSnapshot = true;

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() =>
      expect(result.current.statusData?.errors).toContainEqual({
        provider: 'proofpoint',
        message: 'Proofpoint status is unavailable from this Relay server.',
      }),
    );
    expect(result.current.statusData?.providers.dynatrace).toEqual([]);
    expect(result.current.statusData?.providers.proofpoint).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'crowdstrike',
      message: 'CrowdStrike status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.crowdstrike).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'dropbox',
      message: 'Dropbox status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.dropbox).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'equinix',
      message: 'Equinix status is unavailable from this Relay server.',
    });
    expect(result.current.statusData?.providers.equinix).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not let manual refresh label Mist healthy when the server lacks Mist storage', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    extensionState.data = [extensionSnapshot(extensionStatus())];
    extensionState.hasLoadedSnapshot = true;
    mistState.error = 'Missing collection';
    getCloudStatus.mockResolvedValue(status([mistItem({ severity: 'info' })]));
    const { result } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    await act(async () => {
      const refresh = result.current.refetch();
      await vi.advanceTimersByTimeAsync(500);
      await refresh;
    });

    expect(result.current.statusData?.providers.mist_global).toEqual([]);
    expect(result.current.statusData?.errors.map(({ provider }) => provider)).toEqual([
      'mist_global',
      'mist_emea',
      'mist_apac',
      'mist_federal',
    ]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('does not let manual refresh label Dynatrace healthy when the server lacks extensions', async () => {
    legacyState.data = [legacySnapshot(legacyStatus())];
    legacyState.hasLoadedSnapshot = true;
    mistState.data = [mistSnapshot(mistStatus())];
    mistState.hasLoadedSnapshot = true;
    extensionState.error = 'Missing collection';
    getCloudStatus.mockResolvedValue(status([dynatraceItem({ severity: 'info' })]));
    const { result } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    await act(async () => {
      const refresh = result.current.refetch();
      await vi.advanceTimersByTimeAsync(500);
      await refresh;
    });

    expect(result.current.statusData?.providers.dynatrace).toEqual([]);
    expect(result.current.statusData?.errors).toContainEqual({
      provider: 'dynatrace',
      message: 'Dynatrace status is unavailable from this Relay server.',
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('batches one multi-region Mist incident into one display-level toast', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([mistItem(), mistItem({ provider: 'mist_apac' })]))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Juniper Mist Outage: Mist login outage',
        'error',
        expect.objectContaining({ delivery: 'cloud-outage' }),
      ),
    );
    expect(showToast).toHaveBeenCalledOnce();
    showToast.mock.calls[0]?.[2]?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('mist');
  });

  it('routes a new Dynatrace public outage through the cloud notification queue', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([dynatraceItem()]))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Dynatrace Outage: Dynatrace platform outage',
        'error',
        expect.objectContaining({ delivery: 'cloud-outage' }),
      ),
    );
    showToast.mock.calls[0]?.[2]?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('dynatrace');
  });

  it('routes a new Proofpoint enterprise outage through the cloud notification queue', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([proofpointItem()]))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Proofpoint Outage: Proofpoint service interruption',
        'error',
        expect.objectContaining({ delivery: 'cloud-outage' }),
      ),
    );
    showToast.mock.calls[0]?.[2]?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('proofpoint');
  });

  it('routes a new third-party CrowdStrike outage through the cloud notification queue', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());

    collectionState.data = [snapshot(status([crowdstrikeItem()]))];
    rerender();

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'CrowdStrike Outage: CrowdStrike outage reported by StatusGator',
        'error',
        expect.objectContaining({ delivery: 'cloud-outage' }),
      ),
    );
    showToast.mock.calls[0]?.[2]?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('crowdstrike');
  });

  it('shows a CrowdStrike warning without ever creating a degradation toast', async () => {
    collectionState.data = [snapshot(status())];
    const { result, rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = crowdstrikeItem({
      id: 'crowdstrike-statusgator-warning',
      severity: 'warning',
      title: 'Possible CrowdStrike disruption reported by StatusGator',
    });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 190_000 });

    expect(result.current.statusData?.providers.crowdstrike).toEqual([warning]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('normalizes a pre-partition cache to unavailable Mist and extension providers', async () => {
    const oldProviders = emptyLegacyCloudStatusProviders();
    secureStorageMock.setItemSync('cached_cloud_status', {
      fetchedAt: Date.now(),
      data: { providers: oldProviders, errors: [], lastUpdated: Date.now() },
    });

    const { result } = renderHook(() => useAppCloudStatus(showToast));

    await waitFor(() => expect(result.current.statusData?.errors).toHaveLength(9));
    expect(result.current.statusData?.providers.mist_federal).toEqual([]);
    expect(result.current.statusData?.providers.dynatrace).toEqual([]);
    expect(result.current.statusData?.providers.proofpoint).toEqual([]);
    expect(result.current.statusData?.providers.crowdstrike).toEqual([]);
    expect(result.current.statusData?.providers.dropbox).toEqual([]);
    expect(result.current.statusData?.providers.equinix).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('retains a Mist outage identity while that regional feed reports an error', async () => {
    collectionState.data = [snapshot(status())];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const outage = status([mistItem()]);
    collectionState.data = [snapshot(outage)];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    showToast.mockClear();

    collectionState.data = [
      snapshot({
        ...status(),
        errors: [{ provider: 'mist_global', message: 'Mist feed unavailable' }],
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());
    collectionState.data = [snapshot(nextPoll(outage))];
    rerender();
    await act(async () => Promise.resolve());

    expect(showToast).not.toHaveBeenCalled();
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

  it('requires three distinct observations spanning two minutes before notifying for degradation', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast, openProvider));
    await act(async () => Promise.resolve());
    const warning = item({
      id: 'degraded-1',
      severity: 'warning',
      title: 'Elevated API latency',
    });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 60_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 120_000 });
    expect(showToast).not.toHaveBeenCalled();

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 179_999 });
    expect(showToast).not.toHaveBeenCalled();

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 180_000 });
    expect(showToast).toHaveBeenCalledWith(
      'AWS Degraded: Elevated API latency',
      'warning',
      expect.objectContaining({
        title: 'Cloud degradation',
        delivery: 'cloud-degradation',
        action: expect.objectContaining({ label: 'View provider' }),
      }),
    );
    const options = showToast.mock.calls[0]?.[2];
    options?.action?.onClick();
    expect(openProvider).toHaveBeenCalledWith('aws');
  });

  it('qualifies on the third observation when the first-to-third span is at least two minutes', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('uses extension snapshot timestamps when qualifying a Dropbox degradation', async () => {
    const baselineTimestamp = Date.now();
    legacyState.data = [legacySnapshot({ ...legacyStatus(), lastUpdated: baselineTimestamp })];
    mistState.data = [mistSnapshot({ ...mistStatus(), lastUpdated: baselineTimestamp })];
    extensionState.data = [
      extensionSnapshot({ ...extensionStatus(), lastUpdated: baselineTimestamp }),
    ];
    legacyState.hasLoadedSnapshot = true;
    mistState.hasLoadedSnapshot = true;
    extensionState.hasLoadedSnapshot = true;
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = dropboxItem({ severity: 'warning', title: 'Dropbox sync delays' });

    for (const offset of [60_000, 120_000, 180_000]) {
      extensionState.data = [
        extensionSnapshot({
          ...extensionStatus([warning]),
          lastUpdated: baselineTimestamp + offset,
        }),
      ];
      rerender();
      await act(async () => Promise.resolve());
    }

    expect(showToast).toHaveBeenCalledWith(
      'Dropbox Degraded: Dropbox sync delays',
      'warning',
      expect.objectContaining({ delivery: 'cloud-degradation' }),
    );
  });

  it('does not let duplicate or older reconnect snapshots advance degradation', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 9_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 131_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('counts split collection events from one server poll as one degradation observation', async () => {
    const baselineTimestamp = Date.now();
    legacyState.data = [legacySnapshot({ ...legacyStatus(), lastUpdated: baselineTimestamp })];
    mistState.data = [mistSnapshot({ ...mistStatus(), lastUpdated: baselineTimestamp })];
    extensionState.data = [
      extensionSnapshot({ ...extensionStatus(), lastUpdated: baselineTimestamp }),
    ];
    legacyState.hasLoadedSnapshot = true;
    mistState.hasLoadedSnapshot = true;
    extensionState.hasLoadedSnapshot = true;
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());

    const firstPollTimestamp = baselineTimestamp + 60_000;
    mistState.data = [
      mistSnapshot({
        ...mistStatus([mistItem({ severity: 'warning', title: 'Elevated Mist latency' })]),
        lastUpdated: firstPollTimestamp,
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    legacyState.data = [
      legacySnapshot({
        ...legacyStatus([item({ severity: 'info' })]),
        lastUpdated: firstPollTimestamp,
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    mistState.data = [
      mistSnapshot({
        ...mistStatus([mistItem({ severity: 'warning', title: 'Elevated Mist latency' })]),
        lastUpdated: firstPollTimestamp + 60_000,
      }),
    ];
    rerender();
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    mistState.data = [
      mistSnapshot({
        ...mistStatus([mistItem({ severity: 'warning', title: 'Elevated Mist latency' })]),
        lastUpdated: firstPollTimestamp + 120_000,
      }),
    ];
    rerender();

    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
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
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();

    collectionState.data = [snapshot(nextPoll(nextPoll(degraded)))];
    rerender();
    await waitFor(() => expect(showToast).toHaveBeenCalledOnce());
  });

  it('restarts count and duration after a pending degradation recovers', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
    await publishStatus(rerender, { ...status(), lastUpdated: 80_000 });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 190_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 249_999 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 250_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('restarts a pending degradation timing window after a provider feed error', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
    await publishStatus(rerender, {
      ...status([warning]),
      errors: [{ provider: 'aws', message: 'Feed unavailable' }],
      lastUpdated: 80_000,
    });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 190_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 249_999 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 250_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('restarts a pending degradation after the actionable warning disappears', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });
    const scheduled = item({ severity: 'warning', title: 'Scheduled database maintenance' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 70_000 });
    await publishStatus(rerender, { ...status([scheduled]), lastUpdated: 80_000 });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 130_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 190_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 249_999 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 250_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('notifies an outage immediately and requires a fresh degradation episode after recovery', async () => {
    collectionState.data = [snapshot({ ...status(), lastUpdated: 1_000 })];
    const { rerender } = renderHook(() => useAppCloudStatus(showToast));
    await act(async () => Promise.resolve());
    const warning = item({ severity: 'warning', title: 'Elevated API latency' });
    const outage = item({ severity: 'error', title: 'API unavailable' });

    await publishStatus(rerender, { ...status([warning]), lastUpdated: 10_000 });
    await publishStatus(rerender, { ...status([outage]), lastUpdated: 20_000 });
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Outage:'),
      'error',
      expect.objectContaining({ delivery: 'cloud-outage' }),
    );

    await publishStatus(rerender, { ...status(), lastUpdated: 30_000 });
    showToast.mockClear();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 40_000 });
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 100_000 });
    expect(showToast).not.toHaveBeenCalled();
    await publishStatus(rerender, { ...status([warning]), lastUpdated: 160_000 });

    expect(showToast).toHaveBeenCalledTimes(1);
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
    const secondObservation = nextPoll(degraded);
    collectionState.data = [snapshot(secondObservation)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(secondObservation);
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
    const secondObservation = nextPoll(degraded);
    collectionState.data = [snapshot(secondObservation)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(secondObservation);
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
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();
    collectionState.data = [snapshot(nextPoll(nextPoll(reopenedDegradation)))];
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
    const secondObservation = nextPoll(degraded);
    collectionState.data = [snapshot(secondObservation)];
    rerender();
    await act(async () => Promise.resolve());
    const confirmedDegradation = nextPoll(secondObservation);
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
    collectionState.data = [snapshot(nextPoll(nextPoll(returnedDegradation)))];
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
    collectionState.data = [snapshot(nextPoll(nextPoll(maintenance)))];
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
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();
    collectionState.data = [snapshot(nextPoll(nextPoll(emergency)))];
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
    await act(async () => Promise.resolve());
    expect(showToast).not.toHaveBeenCalled();
    collectionState.data = [snapshot(nextPoll(nextPoll(degraded)))];
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
