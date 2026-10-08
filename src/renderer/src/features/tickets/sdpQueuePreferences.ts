/**
 * Queue tabs, page size, sort order, row colors and their strength, remembered on this device for
 * each Relay server (as filters are).
 */
import {
  SDP_MAX_QUEUES,
  SDP_PAGE_SIZE,
  SDP_QUEUES,
  SdpPageSizeSchema,
  SdpQueueSchema,
  SdpQueueSortSchema,
  type SdpQueue,
  type SdpQueueSort,
} from '@shared/sdpAccount';
import { getPb } from '../../services/pocketbase';

export type SdpPageSize = 25 | 50 | 100;
const queuesKey = () => `relay:sdp-queues:${getPb().baseURL}`;
const pageSizeKey = () => `relay:sdp-page-size:${getPb().baseURL}`;
const sortKey = () => `relay:sdp-queue-sort:${getPb().baseURL}`;
const rowColorsKey = () => `relay:sdp-status-colors:${getPb().baseURL}`;
const rowStrengthKey = () => `relay:sdp-row-color-strength:${getPb().baseURL}`;
/** The main ticket statuses rows can be colored by; every other status stays uncolored. */
export const SDP_ROW_STATUSES = ['Open', 'In Progress', 'Waiting', 'On Hold', 'Closed'] as const;
export type SdpRowStatus = (typeof SDP_ROW_STATUSES)[number];
/** Any color the operator chooses, as a lowercase #rrggbb hex. */
export type SdpRowColors = Readonly<Partial<Record<SdpRowStatus, string>>>;
const ROW_COLOR = /^#[0-9a-f]{6}$/i;
/** A faint wash (the default), or a strong one for reading status at a glance. */
export type SdpRowStrength = 'subtle' | 'vibrant';

/** Valid, distinct names (SDP compares group names without case), at most SDP_MAX_QUEUES. */
export function cleanSdpQueues(values: readonly unknown[]): SdpQueue[] {
  const seen = new Set<string>();
  const queues: SdpQueue[] = [];
  for (const value of values) {
    const parsed = SdpQueueSchema.safeParse(value);
    if (!parsed.success || seen.has(parsed.data.toUpperCase())) continue;
    seen.add(parsed.data.toUpperCase());
    queues.push(parsed.data);
  }
  return queues.slice(0, SDP_MAX_QUEUES);
}
export function readSdpQueues(): SdpQueue[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(queuesKey()) ?? 'null');
    if (Array.isArray(saved)) {
      const queues = cleanSdpQueues(saved);
      if (queues.length) return queues;
    }
  } catch {
    // Unreadable device storage falls back to the default queues.
  }
  return [...SDP_QUEUES];
}
export function saveSdpQueues(queues: readonly SdpQueue[]): void {
  try {
    localStorage.setItem(queuesKey(), JSON.stringify(cleanSdpQueues(queues)));
  } catch {
    // Device storage is unavailable; the change still applies until Relay restarts.
  }
}
/** Queues outside SDP_QUEUES; only these are sent, so older servers keep working without them. */
export function addedSdpQueues(queues: readonly SdpQueue[]): SdpQueue[] {
  const defaults = new Set(SDP_QUEUES.map((queue) => queue.toUpperCase()));
  return queues.filter((queue) => !defaults.has(queue.toUpperCase()));
}
export function readSdpPageSize(): SdpPageSize {
  try {
    const parsed = SdpPageSizeSchema.safeParse(Number(localStorage.getItem(pageSizeKey())));
    if (parsed.success) return parsed.data;
  } catch {
    // Unreadable device storage keeps the default size.
  }
  return SDP_PAGE_SIZE;
}
export function saveSdpPageSize(size: SdpPageSize): void {
  try {
    if (size === SDP_PAGE_SIZE) localStorage.removeItem(pageSizeKey());
    else localStorage.setItem(pageSizeKey(), String(size));
  } catch {
    // Device storage is unavailable; the size still applies for this session.
  }
}
/** Whether an open ticket fills the Tickets tab: a layout choice for this device, not per server. */
const expandedKey = 'relay:sdp-ticket-expanded';
export function readSdpTicketExpanded(): boolean {
  try {
    return localStorage.getItem(expandedKey) === 'true';
  } catch {
    return false;
  }
}
export function saveSdpTicketExpanded(expanded: boolean): void {
  try {
    if (expanded) localStorage.setItem(expandedKey, 'true');
    else localStorage.removeItem(expandedKey);
  } catch {
    // Device storage is unavailable; the layout still applies for this session.
  }
}
/** Newest first (undefined) unless the person chose a column. */
export function readSdpQueueSort(): SdpQueueSort | undefined {
  try {
    const parsed = SdpQueueSortSchema.safeParse(
      JSON.parse(localStorage.getItem(sortKey()) ?? 'null'),
    );
    // Priority has no column to sort from, so an order saved by it falls back to newest first.
    if (parsed.success && parsed.data.field !== 'priority') return parsed.data;
  } catch {
    // Unreadable device storage keeps newest first.
  }
  return undefined;
}
export function saveSdpQueueSort(sort: SdpQueueSort | undefined): void {
  try {
    if (sort) localStorage.setItem(sortKey(), JSON.stringify(sort));
    else localStorage.removeItem(sortKey());
  } catch {
    // Device storage is unavailable; the order still applies for this session.
  }
}
export function readSdpRowColors(): SdpRowColors {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(rowColorsKey()) ?? 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      return Object.fromEntries(
        Object.entries(saved)
          .filter(
            (entry): entry is [SdpRowStatus, string] =>
              SDP_ROW_STATUSES.includes(entry[0] as SdpRowStatus) &&
              typeof entry[1] === 'string' &&
              ROW_COLOR.test(entry[1]),
          )
          .map(([status, color]) => [status, color.toLowerCase()]),
      );
  } catch {
    // Unreadable device storage leaves rows uncolored.
  }
  return {};
}
export function saveSdpRowColors(colors: SdpRowColors): void {
  try {
    const kept = Object.entries(colors).filter(([, color]) => color && ROW_COLOR.test(color));
    if (kept.length) localStorage.setItem(rowColorsKey(), JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(rowColorsKey());
  } catch {
    // Device storage is unavailable; the colors still apply for this session.
  }
}
export function readSdpRowStrength(): SdpRowStrength {
  try {
    return localStorage.getItem(rowStrengthKey()) === 'vibrant' ? 'vibrant' : 'subtle';
  } catch {
    // Unreadable device storage keeps the subtle wash.
    return 'subtle';
  }
}
export function saveSdpRowStrength(strength: SdpRowStrength): void {
  try {
    if (strength === 'vibrant') localStorage.setItem(rowStrengthKey(), strength);
    else localStorage.removeItem(rowStrengthKey());
  } catch {
    // Device storage is unavailable; the strength still applies for this session.
  }
}
