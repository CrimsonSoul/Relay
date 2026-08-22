export const OFFLINE_WRITABLE_COLLECTIONS = [
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'alert_reminders',
  'notes',
  'oncall_dismissals',
  'oncall_board_settings',
  'dynatrace_problem_states',
  'dynatrace_problem_notes',
] as const;

export type OfflineWritableCollection = (typeof OFFLINE_WRITABLE_COLLECTIONS)[number];

const OFFLINE_WRITABLE_COLLECTION_SET = new Set<string>(OFFLINE_WRITABLE_COLLECTIONS);

export function isOfflineWritableCollection(value: unknown): value is OfflineWritableCollection {
  return typeof value === 'string' && OFFLINE_WRITABLE_COLLECTION_SET.has(value);
}
