import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';

export const CURRENT_CLOUD_OUTAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isCurrentCloudOutage(item: CloudStatusItem, now: number = Date.now()): boolean {
  if (item.severity !== 'error') return false;
  const publishedAt = new Date(item.pubDate).getTime();
  return Number.isFinite(publishedAt) && now - publishedAt <= CURRENT_CLOUD_OUTAGE_WINDOW_MS;
}

export function getCurrentCloudOutages(
  data: CloudStatusData,
  now: number = Date.now(),
): CloudStatusItem[] {
  return Object.values(data.providers)
    .flat()
    .filter((item) => isCurrentCloudOutage(item, now));
}
