import { describe, expect, it } from 'vitest';
import type { CloudStatusItem } from '@shared/ipc';
import {
  CURRENT_CLOUD_OUTAGE_WINDOW_MS,
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
    expect(isCurrentCloudIssue(item({ id: 'outage' }), NOW)).toBe(true);
    expect(
      isCurrentCloudIssue(item({ id: 'degraded', provider: 'azure', severity: 'warning' }), NOW),
    ).toBe(true);
    expect(isCurrentCloudIssue(item({ id: 'info', severity: 'info' }), NOW)).toBe(false);
    expect(isCurrentCloudIssue(item({ id: 'resolved', severity: 'resolved' }), NOW)).toBe(false);
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

  it('keeps future-dated errors as current outages', () => {
    expect(isCurrentCloudOutage(item({ pubDate: new Date(NOW + 60_000).toISOString() }), NOW)).toBe(
      true,
    );
  });
});
