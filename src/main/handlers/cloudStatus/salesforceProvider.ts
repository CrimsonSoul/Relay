/* global RequestInit */
import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import type { SalesforceIncident } from './types';

export const SALESFORCE_ACTIVE_URL = 'https://api.status.salesforce.com/v1/incidents/active';

export function salesforceTypeToSeverity(type: string, status: string): CloudStatusSeverity {
  if (status !== 'Active') return 'resolved';
  const t = type.toLowerCase();
  if (t.includes('major') || t.includes('disruption') || t.includes('outage')) return 'error';
  if (t.includes('degradation') || t.includes('maintenance')) return 'warning';
  return 'info';
}

/** Fetch from Salesforce Trust API active incidents. */
export async function fetchSalesforceProvider(): Promise<CloudStatusItem[]> {
  const res = await fetch(SALESFORCE_ACTIVE_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  } as RequestInit);

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${SALESFORCE_ACTIVE_URL}`);

  const incidents = (await res.json()) as SalesforceIncident[];

  return incidents.map((inc) => {
    const services = inc.serviceKeys?.join(', ') ?? '';
    const description = inc.timeline?.[0]?.content ?? inc.IncidentEvents?.[0]?.message ?? '';

    return {
      id: `sf-${inc.id}`,
      provider: 'salesforce' as CloudStatusProvider,
      title: services ? `${inc.type} — ${services}` : inc.type,
      description,
      pubDate:
        inc.timeline?.[0]?.createdAt ??
        inc.IncidentEvents?.[0]?.createdAt ??
        inc.updatedAt ??
        inc.createdAt,
      link: `https://status.salesforce.com/incidents/${inc.id}`,
      severity: salesforceTypeToSeverity(inc.type, inc.status),
    };
  });
}
