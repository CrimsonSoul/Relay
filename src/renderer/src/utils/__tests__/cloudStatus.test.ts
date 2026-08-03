import { describe, expect, it } from 'vitest';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import {
  CURRENT_CLOUD_OUTAGE_WINDOW_MS,
  getCurrentCloudIssues,
  getCurrentCloudOutages,
  isCurrentCloudIssue,
  isCurrentCloudOutage,
} from '../cloudStatus';

const NOW = Date.parse('2026-07-20T18:00:00.000Z');

function item(overrides: Partial<CloudStatusItem> = {}): CloudStatusItem {
  return {
    id: 'outage-1',
    provider: 'aws',
    title: 'Provider outage',
    description: '',
    pubDate: new Date(NOW).toISOString(),
    link: '',
    severity: 'error',
    ...overrides,
  };
}

function data(items: CloudStatusItem[]): CloudStatusData {
  const providers = emptyCloudStatusProviders();
  for (const current of items) providers[current.provider].push(current);
  return { providers, errors: [], lastUpdated: NOW };
}

describe('current Cloud Status outages', () => {
  it('includes an error published exactly seven days ago', () => {
    expect(
      isCurrentCloudOutage(
        item({ pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS).toISOString() }),
        NOW,
      ),
    ).toBe(true);
  });

  it('excludes stale, invalid, and non-error records', () => {
    expect(
      isCurrentCloudOutage(
        item({ pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS - 1).toISOString() }),
        NOW,
      ),
    ).toBe(false);
    expect(isCurrentCloudOutage(item({ pubDate: 'not-a-date' }), NOW)).toBe(false);
    expect(isCurrentCloudOutage(item({ severity: 'warning' }), NOW)).toBe(false);
  });

  it('includes current warning and error records as active cloud issues', () => {
    const outage = item({ id: 'outage' });
    const degraded = item({ id: 'degraded', provider: 'azure', severity: 'warning' });

    expect(isCurrentCloudIssue(outage, NOW)).toBe(true);
    expect(isCurrentCloudIssue(degraded, NOW)).toBe(true);
    expect(
      getCurrentCloudIssues(
        data([
          outage,
          degraded,
          item({ id: 'info', severity: 'info' }),
          item({ id: 'resolved', severity: 'resolved' }),
        ]),
        NOW,
      ),
    ).toEqual([outage, degraded]);
  });

  it('excludes stale and invalid warning records from active cloud issues', () => {
    expect(
      isCurrentCloudIssue(
        item({
          severity: 'warning',
          pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS - 1).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
    expect(isCurrentCloudIssue(item({ severity: 'warning', pubDate: 'not-a-date' }), NOW)).toBe(
      false,
    );
  });

  it('keeps future-dated errors and selects only current outages', () => {
    const future = item({ id: 'future', pubDate: new Date(NOW + 60_000).toISOString() });
    const stale = item({
      id: 'stale',
      pubDate: new Date(NOW - CURRENT_CLOUD_OUTAGE_WINDOW_MS - 1).toISOString(),
    });

    expect(
      getCurrentCloudOutages(
        data([future, stale, item({ id: 'warning', severity: 'warning' })]),
        NOW,
      ),
    ).toEqual([future]);
  });
});
