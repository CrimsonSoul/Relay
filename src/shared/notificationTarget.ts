import type { NotificationTarget } from './notifications';

/** Sandboxed preload cannot require external validation libraries. Keep this guard dependency-free. */
export function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (target.source === 'Tickets')
    return (
      Object.keys(target).length === 2 &&
      typeof target.ticketId === 'string' &&
      /^\d{1,30}$/.test(target.ticketId)
    );
  return (
    Object.keys(target).length === 1 &&
    typeof target.source === 'string' &&
    ['Problems', 'Radar', 'Status'].includes(target.source)
  );
}
