import { describe, expect, it } from 'vitest';
import { OUTLOOK_DRAFT_SCRIPT, outlookDraftFromEml } from './outlookDraftScript';

const base64 = (value: string) => Buffer.from(value).toString('base64');

function imagePart(cid: string, type: string, payload: string): string[] {
  return [
    '--rel',
    `Content-Type: ${type}; name="${cid}.png"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${cid}>`,
    `Content-Disposition: inline; filename="${cid}.png"`,
    '',
    payload,
  ];
}

function eml(subject: string, html: string, images: string[][] = []): string {
  return [
    'X-Unsent: 1',
    `Subject: ${subject}`,
    'Content-Type: multipart/mixed; boundary="mix"',
    '',
    '--mix',
    'Content-Type: multipart/alternative; boundary="alt"',
    '',
    '--alt',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64('plain text'),
    '--alt',
    'Content-Type: multipart/related; boundary="rel"; type="text/html"',
    '',
    '--rel',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    // Long payloads arrive wrapped at 76 characters.
    ...(base64(html).match(/.{1,76}/g) ?? []),
    ...images.flat(),
    '--rel--',
    '--alt--',
    '--mix--',
    '',
  ].join('\r\n');
}

describe('outlookDraftFromEml', () => {
  it('returns the decoded subject and the HTML body', () => {
    const html = `<p>${'Restart the VPN client. '.repeat(10)}</p>`;
    const subject = `=?UTF-8?B?${base64('October 27, 2026 — VPN outage')}?=`;

    expect(outlookDraftFromEml(eml(subject, html))).toEqual({
      subject: 'October 27, 2026 — VPN outage',
      html,
    });
    expect(outlookDraftFromEml(eml('Plain subject', html))?.subject).toBe('Plain subject');
  });

  it('inlines each cid image as a data URI without prefix collisions', () => {
    const draft = outlookDraftFromEml(
      eml('Guide', '<img src="cid:relay-alert-body-1"><img src="cid:relay-alert-body-10">', [
        imagePart('relay-alert-body-1', 'image/png', 'T05F'),
        imagePart('relay-alert-body-10', 'image/jpeg', 'VEVO'),
      ]),
    );

    expect(draft?.html).toBe(
      '<img src="data:image/png;base64,T05F"><img src="data:image/jpeg;base64,VEVO">',
    );
  });

  it('leaves unsupported or malformed image parts out', () => {
    const draft = outlookDraftFromEml(
      eml('Guide', '<img src="cid:svg"><img src="cid:broken">', [
        imagePart('svg', 'image/svg+xml', 'PHN2Zz4='),
        imagePart('broken', 'image/png', '"><script>'),
      ]),
    );

    expect(draft?.html).toBe('<img src="cid:svg"><img src="cid:broken">');
  });

  it('returns null when the EML has no HTML part', () => {
    expect(outlookDraftFromEml('X-Unsent: 1\r\nSubject: Test\r\n\r\nbody')).toBeNull();
  });

  it('keeps alert content out of the AppleScript source', () => {
    expect(OUTLOOK_DRAFT_SCRIPT).toContain('item 1 of argv');
    expect(OUTLOOK_DRAFT_SCRIPT).toContain('item 2 of argv');
    expect(OUTLOOK_DRAFT_SCRIPT).toContain('tell application id "com.microsoft.Outlook"');
  });
});
