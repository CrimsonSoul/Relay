import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import type { RssItem } from './types';

export const RSS_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
  aws: 'https://status.aws.amazon.com/rss/all.rss',
  azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
  m365: 'https://status.cloud.microsoft/api/feed/mac',
};

/** Extract text content from an XML tag, handling CDATA sections. */
export function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(
    String.raw`<${tag}[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/${tag}>`,
    's',
  );
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

/** Extract href attribute from a self-closing or open tag (Atom-style <link href="..."/>). */
export function extractHref(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]+href=["']([^"']+)["'][^>]*/?>`, 'i');
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

/** Decode common XML/HTML entities in a string. */
export function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

/** Parse RSS/Atom XML into an array of raw items. Handles both <item> (RSS) and <entry> (Atom). */
export function parseRssItems(xml: string): RssItem[] {
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
export function inferSeverity(
  title: string,
  description: string,
  status?: string,
): CloudStatusSeverity {
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
export async function fetchRssProvider(
  url: string,
  provider: CloudStatusProvider,
): Promise<CloudStatusItem[]> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(10000),
  });

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
