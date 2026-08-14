import type { CloudStatusItem } from '@shared/ipc';
import { fetchNoStore } from './fetchNoStore';

const STATUSGATOR_CROWDSTRIKE_URL = 'https://statusgator.com/services/crowdstrike';
const MAX_RESPONSE_BYTES = 1024 * 1024;

type HtmlElement = { end: number; text: string };

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`CrowdStrike StatusGator response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function textContent(value: string): string {
  let cursor = 0;
  let text = '';
  while (cursor < value.length) {
    const start = value.indexOf('<', cursor);
    if (start === -1) return `${text} ${value.slice(cursor)}`.replace(/\s+/gu, ' ').trim();
    text += ` ${value.slice(cursor, start)}`;
    const end = value.indexOf('>', start + 1);
    if (end === -1) break;
    cursor = end + 1;
  }
  return text.replace(/\s+/gu, ' ').trim();
}

function nextElement(html: string, tag: 'h2' | 'h3' | 'p', from: number): HtmlElement | null {
  const lower = html.toLowerCase();
  const start = lower.indexOf(`<${tag}`, from);
  if (start === -1) return null;
  const openingEnd = lower.indexOf('>', start + tag.length + 1);
  const closing = `</${tag}>`;
  const closingStart = openingEnd === -1 ? -1 : lower.indexOf(closing, openingEnd + 1);
  if (openingEnd === -1 || closingStart === -1) return null;
  return {
    end: closingStart + closing.length,
    text: textContent(html.slice(openingEnd + 1, closingStart)),
  };
}

function currentStatus(html: string): { heading: string; summary: string } | null {
  let cursor = 0;
  while (cursor < html.length) {
    const question = nextElement(html, 'h2', cursor);
    if (!question) return null;
    cursor = question.end;
    if (question.text !== 'Is CrowdStrike down?') continue;
    const status = nextElement(html, 'h3', question.end);
    if (!status) return null;
    const summary = nextElement(html, 'p', status.end);
    return { heading: status.text, summary: summary?.text ?? '' };
  }
  return null;
}

export function parseCrowdStrikeStatusGatorPage(
  html: string,
  now: number,
): CloudStatusItem<'crowdstrike'>[] {
  const status = currentStatus(html);
  if (status?.heading === 'CrowdStrike is up') return [];
  if (status?.heading === 'CrowdStrike is under maintenance') return [];
  if (status?.heading === 'CrowdStrike is experiencing issues') {
    return [
      {
        id: 'crowdstrike-statusgator-warning',
        provider: 'crowdstrike',
        title: 'Possible CrowdStrike disruption reported by StatusGator',
        description: status.summary,
        pubDate: new Date(now).toISOString(),
        link: STATUSGATOR_CROWDSTRIKE_URL,
        severity: 'warning',
      },
    ];
  }
  if (!status || status.heading !== 'CrowdStrike is down') {
    throw new Error('Invalid CrowdStrike StatusGator response');
  }
  return [
    {
      id: 'crowdstrike-statusgator-down',
      provider: 'crowdstrike',
      title: 'CrowdStrike outage reported by StatusGator',
      description: status.summary,
      pubDate: new Date(now).toISOString(),
      link: STATUSGATOR_CROWDSTRIKE_URL,
      severity: 'error',
    },
  ];
}

export async function fetchCrowdStrikeProvider(
  now = Date.now(),
): Promise<CloudStatusItem<'crowdstrike'>[]> {
  const response = await fetchNoStore(STATUSGATOR_CROWDSTRIKE_URL, {
    credentials: 'omit',
    headers: { Accept: 'text/html' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from CrowdStrike StatusGator`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`CrowdStrike StatusGator response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return parseCrowdStrikeStatusGatorPage(await readBoundedText(response), now);
}
