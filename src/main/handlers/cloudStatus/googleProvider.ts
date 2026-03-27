import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import type { GoogleCloudIncident } from './types';

export const GOOGLE_CLOUD_INCIDENTS_URL = 'https://status.cloud.google.com/incidents.json';

export function googleImpactToSeverity(impact: string, ended: boolean): CloudStatusSeverity {
  if (ended) return 'resolved';
  switch (impact) {
    case 'SERVICE_OUTAGE':
      return 'error';
    case 'SERVICE_DISRUPTION':
      return 'warning';
    default:
      return 'info';
  }
}

/** Fetch from Google Cloud status incidents JSON. */
export async function fetchGoogleCloudProvider(): Promise<CloudStatusItem[]> {
  const res = await fetch(GOOGLE_CLOUD_INCIDENTS_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${GOOGLE_CLOUD_INCIDENTS_URL}`);

  const incidents = (await res.json()) as GoogleCloudIncident[];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return incidents
    .filter((inc) => {
      const start = new Date(inc.begin).getTime();
      return !inc.end || start > sevenDaysAgo;
    })
    .map((inc) => ({
      id: inc.id,
      provider: 'google' as CloudStatusProvider,
      title: inc.external_desc,
      description: inc.most_recent_update?.text ?? '',
      pubDate: inc.most_recent_update?.when ?? inc.modified ?? inc.begin,
      link: `https://status.cloud.google.com/${inc.uri.replace(/^\//, '')}`,
      severity: googleImpactToSeverity(inc.status_impact, !!inc.end),
    }));
}
