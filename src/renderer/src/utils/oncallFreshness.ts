import type { OnCallRow } from '@shared/ipc';
import type { OnCallRecord } from '../services/oncallService';

export function toOnCallRow(record: OnCallRecord): OnCallRow {
  const updatedAt = Date.parse(record.updated);
  return {
    id: record.id,
    team: record.team,
    teamId: record.teamId,
    role: record.role,
    name: record.name,
    contact: record.contact,
    timeWindow: record.timeWindow,
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    ...(record.queuedAt ? { queuedAt: record.queuedAt } : {}),
  };
}

export function lastEditedLabel(rows: OnCallRow[]): string {
  const times = rows.flatMap((row) =>
    typeof row.updatedAt === 'number' && Number.isFinite(new Date(row.updatedAt).getTime())
      ? [row.updatedAt]
      : [],
  );
  return times.length
    ? new Date(Math.max(...times)).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Unknown';
}
