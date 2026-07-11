import { describe, expect, it } from 'vitest';
import { buildAlertOutlookEml, buildAlertOutlookHtml, sanitizeAlertClickUrl } from '../alertLinks';

function decodeHtmlPart(eml: string): string {
  const marker = 'Content-Transfer-Encoding: base64\r\n\r\n';
  const encoded = eml.split(marker)[1]?.split('\r\n--relay_alert_')[0] ?? '';
  return Buffer.from(encoded.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

describe('alertLinks', () => {
  it('normalizes a safe URL and supports explicit LAN HTTP destinations', () => {
    expect(sanitizeAlertClickUrl('status.example.com/board')).toBe(
      'https://status.example.com/board',
    );
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Explicit HTTP is supported for user-approved LAN-only Relay endpoints.
    expect(sanitizeAlertClickUrl('http://relay-noc.local:8080/problem/42')).toBe(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols -- This is the expected normalized LAN-only URL.
      'http://relay-noc.local:8080/problem/42',
    );
  });

  it('rejects unsafe schemes, credentials, and invalid URLs', () => {
    expect(sanitizeAlertClickUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeAlertClickUrl('ftp://files.example.com')).toBeNull();
    expect(sanitizeAlertClickUrl('https://user:pass@example.com')).toBeNull();
    expect(sanitizeAlertClickUrl('not a url')).toBeNull();
  });

  it('wraps the entire CID image in one sanitized link at an explicit 640px size', () => {
    const html = buildAlertOutlookHtml({
      imageCid: 'relay-alert-image',
      imageHref: 'https://status.example.com/board',
      width: 1280,
      height: 1200,
    });

    expect(html).toContain('src="cid:relay-alert-image"');
    expect(html).toContain('width="640" height="600"');
    expect(html).toContain('style="display:block;width:640px;height:600px');
    expect(html).toContain('<a href="https://status.example.com/board"');
    expect(html).toContain('</a>');
    expect(html).not.toContain('javascript:');
  });

  it('does not upscale a native-size clipboard fallback image', () => {
    const html = buildAlertOutlookHtml({ width: 480, height: 300 });

    expect(html).toContain('width="480" height="300"');
  });

  it('builds an unsent EML without using cosmetic card labels as message headers', () => {
    const eml = buildAlertOutlookEml({
      subject: 'POS Alert\r\nBcc: injected@example.com',
      imageDataUrl: 'data:image/png;base64,QUJD',
      imageHref: 'https://status.example.com/board',
      width: 1280,
      height: 1200,
      now: new Date('2026-07-02T12:00:00.000Z'),
    });

    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toContain('Content-Type: multipart/related;');
    expect(eml).toContain('Content-ID: <relay-alert-image>');
    expect(eml).toContain('Content-Disposition: inline; filename="relay-alert.png"');
    expect(eml).toContain('QUJD');
    expect(eml).toContain('Subject: POS Alert');
    expect(eml).not.toMatch(/(^|\r\n)From:/);
    expect(eml).not.toMatch(/(^|\r\n)To:/);
    expect(eml).not.toContain('Bcc: injected@example.com');
    expect(decodeHtmlPart(eml)).toContain('<a href="https://status.example.com/board"');
  });

  it('rejects malformed image data instead of building a draft', () => {
    expect(() =>
      buildAlertOutlookEml({
        subject: 'Alert',
        imageDataUrl: 'data:image/jpeg;base64,QUJD',
        width: 1280,
        height: 1200,
      }),
    ).toThrow('PNG data URL');
  });
});
