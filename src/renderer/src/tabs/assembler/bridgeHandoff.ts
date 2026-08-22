import type { BridgeGroup } from '@shared/ipc';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

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
