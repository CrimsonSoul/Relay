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

      const data: CloudStatusData = {
        aws: awsResult.status === 'fulfilled' ? awsResult.value : (cache?.data.aws ?? []),
        azure: azureResult.status === 'fulfilled' ? azureResult.value : (cache?.data.azure ?? []),
        m365: m365Result.status === 'fulfilled' ? m365Result.value : (cache?.data.m365 ?? []),
        lastUpdated: Date.now(),
        errors,
      };

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
