import { describe, expect, it } from 'vitest';
import type { BridgeGroup } from '@shared/ipc';
import {
  buildBridgeHandoffSummary,
  buildBridgeSubject,
  createBridgeHistoryFingerprint,
  describeSkippedRecipientEntries,
  parsePastedRecipientList,
} from '../bridgeHandoff';

const groups: BridgeGroup[] = [
  {
    id: 'network',
    name: 'Network Operations',
    contacts: ['Alice@Example.com', 'shared@example.com'],
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'service-desk',
    name: 'Service Desk',
    contacts: ['alice@example.com', 'shared@example.com'],
    createdAt: 1,
    updatedAt: 1,
  },
];

describe('buildBridgeHandoffSummary', () => {
  it('deduplicates and removes email identities case-insensitively', () => {
    const summary = buildBridgeHandoffSummary({
      groups,
      selectedGroupIds: ['network', 'service-desk'],
      manualAdds: ['MANUAL@example.com', 'shared@example.com'],
      manualRemoves: ['ALICE@example.com'],
    });

    expect(summary.recipients.map((recipient) => recipient.email)).toEqual([
      'shared@example.com',
      'MANUAL@example.com',
    ]);
    expect(summary.duplicateCount).toBe(2);
    expect(summary.manualCount).toBe(2);
    expect(summary.groupNames).toEqual(['Network Operations', 'Service Desk']);
    expect(summary.isValid).toBe(true);
  });

  it('preserves invalid recipients for correction instead of silently dropping them', () => {
    const summary = buildBridgeHandoffSummary({
      groups: [],
      selectedGroupIds: [],
      manualAdds: ['valid@example.com', 'broken-address'],
      manualRemoves: [],
    });

    expect(summary.invalidRecipients.map((recipient) => recipient.email)).toEqual([
      'broken-address',
    ]);
    expect(summary.isValid).toBe(false);
  });

  it('marks an empty composition invalid', () => {
    const summary = buildBridgeHandoffSummary({
      groups: [],
      selectedGroupIds: [],
      manualAdds: [],
      manualRemoves: [],
    });

    expect(summary.recipients).toEqual([]);
    expect(summary.isValid).toBe(false);
  });

  it('builds a stable fingerprint independent of casing and group order', () => {
    expect(
      createBridgeHistoryFingerprint(
        ['A@example.com', 'b@example.com'],
        ['Service Desk', 'Network Operations'],
      ),
    ).toBe(
      createBridgeHistoryFingerprint(
        ['B@example.com', 'a@example.com'],
        ['Network Operations', 'Service Desk'],
      ),
    );
  });

  it('preserves the existing generated Teams subject format', () => {
    expect(buildBridgeSubject(new Date(2026, 7, 4, 10, 42))).toBe('8/4 -');
  });
});

describe('parsePastedRecipientList', () => {
  it('reads newline, comma and semicolon lists and mail-client "Name <address>" entries', () => {
    expect(
      parsePastedRecipientList('Ada <ada@example.com>;bob@example.com,\r\nADA@example.com\n\nops'),
    ).toEqual({ emails: ['ada@example.com', 'bob@example.com'], invalid: ['ops'] });
  });

  it('leaves a single entry to search', () => {
    expect(parsePastedRecipientList(' ada@example.com \n')).toBeNull();
  });

  it('names skipped entries, at most three', () => {
    expect(describeSkippedRecipientEntries([])).toBe('');
    expect(describeSkippedRecipientEntries(['ops'])).toBe(
      'Skipped 1 that is not an email address: ops',
    );
    expect(describeSkippedRecipientEntries(['a', 'b', 'c', 'd'])).toBe(
      'Skipped 4 that are not email addresses: a, b, c, …',
    );
  });
});
