import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  EXTENSION_CLOUD_STATUS_PROVIDER_ORDER,
  MIST_CLOUD_STATUS_PROVIDER_ORDER,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusPartition,
  type CloudStatusProvider,
  type ExtensionCloudStatusData,
  type ExtensionCloudStatusSnapshotRecord,
  type LegacyCloudStatusData,
  type LegacyCloudStatusSnapshotRecord,
  type MistCloudStatusData,
  type MistCloudStatusSnapshotRecord,
} from '@shared/ipc';
import {
  emptyCloudStatusProviders,
  mergeCloudStatusData,
  normalizeExtensionCloudStatusData,
  setCloudStatusProviderItems,
  splitCloudStatusData,
  unavailableExtensionCloudStatusData,
  unavailableMistCloudStatusData,
} from '@shared/cloudStatus';
import { ErrorCategory } from '@shared/logging';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import { isCurrentCloudIssue } from '../utils/cloudStatus';
import {
  aggregateCloudStatusForDisplay,
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  DISPLAY_CLOUD_STATUS_PROVIDERS,
  type DisplayCloudStatusItem,
  type DisplayCloudStatusProvider,
} from '../utils/cloudStatusDisplay';
import type { ShowToast } from '../components/Toast';
import { useCollection } from './useCollection';

const CACHE_KEY = 'cached_cloud_status';

const EXTENSION_DISPLAY_PROVIDERS = new Set<DisplayCloudStatusProvider>(
  EXTENSION_CLOUD_STATUS_PROVIDER_ORDER,
);

export const DEGRADATION_REQUIRED_OBSERVATIONS = 3;
export const DEGRADATION_MIN_DURATION_MS = 120_000;

type CacheEntry = {
  fetchedAt: number;
  data: CloudStatusData;
};

type CollectionLegacyCloudStatusSnapshot = LegacyCloudStatusSnapshotRecord & RecordModel;
type CollectionMistCloudStatusSnapshot = MistCloudStatusSnapshotRecord & RecordModel;
type CollectionExtensionCloudStatusSnapshot = ExtensionCloudStatusSnapshotRecord & RecordModel;
type StatusObservationTimestamps = {
  legacy: number;
  mist: number;
  extension: number;
};

function defaultStatusObservationTimestamps(data: CloudStatusData): StatusObservationTimestamps {
  return {
    legacy: data.lastUpdated,
    mist: data.lastUpdated,
    extension: data.lastUpdated,
  };
}

function providerLabel(provider: DisplayCloudStatusProvider): string {
  return DISPLAY_CLOUD_STATUS_PROVIDERS[provider].label;
}

function outageKey(item: DisplayCloudStatusItem): string {
  return `${item.provider}:${item.id}`;
}

function isScheduledMaintenance(item: DisplayCloudStatusItem): boolean {
  return /\b(?:planned|scheduled)\b[\s:-]*(?:\w+[\s:-]+){0,4}maintenance\b/i.test(item.title);
}

function notificationSnapshotIdentity(
  data: CloudStatusData,
  observations: StatusObservationTimestamps = defaultStatusObservationTimestamps(data),
): string {
  return JSON.stringify({
    lastUpdated: data.lastUpdated,
    providers: data.providers,
    errors: data.errors,
    observations,
  });
}

