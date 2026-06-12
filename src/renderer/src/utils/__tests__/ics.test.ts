import { describe, it, expect } from 'vitest';
import { buildBridgeIcs, type BridgeIcsOptions } from '../ics';

const baseOptions: BridgeIcsOptions = {
  subject: 'Bridge',
  start: new Date(Date.UTC(2026, 5, 12, 14, 30, 0)),
  durationMinutes: 60,
  organizerEmail: 'organizer@test.com',
  attendees: [{ name: 'Alice Adams', email: 'alice@test.com' }, { email: 'bob@test.com' }],
};

/** Unfolds folded lines so content assertions are independent of folding. */
function unfold(ics: string): string[] {
  return ics
    .replaceAll('\r\n ', '')
    .split('\r\n')
    .filter((line) => line.length > 0);
}

describe('buildBridgeIcs', () => {
  it('uses CRLF line endings exclusively', () => {
    const ics = buildBridgeIcs(baseOptions);
    expect(ics).toContain('\r\n');
    expect(ics.replaceAll('\r\n', '')).not.toContain('\n');
    expect(ics.replaceAll('\r\n', '')).not.toContain('\r');
  });

  it('folds lines longer than 75 octets with a single-space continuation', () => {
    const ics = buildBridgeIcs({
      ...baseOptions,
      subject:
        'A very long subject line that definitely exceeds the seventy-five octet limit imposed by RFC 5545',
    });
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toMatch(/\r\n [^\s]/);
    // Unfolding restores the full subject
    expect(unfold(ics).some((l) => l.includes('seventy-five octet limit'))).toBe(true);
  });

  it('escapes TEXT values in SUMMARY (backslash, semicolon, comma, newline)', () => {
    const ics = buildBridgeIcs({
      ...baseOptions,
      subject: 'a\\b;c,d\ne',
    });
    const summary = unfold(ics).find((l) => l.startsWith('SUMMARY:'));
    expect(summary).toBe('SUMMARY:a\\\\b\\;c\\,d\\ne');
  });

  it('wraps the event in a VCALENDAR with VERSION, PRODID and METHOD:REQUEST', () => {
    const lines = unfold(buildBridgeIcs(baseOptions));
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('END:VEVENT');
  });

  it('emits a deterministic UID derived from start time and attendees', () => {
    const first = unfold(buildBridgeIcs(baseOptions)).find((l) => l.startsWith('UID:'));
    const second = unfold(buildBridgeIcs(baseOptions)).find((l) => l.startsWith('UID:'));
    expect(first).toMatch(/^UID:relay-bridge-\d+-[0-9a-f]+@relay$/);
    expect(first).toContain(`-${baseOptions.start.getTime()}-`);
    expect(second).toBe(first);

    const other = unfold(
      buildBridgeIcs({ ...baseOptions, attendees: [{ email: 'someone@else.com' }] }),
    ).find((l) => l.startsWith('UID:'));
    expect(other).not.toBe(first);
  });

  it('emits DTSTAMP, DTSTART and DTEND in UTC basic format', () => {
    const lines = unfold(buildBridgeIcs(baseOptions));
    const dtstamp = lines.find((l) => l.startsWith('DTSTAMP:'));
    expect(dtstamp).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
    expect(lines).toContain('DTSTART:20260612T143000Z');
    expect(lines).toContain('DTEND:20260612T153000Z');
  });

  it('respects durationMinutes when computing DTEND', () => {
    const lines = unfold(buildBridgeIcs({ ...baseOptions, durationMinutes: 90 }));
    expect(lines).toContain('DTEND:20260612T160000Z');
  });

  it('emits ORGANIZER with CN and mailto', () => {
    const lines = unfold(buildBridgeIcs(baseOptions));
    expect(lines).toContain('ORGANIZER;CN=organizer@test.com:mailto:organizer@test.com');
  });

  it('emits one ATTENDEE per recipient with CN falling back to the email', () => {
    const lines = unfold(buildBridgeIcs(baseOptions));
    expect(lines).toContain(
      'ATTENDEE;CN=Alice Adams;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:alice@test.com',
    );
    expect(lines).toContain(
      'ATTENDEE;CN=bob@test.com;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bob@test.com',
    );
  });

  it('skips attendees with an empty email', () => {
    const lines = unfold(
      buildBridgeIcs({
        ...baseOptions,
        attendees: [{ name: 'Ghost', email: '' }, { email: 'real@test.com' }],
      }),
    );
    expect(lines.filter((l) => l.startsWith('ATTENDEE'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('Ghost'))).toBe(false);
  });

  it('includes STATUS:CONFIRMED', () => {
    expect(unfold(buildBridgeIcs(baseOptions))).toContain('STATUS:CONFIRMED');
  });
});
