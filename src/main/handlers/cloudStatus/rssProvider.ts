import {
  type CloudStatusItem,
  type CloudStatusProvider,
  type CloudStatusSeverity,
} from '@shared/ipc';
import { fetchNoStore } from './fetchNoStore';
import type { RssItem } from './types';

export const RSS_FEEDS: Partial<Record<CloudStatusProvider, string>> = {
  aws: 'https://status.aws.amazon.com/rss/all.rss',
  azure: 'https://azurestatuscdn.azureedge.net/en-us/status/feed/',
  m365: 'https://status.cloud.microsoft/api/feed/mac',
};

const AWS_CURRENT_FEED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
    // Capture group 1 is not optional in the pattern above, so it always participates;
    // an empty default just yields an item with empty fields instead of throwing.
    const block = match[1] ?? '';
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

function invalidFeed(): never {
  throw new Error('Invalid RSS/Atom feed.');
}

function tagEnd(xml: string, start: number): number {
  let quote = '';
  for (let i = start + 1; i < xml.length; i += 1) {
    const character = xml[i];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return i + 1;
    else if (character === '<') invalidFeed();
  }
  return invalidFeed();
}

function feedTokenEnd(xml: string, start: number): number {
  const delimiters = [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
  ] as const;
  for (const [opening, closing] of delimiters) {
    if (!xml.startsWith(opening, start)) continue;
    const end = xml.indexOf(closing, start + opening.length);
    if (end < 0) invalidFeed();
    return end + closing.length;
  }
  return tagEnd(xml, start);
}

type FeedEnvelope = { stack: string[]; root: string; channel: boolean };

function consumeFeedTag(token: string, state: FeedEnvelope): void {
  if (token.startsWith('<!--') || token.startsWith('<?')) return;
  if (token.startsWith('<![CDATA[')) {
    if (!state.stack.length) invalidFeed();
    return;
  }
  const name = /^<\/?([A-Za-z_][\w:.-]*)/.exec(token)?.[1];
  if (!name) invalidFeed();
  if (token.startsWith('</')) {
    if (state.stack.pop() !== name) invalidFeed();
    return;
  }
  if (!state.stack.length) {
    if (state.root || !['rss', 'feed'].includes(name)) invalidFeed();
    state.root = name;
  }
  if (name === 'channel' && state.stack.length === 1) state.channel = true;
  if (!token.endsWith('/>')) state.stack.push(name);
}

/** Require a complete feed envelope before an empty result can mean recovery. */
function validateFeed(xml: string): void {
  const state: FeedEnvelope = { stack: [], root: '', channel: false };
  let offset = 0;
  while (offset < xml.length) {
    const start = xml.indexOf('<', offset);
    const text = xml.slice(offset, start < 0 ? xml.length : start);
    if (!state.stack.length && text.trim()) invalidFeed();
    if (start < 0) break;
    const end = feedTokenEnd(xml, start);
    consumeFeedTag(xml.slice(start, end), state);
    offset = end;
  }
  if (state.stack.length || !state.root || (state.root === 'rss' && !state.channel)) invalidFeed();
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
  now = Date.now(),
): Promise<CloudStatusItem[]> {
  const res = await fetchNoStore(url, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);

  const xml = await res.text();
  validateFeed(xml);
  const rawItems = parseRssItems(xml).filter(
    (item) =>
      !item.description.includes('This site is updated when service issues are preventing') &&
      (provider !== 'aws' || Date.parse(item.pubDate) >= now - AWS_CURRENT_FEED_WINDOW_MS),
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