function orderByProvider(items: DisplayCloudStatusItem[]): DisplayCloudStatusItem[] {
  const providerOrder = new Map(
    DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.map((provider, index) => [provider, index]),
  );
  return [...items].sort(
    (left, right) =>
      (providerOrder.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
      (providerOrder.get(right.provider) ?? Number.MAX_SAFE_INTEGER),
  );
}

type CurrentStatusState = {
  issues: DisplayCloudStatusItem[];
  outages: DisplayCloudStatusItem[];
  issueProviders: Set<DisplayCloudStatusProvider>;
  outageProviders: Set<DisplayCloudStatusProvider>;
  feedErrorProviders: Set<DisplayCloudStatusProvider>;
  actionableWarnings: Map<DisplayCloudStatusProvider, DisplayCloudStatusItem>;
};

function observationTimestampFor(
  provider: DisplayCloudStatusProvider,
  observations: StatusObservationTimestamps,
): number {
  if (provider === 'mist') return observations.mist;
  return EXTENSION_DISPLAY_PROVIDERS.has(provider) ? observations.extension : observations.legacy;
}

function currentStatusState(data: CloudStatusData): CurrentStatusState {
  const displayData = aggregateCloudStatusForDisplay(data);
  const issues = Object.values(displayData.providers)
    .flat()
    .filter((item) => isCurrentCloudIssue(item));
  const outages = orderByProvider(issues.filter((item) => item.severity === 'error'));
  const actionableWarnings = new Map<DisplayCloudStatusProvider, DisplayCloudStatusItem>();
  for (const item of issues) {
    if (
      item.severity === 'warning' &&
      item.provider !== 'crowdstrike' &&
      !isScheduledMaintenance(item) &&
      !actionableWarnings.has(item.provider)
    ) {
      actionableWarnings.set(item.provider, item);
    }
  }
  return {
    issues,
    outages,
    issueProviders: new Set(issues.map((item) => item.provider)),
    outageProviders: new Set(outages.map((item) => item.provider)),
    feedErrorProviders: new Set(displayData.errors.map((error) => error.provider)),
    actionableWarnings,
  };
}

function clearDegradationCandidate(
  provider: DisplayCloudStatusProvider,
  candidateCounts: Map<DisplayCloudStatusProvider, number>,
  candidateObservations: Map<DisplayCloudStatusProvider, number>,
  candidateFirstObservations: Map<DisplayCloudStatusProvider, number>,
): void {
  candidateCounts.delete(provider);
  candidateObservations.delete(provider);
  candidateFirstObservations.delete(provider);
}

function advanceProviderDegradation(
  provider: DisplayCloudStatusProvider,
  state: CurrentStatusState,
  activeProblemProviders: Set<DisplayCloudStatusProvider>,
  candidateCounts: Map<DisplayCloudStatusProvider, number>,
  candidateObservations: Map<DisplayCloudStatusProvider, number>,
  candidateFirstObservations: Map<DisplayCloudStatusProvider, number>,
  observationTimestamp: number,
): DisplayCloudStatusItem | null {
  if (state.feedErrorProviders.has(provider)) {
    clearDegradationCandidate(
      provider,
      candidateCounts,
      candidateObservations,
      candidateFirstObservations,
    );
    return null;
  }
  if (!state.issueProviders.has(provider)) {
    activeProblemProviders.delete(provider);
    clearDegradationCandidate(
      provider,
      candidateCounts,
      candidateObservations,
      candidateFirstObservations,
    );
    return null;
  }
  if (state.outageProviders.has(provider) || activeProblemProviders.has(provider)) {
    clearDegradationCandidate(
      provider,
      candidateCounts,
      candidateObservations,
      candidateFirstObservations,
    );
    return null;
  }

  const warning = state.actionableWarnings.get(provider);
  if (!warning) {
    clearDegradationCandidate(
      provider,
      candidateCounts,
      candidateObservations,
      candidateFirstObservations,
    );
    return null;
  }

  const previousObservation = candidateObservations.get(provider);
  if (previousObservation !== undefined && observationTimestamp <= previousObservation) return null;
  candidateObservations.set(provider, observationTimestamp);
  if (!candidateFirstObservations.has(provider)) {
    candidateFirstObservations.set(provider, observationTimestamp);
  }

  const count = (candidateCounts.get(provider) ?? 0) + 1;
  candidateCounts.set(provider, count);
  const firstObservation = candidateFirstObservations.get(provider) ?? observationTimestamp;
  if (
    count < DEGRADATION_REQUIRED_OBSERVATIONS ||
    observationTimestamp - firstObservation < DEGRADATION_MIN_DURATION_MS
  ) {
    return null;
  }

  activeProblemProviders.add(provider);
  clearDegradationCandidate(
    provider,
    candidateCounts,
    candidateObservations,
    candidateFirstObservations,
  );
  return warning;
}

function collectNewDegradations(
  state: CurrentStatusState,
  activeProblemProviders: Set<DisplayCloudStatusProvider>,
  candidateCounts: Map<DisplayCloudStatusProvider, number>,
  candidateObservations: Map<DisplayCloudStatusProvider, number>,
  candidateFirstObservations: Map<DisplayCloudStatusProvider, number>,
  observations: StatusObservationTimestamps,
): DisplayCloudStatusItem[] {
  const newDegradations: DisplayCloudStatusItem[] = [];
  for (const provider of DISPLAY_CLOUD_STATUS_PROVIDER_ORDER) {
    const degradation = advanceProviderDegradation(
      provider,
      state,
      activeProblemProviders,
      candidateCounts,
      candidateObservations,
      candidateFirstObservations,
      observationTimestampFor(provider, observations),
    );
    if (degradation) newDegradations.push(degradation);
  }
  return newDegradations;
}

function retainOutageKeysDuringFeedErrors(
  currentOutageIds: Set<string>,
  previousOutageIds: Set<string>,
  feedErrorProviders: Set<DisplayCloudStatusProvider>,
): Set<string> {
  const retainedIds = new Set(currentOutageIds);
  for (const activeId of previousOutageIds) {
    const provider = activeId.slice(0, activeId.indexOf(':')) as DisplayCloudStatusProvider;
    if (feedErrorProviders.has(provider)) retainedIds.add(activeId);
  }
  return retainedIds;
}

function toStatusPartition<P extends CloudStatusProvider>(
  record: CloudStatusPartition<P>,
): CloudStatusPartition<P> {
  return {
    providers: record.providers,
    errors: Array.isArray(record.errors) ? record.errors : [],
    lastUpdated: record.lastUpdated,
  };
}

function matchingCachedProviderItems<P extends CloudStatusProvider>(
  items: readonly CloudStatusItem[],
  provider: P,
): CloudStatusItem<P>[] {
  return items.filter((item): item is CloudStatusItem<P> => item.provider === provider);
}

function normalizeCachedCloudStatus(data: CloudStatusData): CloudStatusData {
  const source = data.providers;
  const providers = emptyCloudStatusProviders();
  for (const provider of CLOUD_STATUS_PROVIDER_ORDER) {
    setCloudStatusProviderItems(
      providers,
      provider,
      Array.isArray(source[provider])
        ? matchingCachedProviderItems(source[provider], provider)
        : [],
    );
  }
  const normalized: CloudStatusData = {
    providers,
    errors: Array.isArray(data.errors) ? data.errors : [],
    lastUpdated: Number.isFinite(data.lastUpdated) ? data.lastUpdated : 0,
  };
  const hasMistCoverage = MIST_CLOUD_STATUS_PROVIDER_ORDER.every((provider) =>
    Array.isArray(source[provider]),
  );
  const partitions = splitCloudStatusData(normalized);
  const extension = normalizeExtensionCloudStatusData({
    providers: source as ExtensionCloudStatusData['providers'],
    errors: partitions.extension.errors,
    lastUpdated: normalized.lastUpdated,
  });
  return mergeCloudStatusData(
    partitions.legacy,
    hasMistCoverage ? partitions.mist : unavailableMistCloudStatusData(normalized.lastUpdated),
    extension,
  );
}

/** Consume the server-owned Cloud Status snapshot and issue local notifications. */
export function useAppCloudStatus(
  showToast: ShowToast,
  onOpenProvider?: (provider: DisplayCloudStatusProvider) => void,
) {
  const legacySnapshot = useCollection<CollectionLegacyCloudStatusSnapshot>(
    'cloud_status_snapshot',
    { filter: 'key="current"' },
  );
  const mistSnapshot = useCollection<CollectionMistCloudStatusSnapshot>(
    'cloud_status_mist_snapshot',
    { filter: 'key="current"' },
  );
  const extensionSnapshot = useCollection<CollectionExtensionCloudStatusSnapshot>(
    'cloud_status_extension_snapshot',
    { filter: 'key="current"' },
  );
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const activeOutageIdsRef = useRef(new Set<string>());
  const activeProblemProvidersRef = useRef(new Set<DisplayCloudStatusProvider>());
  const degradationCandidateCountsRef = useRef(new Map<DisplayCloudStatusProvider, number>());
  const degradationCandidateObservationsRef = useRef(new Map<DisplayCloudStatusProvider, number>());
  const degradationCandidateFirstObservationsRef = useRef(
    new Map<DisplayCloudStatusProvider, number>(),
  );
  const baselineEstablishedRef = useRef(false);
  const cacheRestoredRef = useRef(false);
  const lastNotificationSnapshotRef = useRef<string | null>(null);
  const onOpenProviderRef = useRef(onOpenProvider);
  onOpenProviderRef.current = onOpenProvider;

  const processNewEvents = useCallback(
    (data: CloudStatusData, observations: StatusObservationTimestamps) => {
      const snapshotIdentity = notificationSnapshotIdentity(data, observations);
      if (lastNotificationSnapshotRef.current === snapshotIdentity) return;
      lastNotificationSnapshotRef.current = snapshotIdentity;

      const current = currentStatusState(data);
      const currentOutageIds = new Set(current.outages.map(outageKey));

      if (!baselineEstablishedRef.current) {
        activeOutageIdsRef.current = currentOutageIds;
        activeProblemProvidersRef.current = current.issueProviders;
        baselineEstablishedRef.current = true;
        return;
      }

      const newItems = current.outages.filter(
        (item) => !activeOutageIdsRef.current.has(outageKey(item)),
      );
      if (newItems.length > 0) {
        const primary = newItems[0]!;
        const suffix = newItems.length > 1 ? ` (+${newItems.length - 1} more)` : '';
        showToast(`${providerLabel(primary.provider)} Outage: ${primary.title}${suffix}`, 'error', {
          title: 'Cloud outage',
          delivery: 'cloud-outage',
          action: {
            label: 'View provider',
            onClick: () => onOpenProviderRef.current?.(primary.provider),
          },
        });
      }

      for (const provider of current.outageProviders) {
        activeProblemProvidersRef.current.add(provider);
        clearDegradationCandidate(
          provider,
          degradationCandidateCountsRef.current,
          degradationCandidateObservationsRef.current,
          degradationCandidateFirstObservationsRef.current,
        );
      }

      const newDegradations = collectNewDegradations(
        current,
        activeProblemProvidersRef.current,
        degradationCandidateCountsRef.current,
        degradationCandidateObservationsRef.current,
        degradationCandidateFirstObservationsRef.current,
        observations,
      );

      if (newDegradations.length > 0) {
        const primary = newDegradations[0]!;
        const suffix = newDegradations.length > 1 ? ` (+${newDegradations.length - 1} more)` : '';
        showToast(
          `${providerLabel(primary.provider)} Degraded: ${primary.title}${suffix}`,
          'warning',
          {
            title: 'Cloud degradation',
            delivery: 'cloud-degradation',
            durationMs: 6_000,
            action: {
              label: 'View provider',
              onClick: () => onOpenProviderRef.current?.(primary.provider),
            },
          },
        );
      }

      activeOutageIdsRef.current = retainOutageKeysDuringFeedErrors(
        currentOutageIds,
        activeOutageIdsRef.current,
        current.feedErrorProviders,
      );
    },
    [showToast],
  );

  const commitStatus = useCallback(
    (
      data: CloudStatusData,
      observations: StatusObservationTimestamps = defaultStatusObservationTimestamps(data),
    ) => {
      processNewEvents(data, observations);
      setStatusData(data);
      secureStorage.setItemSync(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CacheEntry);
    },
    [processNewEvents],
  );

  useEffect(() => {
    const cached = secureStorage.getItemSync<CacheEntry>(CACHE_KEY);
    if (!cached?.data?.providers) return;
    const normalized = normalizeCachedCloudStatus(cached.data);
    const current = currentStatusState(normalized);
    cacheRestoredRef.current = true;
    activeOutageIdsRef.current = new Set(current.outages.map(outageKey));
    activeProblemProvidersRef.current = current.issueProviders;
    lastNotificationSnapshotRef.current = notificationSnapshotIdentity(normalized);
    baselineEstablishedRef.current = true;
    setStatusData(normalized);
  }, []);

  const legacyRecord = legacySnapshot.data[0];
  const mistRecord = mistSnapshot.data[0];
  const extensionRecord = extensionSnapshot.data[0];
  const legacyResolved =
    Boolean(legacyRecord) ||
    (!legacySnapshot.loading &&
      (legacySnapshot.hasLoadedSnapshot || Boolean(legacySnapshot.error)));
  const mistResolved =
    Boolean(mistRecord) ||
    (!mistSnapshot.loading && (mistSnapshot.hasLoadedSnapshot || Boolean(mistSnapshot.error)));
  const mistUnsupported = mistResolved && !mistRecord;
  const extensionResolved =
    Boolean(extensionRecord) ||
    (!extensionSnapshot.loading &&
      (extensionSnapshot.hasLoadedSnapshot || Boolean(extensionSnapshot.error)));
  const extensionUnsupported = extensionResolved && !extensionRecord;

  useEffect(() => {
    if (!legacyRecord || !mistResolved || !extensionResolved) return;
    const mist: MistCloudStatusData = mistRecord
      ? toStatusPartition(mistRecord)
      : unavailableMistCloudStatusData(legacyRecord.lastUpdated);
    const legacy: LegacyCloudStatusData = toStatusPartition(legacyRecord);
    const extension: ExtensionCloudStatusData = extensionRecord
      ? toStatusPartition(extensionRecord)
      : unavailableExtensionCloudStatusData(legacyRecord.lastUpdated);
    commitStatus(mergeCloudStatusData(legacy, mist, extension), {
      legacy: legacy.lastUpdated,
      mist: mist.lastUpdated,
      extension: extension.lastUpdated,
    });
  }, [commitStatus, extensionRecord, extensionResolved, legacyRecord, mistRecord, mistResolved]);

  const refetch = useCallback(async () => {
    setManualLoading(true);
    try {
      const api = globalThis.api;
      if (!api) {
        loggers.app.info('Cloud status manual refresh unavailable: API bridge not available');
        return;
      }
      const [data] = await Promise.all([
        api.getCloudStatus(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      const partitions = splitCloudStatusData(data);
      const extension = normalizeExtensionCloudStatusData({
        providers: data.providers as ExtensionCloudStatusData['providers'],
        errors: partitions.extension.errors,
        lastUpdated: data.lastUpdated,
      });
      const safeData = mergeCloudStatusData(
        partitions.legacy,
        mistUnsupported ? unavailableMistCloudStatusData(data.lastUpdated) : partitions.mist,
        extensionUnsupported ? unavailableExtensionCloudStatusData(data.lastUpdated) : extension,
      );
      commitStatus(safeData);
    } catch (error) {
      loggers.app.error('Cloud status fetch failed', {
        error: getErrorMessage(error),
        category: ErrorCategory.NETWORK,
      });
    } finally {
      setManualLoading(false);
    }
  }, [commitStatus, extensionUnsupported, mistUnsupported]);

  return {
    statusData,
    loading:
      manualLoading ||
      (!cacheRestoredRef.current &&
        !statusData &&
        (!legacyResolved || !mistResolved || !extensionResolved)),
    refetch,
  };
}
