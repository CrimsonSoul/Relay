import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import type { StatuspageIncident } from './types';

export const STATUSPAGE_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
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
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const json = (await res.json()) as {
    page?: { updated_at?: string };
    incidents: StatuspageIncident[];
    components?: { name: string; status: string }[];
    status?: { indicator: string; description: string };
  };

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

  if (incidents.length > 0 || !json.status || json.status.indicator === 'none') {
    return incidents;
  }

  const impactedComponents = (json.components ?? [])
    .filter((component) => component.status !== 'operational')
    .map((component) => `${component.name}: ${component.status.replaceAll('_', ' ')}`);

  return [
    {
      id: `${provider}-status-${json.page?.updated_at ?? Date.now()}`,
      provider,
      title: json.status.description,
      description:
        impactedComponents.length > 0 ? impactedComponents.join('\n') : json.status.description,
      pubDate: json.page?.updated_at ?? new Date().toISOString(),
      link: baseUrl,
      severity: statuspageIndicatorToSeverity(json.status.indicator),
    },
  ];
}
