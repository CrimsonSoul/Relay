/* global RequestInit */
import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  CLOUD_STATUS_PROVIDER_ORDER,
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import { loggers } from '../logger';
import { ErrorCategory } from '@shared/logging';
import { checkNetworkRateLimit } from '../rateLimiter';
import { getErrorMessage } from '@shared/types';

// --- Feed URLs ---

const RSS_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
  aws: 'https://status.aws.amazon.com/rss/all.rss',
  azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
  m365: 'https://status.cloud.microsoft/api/feed/mac',
};

const STATUSPAGE_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
  github: 'https://www.githubstatus.com/api/v2/summary.json',
  cloudflare: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  anthropic: 'https://status.claude.com/api/v2/summary.json',
  openai: 'https://status.openai.com/api/v2/summary.json',
};

const GOOGLE_CLOUD_INCIDENTS_URL = 'https://status.cloud.google.com/incidents.json';
const SALESFORCE_ACTIVE_URL = 'https://api.status.salesforce.com/v1/incidents/active';

// --- Cache ---

const CACHE_TTL_MS = 60_000; // 1-minute server-side cache
let cache: { data: CloudStatusData; fetchedAt: number } | null = null;

// --- RSS helpers (AWS, Azure, M365) ---

/** Extract text content from an XML tag, handling CDATA sections. */
function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    's',
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

