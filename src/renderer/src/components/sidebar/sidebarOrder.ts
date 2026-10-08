import { useSyncExternalStore } from 'react';
import type { TabName } from '@shared/ipc';

/**
 * Sidebar destinations in their default order. The person's own order is remembered on this
 * device, and Cmd/Ctrl+1–8 (Alt+Shift+1–8 in Relay Web) follow it.
 */
export const SIDEBAR_TABS = [
  'Compose',
  'Alerts',
  'Personnel',
  'Knowledge',
  'Status',
  'Problems',
  'Radar',
  'Tickets',
] as const satisfies readonly TabName[];
export type SidebarTab = (typeof SIDEBAR_TABS)[number];

const SIDEBAR_ORDER_STORAGE_KEY = 'relay:sidebar-order';
const listeners = new Set<() => void>();
let cache: { raw: string | null; order: readonly SidebarTab[] } = {
  raw: null,
  order: SIDEBAR_TABS,
};
// Device storage refused the write; the order still applies until Relay restarts.
let unsaved: readonly SidebarTab[] | undefined;

/** Known destinations once each, in the saved order; any left out keep their default place at the end. */
export function cleanSidebarOrder(value: unknown): SidebarTab[] {
  const known = new Set<string>(SIDEBAR_TABS);
  const kept = new Set<SidebarTab>();
  for (const tab of Array.isArray(value) ? value : []) {
    if (typeof tab === 'string' && known.has(tab)) kept.add(tab as SidebarTab);
  }
  return [...kept, ...SIDEBAR_TABS.filter((tab) => !kept.has(tab))];
}

export function getSidebarOrder(): readonly SidebarTab[] {
  if (unsaved) return unsaved;
  let raw: string | null;
  try {
    raw = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
  } catch {
    return SIDEBAR_TABS;
  }
  if (raw !== cache.raw) {
    let saved: unknown = null;
    try {
      saved = JSON.parse(raw ?? 'null');
    } catch {
      // An unreadable saved order falls back to the default.
    }
    cache = { raw, order: cleanSidebarOrder(saved) };
  }
  return cache.order;
}

export function saveSidebarOrder(order: readonly SidebarTab[]): void {
  const clean = cleanSidebarOrder(order);
  try {
    if (clean.every((tab, index) => tab === SIDEBAR_TABS[index]))
      localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    else localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(clean));
    unsaved = undefined;
  } catch {
    unsaved = clean;
  }
  for (const listener of listeners) listener();
}

/** `tab` moved by `offset` places, within the list. */
export function moveSidebarTab(
  order: readonly SidebarTab[],
  tab: SidebarTab,
  offset: number,
): SidebarTab[] {
  const from = order.indexOf(tab);
  const to = Math.min(Math.max(from + offset, 0), order.length - 1);
  const next = order.filter((item) => item !== tab);
  next.splice(to, 0, tab);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another Relay Web tab on this browser saved a new order.
  const storage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_ORDER_STORAGE_KEY || event.key === null) listener();
  };
  globalThis.addEventListener('storage', storage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener('storage', storage);
  };
}

export function useSidebarOrder(): readonly SidebarTab[] {
  return useSyncExternalStore(subscribe, getSidebarOrder);
}
