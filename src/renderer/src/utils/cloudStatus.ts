import type { CloudStatusSeverity } from '@shared/ipc';

export const CURRENT_CLOUD_OUTAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type CloudIssueCandidate = { severity: CloudStatusSeverity; pubDate: string };

export function isCurrentCloudIssue(item: CloudIssueCandidate, now: number = Date.now()): boolean {
  if (item.severity !== 'error' && item.severity !== 'warning') return false;
  const publishedAt = new Date(item.pubDate).getTime();
  return Number.isFinite(publishedAt) && now - publishedAt <= CURRENT_CLOUD_OUTAGE_WINDOW_MS;
}

export function isCurrentCloudOutage(item: CloudIssueCandidate, now: number = Date.now()): boolean {
  return item.severity === 'error' && isCurrentCloudIssue(item, now);
}
