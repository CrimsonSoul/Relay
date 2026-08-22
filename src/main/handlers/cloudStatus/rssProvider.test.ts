import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRssProvider } from './rssProvider';

const NOW = Date.parse('2026-08-14T18:00:00.000Z');
const AWS_FEED_URL = 'https://status.aws.amazon.com/rss/all.rss';

function rssItem(guid: string, title: string, publishedAt: string): string {
  return `
    <item>
      <guid>${guid}</guid>
      <title>${title}</title>
      <description>Service impact details.</description>
      <pubDate>${publishedAt}</pubDate>
      <link>https://health.aws.amazon.com/health/status</link>
    </item>
  `;
}

describe('RSS cloud status providers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('drops stale AWS history before it reaches shared storage or polling cadence', async () => {
    const xml = `
      <rss><channel>
        ${rssItem('current', 'Service disruption: current impact', 'Thu, 13 Aug 2026 18:00:00 GMT')}
        ${rssItem('stale', 'Service disruption: old impact', 'Wed, 05 Aug 2026 17:59:59 GMT')}
      </channel></rss>
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));

    const result = await fetchRssProvider(AWS_FEED_URL, 'aws', NOW);

    expect(result).toEqual([
      expect.objectContaining({ id: 'current', provider: 'aws', severity: 'warning' }),
    ]);
  });
});
