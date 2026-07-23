import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSnapshotRecord,
} from '@shared/ipc';
import { ErrorCategory } from '@shared/logging';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import { getCurrentCloudIssues, getCurrentCloudOutages } from '../utils/cloudStatus';
import type { ShowToast } from '../components/Toast';
import { useCollection } from './useCollection';

const CACHE_KEY = 'cached_cloud_status';

type CacheEntry = {
  fetchedAt: number;
  data: CloudStatusData;
};

type CollectionCloudStatusSnapshot = CloudStatusSnapshotRecord & RecordModel;

function providerLabel(provider: string): string {
  return CLOUD_STATUS_PROVIDERS[provider as keyof typeof CLOUD_STATUS_PROVIDERS]?.label ?? provider;
}

function outageKey(item: CloudStatusItem): string {
  return `${item.provider}:${item.id}`;
}

function isScheduledMaintenance(item: CloudStatusItem): boolean {
  return /\b(?:planned|scheduled)\b[\s:-]*(?:\w+[\s:-]+){0,4}maintenance\b/i.test(item.title);
}

function notificationSnapshotIdentity(data: CloudStatusData): string {
  return JSON.stringify({
    lastUpdated: data.lastUpdated,
    providers: data.providers,
    errors: data.errors,
  });
}

function orderByProvider(items: CloudStatusItem[]): CloudStatusItem[] {
  const providerOrder = new Map(
    CLOUD_STATUS_PROVIDER_ORDER.map((provider, index) => [provider, index]),
  );
  return [...items].sort(
    (left, right) =>
      (providerOrder.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
      (providerOrder.get(right.provider) ?? Number.MAX_SAFE_INTEGER),
  );
}

type CurrentStatusState = {
  issues: CloudStatusItem[];
  outages: CloudStatusItem[];
  issueProviders: Set<CloudStatusProvider>;
  outageProviders: Set<CloudStatusProvider>;
  feedErrorProviders: Set<CloudStatusProvider>;
  actionableWarnings: Map<CloudStatusProvider, CloudStatusItem>;
};

function currentStatusState(data: CloudStatusData): CurrentStatusState {
  const issues = getCurrentCloudIssues(data);
  const outages = orderByProvider(issues.filter((item) => item.severity === 'error'));
  const actionableWarnings = new Map<CloudStatusProvider, CloudStatusItem>();
  for (const item of issues) {
    if (
      item.severity === 'warning' &&
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
    feedErrorProviders: new Set(data.errors.map((error) => error.provider)),
    actionableWarnings,
  };
}

function advanceProviderDegradation(
  provider: CloudStatusProvider,
  state: CurrentStatusState,
  activeProblemProviders: Set<CloudStatusProvider>,
  candidateCounts: Map<CloudStatusProvider, number>,
): CloudStatusItem | null {
  if (state.feedErrorProviders.has(provider)) {
    candidateCounts.delete(provider);
    return null;
  }
  if (!state.issueProviders.has(provider)) {
    activeProblemProviders.delete(provider);
    candidateCounts.delete(provider);
    return null;
  }
  if (state.outageProviders.has(provider) || activeProblemProviders.has(provider)) {
    candidateCounts.delete(provider);
    return null;
  }

  const warning = state.actionableWarnings.get(provider);
  if (!warning) {
    candidateCounts.delete(provider);
    return null;
  }

  const consecutiveCount = (candidateCounts.get(provider) ?? 0) + 1;
  candidateCounts.set(provider, consecutiveCount);
  if (consecutiveCount < 2) return null;

  activeProblemProviders.add(provider);
  candidateCounts.delete(provider);
  return warning;
}

function collectNewDegradations(
  state: CurrentStatusState,
  activeProblemProviders: Set<CloudStatusProvider>,
  candidateCounts: Map<CloudStatusProvider, number>,
): CloudStatusItem[] {
  const newDegradations: CloudStatusItem[] = [];
  for (const provider of CLOUD_STATUS_PROVIDER_ORDER) {
    const degradation = advanceProviderDegradation(
      provider,
      state,
      activeProblemProviders,
      candidateCounts,
    );
    if (degradation) newDegradations.push(degradation);
  }
  return newDegradations;
}

function retainOutageKeysDuringFeedErrors(
  currentOutageIds: Set<string>,
  previousOutageIds: Set<string>,
  feedErrorProviders: Set<CloudStatusProvider>,
): Set<string> {
  const retainedIds = new Set(currentOutageIds);
  for (const activeId of previousOutageIds) {
    const provider = activeId.slice(0, activeId.indexOf(':')) as CloudStatusProvider;
    if (feedErrorProviders.has(provider)) retainedIds.add(activeId);
  }
  return retainedIds;
}

function toStatusData(record: CloudStatusSnapshotRecord): CloudStatusData {
  return {
    providers: record.providers,
    errors: record.errors,
    lastUpdated: record.lastUpdated,
  };
}

/** Consume the server-owned Cloud Status snapshot and issue local notifications. */
export function useAppCloudStatus(
  showToast: ShowToast,
  onOpenProvider?: (provider: CloudStatusProvider) => void,
) {
  const sharedSnapshot = useCollection<CollectionCloudStatusSnapshot>('cloud_status_snapshot', {
    filter: 'key="current"',
  });
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const activeOutageIdsRef = useRef(new Set<string>());
  const activeProblemProvidersRef = useRef(new Set<CloudStatusProvider>());
  const degradationCandidateCountsRef = useRef(new Map<CloudStatusProvider, number>());
  const baselineEstablishedRef = useRef(false);
  const cacheRestoredRef = useRef(false);
  const lastNotificationSnapshotRef = useRef<string | null>(null);
  const onOpenProviderRef = useRef(onOpenProvider);
  onOpenProviderRef.current = onOpenProvider;

  const processNewEvents = useCallback(
    (data: CloudStatusData) => {
      const snapshotIdentity = notificationSnapshotIdentity(data);
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
        degradationCandidateCountsRef.current.delete(provider);
      }

      const newDegradations = collectNewDegradations(
        current,
        activeProblemProvidersRef.current,
        degradationCandidateCountsRef.current,
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
    (data: CloudStatusData) => {
      processNewEvents(data);
      setStatusData(data);
      secureStorage.setItemSync(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CacheEntry);
    },
    [processNewEvents],
  );

  useEffect(() => {
    const cached = secureStorage.getItemSync<CacheEntry>(CACHE_KEY);
    if (!cached?.data?.providers) return;
    cacheRestoredRef.current = true;
    activeOutageIdsRef.current = new Set(getCurrentCloudOutages(cached.data).map(outageKey));
    activeProblemProvidersRef.current = new Set(
      getCurrentCloudIssues(cached.data).map((item) => item.provider),
    );
    lastNotificationSnapshotRef.current = notificationSnapshotIdentity(cached.data);
    baselineEstablishedRef.current = true;
    setStatusData(cached.data);
  }, []);

  const currentRecord = sharedSnapshot.data[0];
  useEffect(() => {
    if (!currentRecord) return;
    commitStatus(toStatusData(currentRecord));
  }, [commitStatus, currentRecord]);

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
      commitStatus(data);
    } catch (error) {
      loggers.app.error('Cloud status fetch failed', {
        error: getErrorMessage(error),
        category: ErrorCategory.NETWORK,
      });
    } finally {
      setManualLoading(false);
    }
  }, [commitStatus]);

  return {
    statusData,
    loading: manualLoading || (!cacheRestoredRef.current && !statusData && sharedSnapshot.loading),
    refetch,
  };
}
