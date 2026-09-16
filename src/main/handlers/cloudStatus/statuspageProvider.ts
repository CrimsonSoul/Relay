import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import { fetchNoStore } from './fetchNoStore';
import type { StatuspageIncident } from './types';

export const STATUSPAGE_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
  dropbox: 'https://status.dropbox.com/api/v2/summary.json',
  equinix: 'https://equinixproductstatus.statuspage.io/api/v2/summary.json',
  jira: 'https://jira-software.status.atlassian.com/api/v2/summary.json',
  github: 'https://www.githubstatus.com/api/v2/summary.json',
  cloudflare: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  anthropic: 'https://status.claude.com/api/v2/summary.json',
  openai: 'https://status.openai.com/api/v2/summary.json',
};

export function statuspageImpactToSeverity(impact: string, status: string): CloudStatusSeverity {
  if (status === 'resolved' || status === 'postmortem') return 'resolved';
  switch (impact) {
    case 'critical':
    case 'major':
      return 'error';
    case 'minor':
      return 'warning';
    default:
      return 'info';
  }
}

export function statuspageIndicatorToSeverity(indicator: string): CloudStatusSeverity {
  switch (indicator) {
    case 'critical':
    case 'major':
      return 'error';
    case 'minor':
      return 'warning';
    default:
      return 'info';
  }
}

/** Fetch from an Atlassian Statuspage summary endpoint. */
export async function fetchStatuspageProvider(
  url: string,
  provider: CloudStatusProvider,
): Promise<CloudStatusItem[]> {
  const res = await fetchNoStore(url, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const json = (await res.json()) as {
    page?: { updated_at?: string };
    incidents?: StatuspageIncident[];
    components?: { name: string; status: string }[];
    status?: { indicator: string; description: string };
  };

  if (
    !json ||
    // Some compatible summary endpoints omit incidents when there are none.
    // Require the components array in that case so a status-only response does
    // not masquerade as a complete summary.
    (!Array.isArray(json.incidents) &&
      !(json.incidents === undefined && Array.isArray(json.components))) ||
    !json.status ||
    !['none', 'minor', 'major', 'critical', 'maintenance'].includes(json.status.indicator) ||
    typeof json.status.description !== 'string' ||
    !(json.incidents ?? []).every(
      (incident) =>
        incident &&
        ['id', 'name', 'status', 'impact', 'created_at'].every(
          (key) => typeof (incident as unknown as Record<string, unknown>)[key] === 'string',
        ),
    ) ||
    (json.components !== undefined &&
      (!Array.isArray(json.components) ||
        !json.components.every(
          (component) =>
            component && typeof component.name === 'string' && typeof component.status === 'string',
        )))
  )
    throw new Error('Invalid Statuspage summary.');

  // Derive base URL for fallback incident links (strip /api/v2/summary.json)
  const baseUrl = url.replace(/\/api\/v2\/summary\.json$/, '');

  const incidents = (json.incidents ?? []).map((inc) => ({
    id: inc.id,
    provider,
    title: inc.name,
    description: inc.incident_updates?.[0]?.body ?? '',
    pubDate: inc.incident_updates?.[0]?.created_at ?? inc.updated_at ?? inc.created_at,
    link: inc.shortlink || `${baseUrl}/incidents/${inc.id}`,
    severity: statuspageImpactToSeverity(inc.impact, inc.status),
  }));

  if (provider === 'cloudflare' && incidents.length === 0) return [];

  if (incidents.length > 0 || !json.status || json.status.indicator === 'none') {
    return incidents;
  }

  const impactedComponents = (json.components ?? [])
    .filter((component) => component.status !== 'operational')
    .map((component) => `${component.name}: ${component.status.replaceAll('_', ' ')}`);

  return [
    {
      // Aggregate status describes the response observed now, not an incident
      // published when the provider last edited its page metadata. Keep its ID
      // stable across polls so metadata changes cannot replay outage alerts.
      id: `${provider}-status-${json.status.indicator}`,
      provider,
      title: json.status.description,
      description:
        impactedComponents.length > 0 ? impactedComponents.join('\n') : json.status.description,
      pubDate: new Date().toISOString(),
      link: baseUrl,
      severity: statuspageIndicatorToSeverity(json.status.indicator),
    },
  ];
}
