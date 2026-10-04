import type { BridgeGroup } from '@shared/ipc';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export type PastedRecipientList = {
  /** Valid addresses in paste order, without case-insensitive repeats. */
  emails: string[];
  /** Entries that are not an email address, as pasted. */
  invalid: string[];
};

/**
 * Reads a pasted list of recipients separated by newlines, commas or semicolons, accepting the
 * `Name <address>` form mail clients copy. Returns null for a single entry so an ordinary paste
 * stays a search query.
 */
export function parsePastedRecipientList(text: string): PastedRecipientList | null {
  const entries = text
    .split(/[\n\r,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length < 2) return null;
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const address = (/<([^<>]+)>\s*$/.exec(entry)?.[1] ?? entry).trim();
    if (!EMAIL_PATTERN.test(address)) {
      invalid.push(entry);
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(address);
  }
  return { emails, invalid };
}

/** Names what a pasted list skipped, e.g. `Skipped 2 that are not email addresses: ops, x@`. */
export function describeSkippedRecipientEntries(invalid: readonly string[]): string {
  if (invalid.length === 0) return '';
  const shown = invalid.slice(0, 3).join(', ');
  const more = invalid.length > 3 ? ', …' : '';
  const noun = invalid.length === 1 ? 'is not an email address' : 'are not email addresses';
  return `Skipped ${invalid.length} that ${noun}: ${shown}${more}`;
}

/** Compose's Teams action opens the new-meeting form (`/l/meeting/new`), not a chat. */
export const TEAMS_BRIDGE_LABEL = 'New Teams Bridge';
export const TEAMS_BRIDGE_TOOLTIP =
  'Opens a new Teams bridge with these attendees and the subject filled in; nothing is sent until you send it from Teams';

export type BridgeRecipientSource = 'group' | 'manual';

export type BridgeHandoffRecipient = {
  email: string;
  normalizedEmail: string;
  source: BridgeRecipientSource;
  valid: boolean;
};

export type BridgeHandoffSummary = {
  recipients: BridgeHandoffRecipient[];
  invalidRecipients: BridgeHandoffRecipient[];
  duplicateCount: number;
  manualCount: number;
  groupNames: string[];
  isValid: boolean;
};

type BridgeHandoffInput = {
  groups: BridgeGroup[];
  selectedGroupIds: string[];
  manualAdds: string[];
  manualRemoves: string[];
};

export function buildBridgeHandoffSummary({
  groups,
  selectedGroupIds,
  manualAdds,
  manualRemoves,
}: BridgeHandoffInput): BridgeHandoffSummary {
  const selectedGroups = selectedGroupIds
    .map((id) => groups.find((group) => group.id === id))
    .filter((group): group is BridgeGroup => Boolean(group));
  const removed = new Set(manualRemoves.map((email) => email.trim().toLowerCase()));
  const recipients = new Map<string, BridgeHandoffRecipient>();
  let duplicateCount = 0;

  const add = (rawEmail: string, source: BridgeRecipientSource) => {
    const email = rawEmail.trim();
    const normalizedEmail = email.toLowerCase();
    if (!email || removed.has(normalizedEmail)) return;
    const existing = recipients.get(normalizedEmail);
    if (existing) {
      duplicateCount += 1;
      if (source === 'manual') existing.source = 'manual';
      return;
    }
    recipients.set(normalizedEmail, {
      email,
      normalizedEmail,
      source,
      valid: EMAIL_PATTERN.test(email),
    });
  };

  selectedGroups.flatMap((group) => group.contacts).forEach((email) => add(email, 'group'));
  manualAdds.forEach((email) => add(email, 'manual'));

  const normalizedRecipients = [...recipients.values()];
  const invalidRecipients = normalizedRecipients.filter((recipient) => !recipient.valid);
  return {
    recipients: normalizedRecipients,
    invalidRecipients,
    duplicateCount,
    manualCount: normalizedRecipients.filter((recipient) => recipient.source === 'manual').length,
    groupNames: selectedGroups.map((group) => group.name),
    isValid: normalizedRecipients.length > 0 && invalidRecipients.length === 0,
  };
}

/** Why Copy Recipients is unavailable, or null when the bridge can be copied. */
export function getCopyRecipientsBlockedReason(summary: BridgeHandoffSummary): string | null {
  if (summary.recipients.length === 0) return 'Add recipients to copy';
  if (summary.invalidRecipients.length > 0) return 'Fix invalid recipient addresses to copy';
  return null;
}

export function buildBridgeSubject(now = new Date()): string {
  return `${now.getMonth() + 1}/${now.getDate()} -`;
}

export function createBridgeHistoryFingerprint(contacts: string[], groups: string[]): string {
  return JSON.stringify({
    contacts: contacts
      .map((value) => value.trim().toLowerCase())
      .sort((left, right) => left.localeCompare(right)),
    groups: groups
      .map((value) => value.trim().toLowerCase())
      .sort((left, right) => left.localeCompare(right)),
  });
}
