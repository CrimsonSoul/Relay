/**
 * New Outlook for Mac opens every .eml read-only, so on macOS the alert draft is handed to Outlook
 * through AppleScript instead: the HTML part, with each inline image turned into a data URI, becomes
 * the body of a new outgoing message. Only the EML that `buildAlertGuideEml` writes is understood.
 */

export type OutlookDraftContent = { subject: string; html: string };

const BOUNDARY = /boundary="([\w.-]{1,100})"/g;
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/;
const INLINE_IMAGE_TYPE = /^Content-Type: (image\/(?:png|jpeg|gif|webp));/im;
const CONTENT_ID = /^Content-ID: <([\w.-]{1,100})>$/im;

/** The script reads the HTML from a private file and takes the subject as an argument, so neither is ever interpolated into AppleScript source. */
export const OUTLOOK_DRAFT_SCRIPT = [
  'on run argv',
  '  set htmlText to read POSIX file (item 1 of argv) as «class utf8»',
  '  tell application id "com.microsoft.Outlook"',
  '    set draft to make new outgoing message with properties {subject:(item 2 of argv), content:htmlText}',
  '    open draft',
  '    activate',
  '  end tell',
  'end run',
].join('\n');

function headerBlock(eml: string): string {
  const end = eml.indexOf('\r\n\r\n');
  return end === -1 ? eml : eml.slice(0, end);
}

function decodeSubject(eml: string): string {
  const line = headerBlock(eml)
    .split('\r\n')
    .find((header) => header.startsWith('Subject: '));
  const value = line?.slice('Subject: '.length) ?? '';
  const encoded = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(value)?.[1];
  return encoded === undefined ? value : Buffer.from(encoded, 'base64').toString('utf8');
}

function mimeParts(eml: string): { headers: string; body: string }[] {
  const boundaries = [...eml.matchAll(BOUNDARY)].map((match) => match[1]!);
  if (boundaries.length === 0) return [];
  const delimiters = new Set(
    boundaries.flatMap((boundary) => [`--${boundary}`, `--${boundary}--`]),
  );
  const parts: { headers: string; body: string }[] = [];
  let current: string[] | null = null;
  for (const line of eml.split('\r\n')) {
    if (delimiters.has(line)) {
      if (current) parts.push(splitPart(current));
      current = [];
    } else {
      current?.push(line);
    }
  }
  return parts;
}

function splitPart(lines: string[]): { headers: string; body: string } {
  const blank = lines.indexOf('');
  if (blank === -1) return { headers: lines.join('\r\n'), body: '' };
  return { headers: lines.slice(0, blank).join('\r\n'), body: lines.slice(blank + 1).join('') };
}

const isBase64Part = (headers: string) => /^Content-Transfer-Encoding: base64$/im.test(headers);

/** The draft's subject and its HTML with every `cid:` image inlined, or null when there is no HTML part. */
export function outlookDraftFromEml(eml: string): OutlookDraftContent | null {
  const parts = mimeParts(eml);
  const htmlPart = parts.find(
    ({ headers }) => /^Content-Type: text\/html;/im.test(headers) && isBase64Part(headers),
  );
  if (!htmlPart || !BASE64_PAYLOAD.test(htmlPart.body)) return null;
  let html = Buffer.from(htmlPart.body, 'base64').toString('utf8');
  for (const { headers, body } of parts) {
    const type = INLINE_IMAGE_TYPE.exec(headers)?.[1];
    const cid = CONTENT_ID.exec(headers)?.[1];
    if (!type || !cid || !isBase64Part(headers) || !BASE64_PAYLOAD.test(body)) continue;
    // Quoted so relay-alert-body-1 never matches inside relay-alert-body-10.
    html = html.replaceAll(`"cid:${cid}"`, `"data:${type.toLowerCase()};base64,${body}"`);
  }
  return { subject: decodeSubject(eml), html };
}
