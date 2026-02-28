/* global RequestInit */
import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import { loggers } from '../logger';
import { ErrorCategory } from '@shared/logging';
import { checkNetworkRateLimit } from '../rateLimiter';
import { getErrorMessage } from '@shared/types';

const AWS_RSS_URL = 'https://status.aws.amazon.com/rss/all.rss';
const AZURE_RSS_URL = 'https://azurestatuscdn.azureedge.net/en-us/status/feed/';
const M365_RSS_URL = 'https://status.cloud.microsoft/api/feed/mac';

const CACHE_TTL_MS = 60_000; // 1-minute server-side cache
let cache: { data: CloudStatusData; fetchedAt: number } | null = null;

/** Extract text content from an XML tag, handling CDATA sections. */
function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    's',
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

type RssItem = {
  title: string;
  description: string;
  pubDate: string;
  link: string;
  guid: string;
  status: string;
};

/** Parse RSS XML into an array of raw items. */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'description'),
      pubDate: extractTag(block, 'pubDate'),
      link: extractTag(block, 'link'),
      guid: extractTag(block, 'guid') || extractTag(block, 'link'),
      status: extractTag(block, 'status'),
    });
  }
  return items;
}

/** Infer severity from RSS item text content and optional status tag. */
function inferSeverity(title: string, description: string, status?: string): CloudStatusSeverity {
  // M365 feed uses an explicit <status> tag
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
async function fetchAndParseRss(
  url: string,
  provider: CloudStatusProvider,
): Promise<CloudStatusItem[]> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  } as RequestInit);

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const xml = await res.text();
  const rawItems = parseRssItems(xml);

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

/** Return cached data or an empty response. */
function cachedOrEmpty(): CloudStatusData {
  if (cache) return cache.data;
  return { aws: [], azure: [], m365: [], lastUpdated: 0, errors: [] };
}

