import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCrowdStrikeProvider, parseCrowdStrikeStatusGatorPage } from './crowdstrikeProvider';

const STATUSGATOR_URL = 'https://statusgator.com/services/crowdstrike';
const NOW = Date.parse('2026-08-14T17:30:00.000Z');

function servicePage(status: string, summary: string): string {
  return `
    <!doctype html>
    <html>
      <body>
        <p>CrowdStrike is down is a possible search phrase, not the current state.</p>
        <section>
          <h2>Is CrowdStrike down?</h2>
          <h3>${status}</h3>
          <p>${summary}</p>
        </section>
      </body>
    </html>
  `;
}

describe('CrowdStrike StatusGator provider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps the anchored current Down state to a clearly attributed outage', () => {
    expect(
      parseCrowdStrikeStatusGatorPage(
        servicePage(
          'CrowdStrike is down',
          'StatusGator reports that CrowdStrike is currently experiencing an outage.',
        ),
        NOW,
      ),
    ).toEqual([
      {
        id: 'crowdstrike-statusgator-down',
        provider: 'crowdstrike',
        title: 'CrowdStrike outage reported by StatusGator',
        description: 'StatusGator reports that CrowdStrike is currently experiencing an outage.',
        pubDate: '2026-08-14T17:30:00.000Z',
        link: STATUSGATOR_URL,
        severity: 'error',
      },
    ]);
  });

  it('treats the anchored current Up state as authoritative third-party clear', () => {
    expect(
      parseCrowdStrikeStatusGatorPage(
        servicePage(
          'CrowdStrike is up',
          'StatusGator reports that CrowdStrike is currently operational.',
        ),
        NOW,
      ),
    ).toEqual([]);
  });

  it('maps a StatusGator warning to degradation without claiming official confirmation', () => {
    expect(
      parseCrowdStrikeStatusGatorPage(
        servicePage(
          'CrowdStrike is experiencing issues',
          'StatusGator has detected possible problems affecting CrowdStrike users.',
        ),
        NOW,
      ),
    ).toEqual([
      expect.objectContaining({
        id: 'crowdstrike-statusgator-warning',
        title: 'Possible CrowdStrike disruption reported by StatusGator',
        severity: 'warning',
      }),
    ]);
  });

  it('does not turn third-party maintenance into an active issue', () => {
    expect(
      parseCrowdStrikeStatusGatorPage(
        servicePage(
          'CrowdStrike is under maintenance',
          'StatusGator reports scheduled maintenance for CrowdStrike.',
        ),
        NOW,
      ),
    ).toEqual([]);
  });

  it('fetches the public StatusGator page without forwarding credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          servicePage(
            'CrowdStrike is up',
            'StatusGator reports that CrowdStrike is currently operational.',
          ),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCrowdStrikeProvider(NOW)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      STATUSGATOR_URL,
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/html' },
      }),
    );
  });

  it('rejects an advertised response larger than one MiB', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('small body', {
          status: 200,
          headers: { 'Content-Length': String(1024 * 1024 + 1) },
        }),
      ),
    );

    await expect(fetchCrowdStrikeProvider(NOW)).rejects.toThrow(
      'CrowdStrike StatusGator response exceeds 1048576 bytes',
    );
  });

  it('rejects a streamed response that grows larger than one MiB', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1), { status: 200 })),
    );

    await expect(fetchCrowdStrikeProvider(NOW)).rejects.toThrow(
      'CrowdStrike StatusGator response exceeds 1048576 bytes',
    );
  });
});
