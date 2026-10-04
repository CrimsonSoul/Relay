import { describe, expect, it } from 'vitest';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import { deriveCloudStatusSidebarStatus } from '../cloudStatusPosture';

const PUB_DATE = '2026-07-20T15:00:00.000Z';
const NOW = Date.parse(PUB_DATE) + 60_000;

function issue(provider: CloudStatusProvider, severity: CloudStatusItem['severity']) {
  return {
    id: `${provider}-${severity}`,
    provider,
    title: 'Provider incident',
    description: 'Incident details',
    pubDate: PUB_DATE,
    link: '',
    severity,
  } as CloudStatusItem;
}

function statusData(items: CloudStatusItem[], errors: CloudStatusData['errors'] = []) {
  const providers = emptyCloudStatusProviders();
  for (const item of items) (providers[item.provider] as CloudStatusItem[]).push(item);
  return { providers, lastUpdated: NOW, errors } as CloudStatusData;
}

describe('deriveCloudStatusSidebarStatus', () => {
  it('reads as an unknown ring before any status data arrives', () => {
    expect(deriveCloudStatusSidebarStatus(null, NOW)).toEqual({
      tone: 'unknown',
      announcement: 'No status data yet',
    });
  });

  it('is a filled green circle when every provider is operational', () => {
    expect(deriveCloudStatusSidebarStatus(statusData([]), NOW)).toEqual({
      tone: 'green',
      announcement: 'All providers operational',
    });
  });

  it('leads with outages (red square) and counts degraded providers after them', () => {
    const data = statusData([issue('aws', 'error'), issue('azure', 'warning')]);

    expect(deriveCloudStatusSidebarStatus(data, NOW)).toEqual({
      tone: 'red',
      announcement: '1 provider outage · 1 degraded',
    });
  });

  it('uses the yellow diamond when providers are degraded but none is out', () => {
    expect(deriveCloudStatusSidebarStatus(statusData([issue('aws', 'warning')]), NOW)).toEqual({
      tone: 'yellow',
      announcement: '1 provider degraded',
    });
  });

  it('flags incomplete coverage when a provider feed is unavailable', () => {
    const data = statusData([], [{ provider: 'aws', message: 'Feed unavailable' }]);

    expect(deriveCloudStatusSidebarStatus(data, NOW)).toEqual({
      tone: 'unknown',
      announcement: 'Coverage incomplete · 1 provider unknown',
    });
  });
});
