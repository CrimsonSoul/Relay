import type { Contact, OnCallRow } from '@shared/ipc';

/**
 * On-call role vocabulary shared by the On-Call board and Compose suggestions, so a person
 * reads the same everywhere: the full role word ("Secondary"), with the tier codes PRI (primary),
 * BKP (backup) and MEM (member) only where a narrow board row has no room for the word.
 */
export type OnCallRoleKind = 'primary' | 'backup' | 'member';

/** Human role name, normalised from the free-text role on an on-call row. */
export const getOnCallRoleLabel = (role: string): string => {
  const r = (role || '').trim().toLowerCase();
  if (r.includes('primary')) return 'Primary';
  if (r.includes('secondary')) return 'Secondary';
  if (r.includes('backup/weekend')) return 'Backup/Weekend';
  if (r.includes('backup')) return 'Backup';
  if (r.includes('standby')) return 'Standby';
  if (r.includes('shadow')) return 'Shadow';
  if (r.includes('escalation')) return 'Escalation';
  if (r.includes('network')) return 'Network';
  if (r.includes('telecom')) return 'Telecom';
  if (r.includes('weekend')) return 'Weekend';
  if (!r || r === 'member') return 'Member';
  return role.trim();
};

export const getOnCallRoleKind = (role: string): OnCallRoleKind => {
  const r = (role || '').trim().toLowerCase();
  if (r.includes('primary') || r === 'pri' || r.includes('network') || r.includes('telecom')) {
    return 'primary';
  }
  if (
    r.includes('secondary') ||
    r.includes('backup') ||
    r.includes('standby') ||
    r.includes('escalation') ||
    r.includes('weekend') ||
    r === 'bkp'
  ) {
    return 'backup';
  }
  return 'member';
};

export const ON_CALL_ROLE_CODES: Readonly<Record<OnCallRoleKind, string>> = {
  primary: 'PRI',
  backup: 'BKP',
  member: 'MEM',
};

/** A row that names someone or carries a number; anything else is a placeholder. */
export const isStaffedOnCallRow = (row: Readonly<Pick<OnCallRow, 'name' | 'contact'>>): boolean =>
  !!(row.name.trim() || row.contact.trim());

/**
 * Team names with no staffed row (the board's "No coverage"), in first-seen row order. Teams
 * are keyed by `teamId` (falling back to the name), as the On-Call board groups them.
 */
export const getVacantOnCallTeams = (rows: readonly OnCallRow[]): string[] => {
  const teams = new Map<string, { name: string; staffed: boolean }>();
  for (const row of rows) {
    const key = row.teamId || row.team;
    const entry = teams.get(key) ?? { name: row.team, staffed: false };
    entry.staffed ||= isStaffedOnCallRow(row);
    teams.set(key, entry);
  }
  return [...teams.values()].filter((team) => !team.staffed).map((team) => team.name);
};

export type OnCallBridgeCandidate = Readonly<{
  email: string;
  name: string;
  role: string;
  roleKind: OnCallRoleKind;
  team: string;
}>;

/** Directory contacts keyed by trimmed, lower-cased name; a key with several contacts is ambiguous. */
export type ContactsByName = ReadonlyMap<string, readonly Contact[]>;

export const indexContactsByName = (contacts: readonly Contact[]): ContactsByName => {
  const contactsByName = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const key = contact.name.trim().toLowerCase();
    if (key) contactsByName.set(key, [...(contactsByName.get(key) ?? []), contact]);
  }
  return contactsByName;
};

/**
 * The directory contact an on-call name refers to: only a unique case-insensitive name match
 * counts (as the On-Call editor does), so two "Sam Lee" entries never guess between them.
 */
export const matchDirectoryContact = (
  name: string,
  contactsByName: ContactsByName,
): Contact | undefined => {
  const matches = contactsByName.get(name.trim().toLowerCase());
  return matches?.length === 1 ? matches[0] : undefined;
};

/**
 * On-call people who can join a bridge: each row's name resolves to a directory email only on a
 * unique case-insensitive match (as the On-Call editor does). Duplicates keep their first row.
 */
export const resolveOnCallBridgeCandidates = (
  rows: readonly OnCallRow[],
  contacts: readonly Contact[],
): OnCallBridgeCandidate[] => {
  const contactsByName = indexContactsByName(contacts);
  const seen = new Set<string>();
  const candidates: OnCallBridgeCandidate[] = [];
  for (const row of rows) {
    const email = matchDirectoryContact(row.name, contactsByName)?.email.trim() ?? '';
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    candidates.push({
      email,
      name: row.name.trim(),
      role: getOnCallRoleLabel(row.role),
      roleKind: getOnCallRoleKind(row.role),
      team: row.team,
    });
  }
  return candidates;
};