/** Extract href attribute from a self-closing or open tag (Atom-style <link href="..."/>). */
function extractHref(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]+href=["']([^"']+)["'][^>]*/?>`, 'i');
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

/** Decode common XML/HTML entities in a string. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

type RssItem = {
  title: string;
  description: string;
  pubDate: string;
  link: string;
  guid: string;
  status: string;
};

/** Parse RSS/Atom XML into an array of raw items. Handles both <item> (RSS) and <entry> (Atom). */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // Match both RSS <item> and Atom <entry> blocks
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const link = decodeXmlEntities(extractTag(block, 'link') || extractHref(block, 'link'));
    items.push({
      title: extractTag(block, 'title'),
      description:
        extractTag(block, 'description') ||
        extractTag(block, 'summary') ||
        extractTag(block, 'content'),
      pubDate:
        extractTag(block, 'pubDate') ||
        extractTag(block, 'updated') ||
        extractTag(block, 'published'),
      link,
      guid: extractTag(block, 'guid') || extractTag(block, 'id') || link,
      status: extractTag(block, 'status'),
    });
  }
  return items;
}

/** Infer severity from RSS item text content and optional status tag. */
function inferSeverity(title: string, description: string, status?: string): CloudStatusSeverity {
  if (status) {
    const s = status.toLowerCase();
    if (s === 'available') return 'info';
    if (s === 'degraded' || s === 'advisory') return 'warning';
    if (s === 'unavailable' || s === 'outage') return 'error';
    if (s === 'resolved' || s === 'restored') return 'resolved';
  }
  const text = `${title} ${description}`.toLowerCase();
  if (/resolved|recovered|restored|operating normally/.test(text)) return 'resolved';
  if (/outage|major|critical|unavailable|down\b/.test(text)) return 'error';
  if (/degraded|elevated|intermittent|disruption|impact|issue/.test(text)) return 'warning';
  return 'info';
}

/** Fetch and parse a single RSS feed into CloudStatusItems. */
async function fetchRssProvider(
  url: string,
  provider: CloudStatusProvider,
): Promise<CloudStatusItem[]> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  } as RequestInit);

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const xml = await res.text();
  const rawItems = parseRssItems(xml).filter(
    (item) => !item.description.includes('This site is updated when service issues are preventing'),
  );

  return rawItems.map((item) => ({
    id: item.guid || `${provider}-${item.pubDate}-${item.title.slice(0, 40)}`,
    provider,
    title: item.title,
    description: item.description,
    pubDate: item.pubDate,
    link: item.link,
    severity: inferSeverity(item.title, item.description, item.status),
  }));
}

// --- Atlassian Statuspage helpers (GitHub, Cloudflare, Anthropic, OpenAI) ---

type StatuspageIncident = {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink: string;
  created_at: string;
  updated_at: string;
  incident_updates: { body: string; created_at: string }[];
};

function statuspageImpactToSeverity(impact: string, status: string): CloudStatusSeverity {
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

/** Fetch from an Atlassian Statuspage summary endpoint. */
async function fetchStatuspageProvider(
  url: string,
  provider: CloudStatusProvider,
): Promise<CloudStatusItem[]> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  } as RequestInit);

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const json = (await res.json()) as {
    incidents: StatuspageIncident[];
  };

  // Derive base URL for fallback incident links (strip /api/v2/summary.json)
  const baseUrl = url.replace(/\/api\/v2\/summary\.json$/, '');

  return (json.incidents ?? []).map((inc) => ({
    id: inc.id,
    provider,
    title: inc.name,
    description: inc.incident_updates?.[0]?.body ?? '',
    pubDate: inc.incident_updates?.[0]?.created_at ?? inc.updated_at ?? inc.created_at,
    link: inc.shortlink || `${baseUrl}/incidents/${inc.id}`,
    severity: statuspageImpactToSeverity(inc.impact, inc.status),
  }));
}

// --- Google Cloud helpers ---

type GoogleCloudIncident = {
  id: string;
  external_desc: string;
  begin: string;
  end?: string;
  modified: string;
  status_impact: string;
  uri: string;
  most_recent_update?: { text: string; when: string };
};

function googleImpactToSeverity(impact: string, ended: boolean): CloudStatusSeverity {
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
async function fetchGoogleCloudProvider(): Promise<CloudStatusItem[]> {
  const res = await fetch(GOOGLE_CLOUD_INCIDENTS_URL, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  } as RequestInit);

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

// --- Salesforce Trust API helpers ---

type SalesforceIncident = {
  id: number;
  status: string;
  type: string;
  createdAt: string;
  updatedAt?: string;
  serviceKeys: string[];
  IncidentEvents?: { message: string; createdAt: string }[];
  timeline?: { content: string; createdAt?: string }[];
};

function salesforceTypeToSeverity(type: string, status: string): CloudStatusSeverity {
  if (status !== 'Active') return 'resolved';
  const t = type.toLowerCase();
  if (t.includes('major') || t.includes('disruption') || t.includes('outage')) return 'error';
  if (t.includes('degradation') || t.includes('maintenance')) return 'warning';
  return 'info';
}

/** Fetch from Salesforce Trust API active incidents. */
async function fetchSalesforceProvider(): Promise<CloudStatusItem[]> {
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

// --- Provider fetch dispatcher ---

function fetchProvider(provider: CloudStatusProvider): Promise<CloudStatusItem[]> {
  const rssUrl = RSS_FEEDS[provider];
  if (rssUrl) return fetchRssProvider(rssUrl, provider);

  const statuspageUrl = STATUSPAGE_FEEDS[provider];
  if (statuspageUrl) return fetchStatuspageProvider(statuspageUrl, provider);

  if (provider === 'google') return fetchGoogleCloudProvider();
  if (provider === 'salesforce') return fetchSalesforceProvider();

  return Promise.resolve([]);
}

// --- Empty response helper ---

function emptyProviders(): CloudStatusData['providers'] {
  const providers = {} as CloudStatusData['providers'];
  for (const p of CLOUD_STATUS_PROVIDER_ORDER) {
    providers[p] = [];
  }
  return providers;
}

/** Return cached data or an empty response. */
function cachedOrEmpty(): CloudStatusData {
  if (cache) return cache.data;
  return { providers: emptyProviders(), lastUpdated: 0, errors: [] };
}

// --- IPC handler ---

export function setupCloudStatusHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_CLOUD_STATUS, async () => {
    if (!checkNetworkRateLimit()) return cachedOrEmpty();

    // Return cached if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.data;
    }

    try {
      const results = await Promise.allSettled(
        CLOUD_STATUS_PROVIDER_ORDER.map((p) => fetchProvider(p)),
      );

      const errors: CloudStatusData['errors'] = [];
      const providers = { ...(cache?.data.providers ?? emptyProviders()) };

      for (let i = 0; i < CLOUD_STATUS_PROVIDER_ORDER.length; i++) {
        const provider = CLOUD_STATUS_PROVIDER_ORDER[i]!;
        const result = results[i]!;

        if (result.status === 'fulfilled') {
          providers[provider] = result.value;
        } else {
          errors.push({ provider, message: getErrorMessage(result.reason) });
          loggers.cloudStatus.warn(`${CLOUD_STATUS_PROVIDERS[provider].label} status feed failed`, {
            error: getErrorMessage(result.reason),
            category: ErrorCategory.NETWORK,
          });
        }
      }

      const data: CloudStatusData = { providers, lastUpdated: Date.now(), errors };
      cache = { data, fetchedAt: Date.now() };
      return data;
    } catch (err) {
      loggers.cloudStatus.error('Failed to fetch cloud status', {
        error: getErrorMessage(err),
        category: ErrorCategory.NETWORK,
      });
      return cachedOrEmpty();
    }
  });
}
