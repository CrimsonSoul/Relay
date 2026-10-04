import type { CloudStatusData } from '@shared/ipc';
import { isCurrentCloudIssue } from '../utils/cloudStatus';
import {
  aggregateCloudStatusForDisplay,
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  type DisplayCloudStatusProvider,
} from '../utils/cloudStatusDisplay';

/**
 * Sidebar tones share the pip shape grammar used by Radar: `red` filled square (outage),
 * `yellow` diamond (degraded), `green` filled circle (all operational), and `unknown` hollow
 * ring (no data or incomplete coverage).
 */
type CloudStatusSidebarTone = 'red' | 'yellow' | 'green' | 'unknown';

type CloudStatusSidebarStatus = {
  tone: CloudStatusSidebarTone;
  /** Plain-language summary for the button's accessible name and tooltip. */
  announcement: string;
};

type ProviderPostureCounts = {
  outage: number;
  degraded: number;
  unknown: number;
};

function countProviderPostures(data: CloudStatusData, now: number): ProviderPostureCounts {
  const display = aggregateCloudStatusForDisplay(data);
  const errorProviders = new Set(display.errors.map((error) => error.provider));
  const outageProviders = new Set<DisplayCloudStatusProvider>();
  const degradedProviders = new Set<DisplayCloudStatusProvider>();
  for (const item of Object.values(display.providers).flat()) {
    if (!isCurrentCloudIssue(item, now)) continue;
    if (item.severity === 'error') outageProviders.add(item.provider);
    // Matches the Status tab: an unverifiable feed reads as Unknown, not Degraded.
    else if (!errorProviders.has(item.provider)) degradedProviders.add(item.provider);
  }
  let degraded = 0;
  for (const provider of degradedProviders) if (!outageProviders.has(provider)) degraded += 1;
  let unknown = 0;
  for (const provider of errorProviders) if (!outageProviders.has(provider)) unknown += 1;
  return { outage: outageProviders.size, degraded, unknown };
}

function providerCountLabel(count: number, state: string, leading: boolean): string {
  if (!leading) return `${count} ${state}`;
  return `${count} ${count === 1 ? 'provider' : 'providers'} ${state}`;
}

function issueAnnouncement({ outage, degraded, unknown }: ProviderPostureCounts): string {
  const parts: string[] = [];
  if (outage > 0) parts.push(`${outage} provider ${outage === 1 ? 'outage' : 'outages'}`);
  if (degraded > 0) parts.push(providerCountLabel(degraded, 'degraded', parts.length === 0));
  if (unknown > 0) parts.push(providerCountLabel(unknown, 'unknown', parts.length === 0));
  return parts.join(' · ');
}

/**
 * The sidebar's one-glance read of the Status tab, counted per provider with the same posture
 * rules as the provider list (outage outranks unknown, unknown outranks degraded).
 */
export function deriveCloudStatusSidebarStatus(
  data: CloudStatusData | null,
  now: number = Date.now(),
): CloudStatusSidebarStatus {
  if (!data) return { tone: 'unknown', announcement: 'No status data yet' };
  const counts = countProviderPostures(data, now);
  if (counts.outage > 0) return { tone: 'red', announcement: issueAnnouncement(counts) };
  if (counts.unknown >= DISPLAY_CLOUD_STATUS_PROVIDER_ORDER.length) {
    return { tone: 'unknown', announcement: 'No status data: provider feeds are unavailable' };
  }
  if (counts.degraded > 0) return { tone: 'yellow', announcement: issueAnnouncement(counts) };
  if (counts.unknown > 0) {
    return {
      tone: 'unknown',
      announcement: `Coverage incomplete · ${providerCountLabel(counts.unknown, 'unknown', true)}`,
    };
  }
  return { tone: 'green', announcement: 'All providers operational' };
}
