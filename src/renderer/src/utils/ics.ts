/**
 * Minimal RFC 5545 (.ics) generator for Schedule Bridge meeting invites.
 * Covers the essentials only: CRLF line endings, 75-octet line folding,
 * TEXT escaping, and a single METHOD:REQUEST VEVENT.
 */

export type IcsAttendee = { name?: string; email: string };

export type BridgeIcsOptions = {
  subject: string;
  start: Date;
  durationMinutes: number;
  organizerEmail: string;
  attendees: IcsAttendee[];
};

const MAX_LINE_OCTETS = 75;

/** Escapes a TEXT value per RFC 5545 §3.3.11 (backslash, semicolon, comma, newline). */
function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

/** Formats a date in UTC basic format: YYYYMMDDTHHMMSSZ. */
function formatUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Folds a content line at 75 octets; continuation lines begin with a single
 * space (RFC 5545 §3.1). Splits on character boundaries so multi-byte UTF-8
 * sequences are never broken.
 */
function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = '';
  let currentOctets = 0;
  // Continuation lines lose one octet to the leading space
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const charOctets = encoder.encode(char).length;
    if (currentOctets + charOctets > limit) {
      folded.push(current);
      current = ' ';
      currentOctets = 1;
      limit = MAX_LINE_OCTETS;
    }
    current += char;
    currentOctets += charOctets;
  }
  folded.push(current);
  return folded;
}

/** Small deterministic hash (djb2) over the attendee emails for UID stability. */
function hashAttendees(attendees: IcsAttendee[]): string {
  const input = attendees.map((a) => a.email.toLowerCase()).join(',');
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export function buildBridgeIcs(options: BridgeIcsOptions): string {
  const { subject, start, durationMinutes, organizerEmail, attendees } = options;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const invited = attendees.filter((a) => a.email.trim().length > 0);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Relay//Schedule Bridge//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:relay-bridge-${start.getTime()}-${hashAttendees(invited)}@relay`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeText(subject)}`,
    `ORGANIZER;CN=${organizerEmail}:mailto:${organizerEmail}`,
    ...invited.map(
      (a) => `ATTENDEE;CN=${a.name || a.email};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`,
    ),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.flatMap(foldLine).join('\r\n') + '\r\n';
}