export function setupCloudStatusHandlers() {
  ipcMain.handle(IPC_CHANNELS.GET_CLOUD_STATUS, async () => {
    loggers.cloudStatus.info('Handler called'); // DEBUG
    if (!checkNetworkRateLimit()) return cachedOrEmpty();

    // Return cached if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.data;
    }

    try {
      const [awsResult, azureResult, m365Result] = await Promise.allSettled([
        fetchAndParseRss(AWS_RSS_URL, 'aws'),
        fetchAndParseRss(AZURE_RSS_URL, 'azure'),
        fetchAndParseRss(M365_RSS_URL, 'm365'),
      ]);

      const errors: CloudStatusData['errors'] = [];

      if (awsResult.status === 'rejected') {
        errors.push({ provider: 'aws', message: getErrorMessage(awsResult.reason) });
        loggers.cloudStatus.warn('AWS status feed failed', {
          error: getErrorMessage(awsResult.reason),
          category: ErrorCategory.NETWORK,
        });
      }
      if (azureResult.status === 'rejected') {
        errors.push({ provider: 'azure', message: getErrorMessage(azureResult.reason) });
        loggers.cloudStatus.warn('Azure status feed failed', {
          error: getErrorMessage(azureResult.reason),
          category: ErrorCategory.NETWORK,
        });
      }
      if (m365Result.status === 'rejected') {
        errors.push({ provider: 'm365', message: getErrorMessage(m365Result.reason) });
        loggers.cloudStatus.warn('M365 status feed failed', {
          error: getErrorMessage(m365Result.reason),
          category: ErrorCategory.NETWORK,
        });
      }

      // ── START DUMMY DATA (remove after testing) ──
      const now = Date.now();
      const dummyAws: CloudStatusItem[] = [
        {
          id: 'demo-aws-1',
          provider: 'aws',
          title: 'EC2 — Elevated API Error Rates',
          description:
            'We are investigating increased API error rates and instance launch failures in the US-EAST-1 Region. Provisioning new instances may experience delays. We have identified the root cause and are working to resolve the issue.',
          pubDate: new Date(now - 2 * 3600_000).toISOString(),
          link: 'https://status.aws.amazon.com',
          severity: 'error',
        },
        {
          id: 'demo-aws-2',
          provider: 'aws',
          title: 'S3 — Intermittent Request Timeouts',
          description:
            'Some customers may experience intermittent timeouts when making S3 API requests in EU-WEST-1. GET and PUT operations are affected. We are actively investigating.',
          pubDate: new Date(now - 5 * 3600_000).toISOString(),
          link: 'https://status.aws.amazon.com',
          severity: 'warning',
        },
        {
          id: 'demo-aws-3',
          provider: 'aws',
          title: 'CloudFront — Increased Origin Latency (Resolved)',
          description:
            'The issue with increased origin fetch latency for CloudFront distributions has been fully resolved. All edge locations are operating normally.',
          pubDate: new Date(now - 12 * 3600_000).toISOString(),
          link: 'https://status.aws.amazon.com',
          severity: 'resolved',
        },
      ];
      const dummyAzure: CloudStatusItem[] = [
        {
          id: 'demo-azure-1',
          provider: 'azure',
          title: 'Azure DevOps — Degraded Pipeline Performance',
          description:
            'Customers using Azure Pipelines in South Central US may experience longer queue times and slower build execution. Our engineering team has identified the issue and a mitigation is in progress.',
          pubDate: new Date(now - 1 * 3600_000).toISOString(),
          link: 'https://status.azure.com',
          severity: 'warning',
        },
        {
          id: 'demo-azure-2',
          provider: 'azure',
          title: 'Azure SQL Database — Connectivity Issues (Resolved)',
          description:
            'The connectivity issues affecting Azure SQL Database in West Europe have been mitigated. Customers should no longer experience intermittent connection drops. We are monitoring the service for stability.',
          pubDate: new Date(now - 8 * 3600_000).toISOString(),
          link: 'https://status.azure.com',
          severity: 'resolved',
        },
      ];
      const dummyM365: CloudStatusItem[] = [
        {
          id: 'demo-m365-1',
          provider: 'm365',
          title: 'Microsoft Teams — Message Delivery Delays',
          description:
            'Some users may experience delays in sending and receiving chat messages in Microsoft Teams. Meeting functionality is not affected. We are working on a fix and expect resolution within the next two hours.',
          pubDate: new Date(now - 30 * 60_000).toISOString(),
          link: 'https://status.cloud.microsoft',
          severity: 'warning',
        },
        {
          id: 'demo-m365-2',
          provider: 'm365',
          title: 'Exchange Online — Service Restored',
          description:
            'The issue preventing some users from accessing Exchange Online mailboxes via Outlook has been resolved. All services are operating normally.',
          pubDate: new Date(now - 18 * 3600_000).toISOString(),
          link: 'https://status.cloud.microsoft',
          severity: 'resolved',
        },
        {
          id: 'demo-m365-3',
          provider: 'm365',
          title: 'SharePoint Online — Scheduled Maintenance Complete',
          description:
            'Planned maintenance for SharePoint Online storage infrastructure has been completed successfully. No user impact was reported during the maintenance window.',
          pubDate: new Date(now - 24 * 3600_000).toISOString(),
          link: 'https://status.cloud.microsoft',
          severity: 'info',
        },
      ];
      // ── END DUMMY DATA ──

      const data: CloudStatusData = {
        aws: [
          ...(awsResult.status === 'fulfilled' ? awsResult.value : (cache?.data.aws ?? [])),
          ...dummyAws,
        ],
        azure: [
          ...(azureResult.status === 'fulfilled' ? azureResult.value : (cache?.data.azure ?? [])),
          ...dummyAzure,
        ],
        m365: [
          ...(m365Result.status === 'fulfilled' ? m365Result.value : (cache?.data.m365 ?? [])),
          ...dummyM365,
        ],
        lastUpdated: Date.now(),
        errors,
      };

      loggers.cloudStatus.info(
        `Returning ${data.aws.length} AWS, ${data.azure.length} Azure, ${data.m365.length} M365 items, ${data.errors.length} errors`,
      ); // DEBUG
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
