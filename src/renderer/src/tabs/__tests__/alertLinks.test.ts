import { describe, expect, it } from 'vitest';
import { buildAlertOutlookEml, buildAlertOutlookHtml, sanitizeAlertClickUrl } from '../alertLinks';

function decodePart(eml: string, contentType: string): string {
  const marker = `Content-Type: ${contentType}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
  const encoded = eml.split(marker)[1]?.split('\r\n--relay_alert_')[0] ?? '';
  return Buffer.from(encoded.replaceAll('\r\n', ''), 'base64').toString('utf8');
}

const decodeHtmlPart = (eml: string) => decodePart(eml, 'text/html');
const decodeTextPart = (eml: string) => decodePart(eml, 'text/plain');

function decodeMimeSubject(eml: string): string {
  const encoded = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(eml)?.[1] ?? '';
  return Buffer.from(encoded, 'base64').toString('utf8');
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
    expect(eml).toContain('Content-Type: multipart/alternative;');
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

  it('keeps the complete Unicode alert readable without the inline card image', () => {
    const eml = buildAlertOutlookEml({
      subject: '🚨 Payments unavailable',
      imageDataUrl: 'data:image/png;base64,QUJD',
      imageHref: 'https://status.example.com/incidents/42',
      width: 1280,
      height: 1200,
      severity: 'ISSUE',
      bodyHtml:
        '<p>Card payments are unavailable in Montréal.</p><p>Next update in 30 minutes.</p>',
      sender: 'Network Operations',
      recipient: 'Store leaders',
      updateNumber: 2,
      eventTimeStart: '2026-07-02T12:00:00.000Z',
      now: new Date('2026-07-02T12:00:00.000Z'),
    });

    const text = decodeTextPart(eml);
    const htmlWithoutImages = decodeHtmlPart(eml).replaceAll(/<img\b[^>]*>/gi, '');
    for (const expected of [
      'ISSUE',
      '🚨 Payments unavailable',
      'Card payments are unavailable in Montréal.',
      'Next update in 30 minutes.',
      'Network Operations',
      'Store leaders',
      'UPDATE #2',
      'Started',
    ]) {
      expect(text).toContain(expected);
      expect(htmlWithoutImages).toContain(expected);
    }
    expect(htmlWithoutImages).toContain(
      '<a href="https://status.example.com/incidents/42">More information</a>',
    );
  });

  it('preserves multiline lists and safe links while removing active and unsafe markup', () => {
    const eml = buildAlertOutlookEml({
      subject: 'Response steps',
      imageDataUrl: 'data:image/png;base64,QUJD',
      width: 640,
      height: 400,
      severity: 'MAINTENANCE',
      bodyHtml:
        '<p onclick="steal()">First line<br>Second line</p><ul><li>Retry checkout</li><li><a href="https://status.example.com/runbook">Open runbook</a></li></ul><p><a href="javascript:alert(1)">Unsafe destination</a><script>secret()</script><img src="data:image/png;base64,QUJD" alt="Checkout error graph"></p>',
      sender: 'IT',
      recipient: 'All Employees',
      now: new Date('2026-07-02T12:00:00.000Z'),
    });

    const text = decodeTextPart(eml);
    const html = decodeHtmlPart(eml);
    expect(text).toContain('First line\nSecond line');
    expect(text).toContain('• Retry checkout');
    expect(text).toContain('Open runbook (https://status.example.com/runbook)');
    expect(text).toContain('Image: Checkout error graph');
    expect(html).toContain('<a href="https://status.example.com/runbook"');
    expect(html).toContain('Image: Checkout error graph');
    expect(html).not.toMatch(/onclick|javascript:|<script|secret\(\)/i);
  });

  it('keeps semantic body content out of message headers', () => {
    const eml = buildAlertOutlookEml({
      subject: 'Service notice',
      imageDataUrl: 'data:image/png;base64,QUJD',
      width: 640,
      height: 400,
      severity: 'INFO',
      bodyHtml: '<p>Review complete\r\nBcc: injected@example.com</p>',
      sender: 'IT\r\nCc: injected@example.com',
      recipient: 'Employees\r\nTo: injected@example.com',
      now: new Date('2026-07-02T12:00:00.000Z'),
    });

    const headers = eml.split('\r\n\r\n', 1)[0];
    expect(headers).not.toMatch(/(^|\r\n)(Bcc|Cc|To):/);
    expect(decodeTextPart(eml)).toContain('Bcc: injected@example.com');
  });

  it('preserves a non-BMP alert subject through UTF-8 MIME encoding', () => {
    const eml = buildAlertOutlookEml({
      subject: '🚨 POS Alert',
      imageDataUrl: 'data:image/png;base64,QUJD',
      width: 1280,
      height: 1200,
      now: new Date('2026-07-02T12:00:00.000Z'),
    });

    expect(decodeMimeSubject(eml)).toBe('🚨 POS Alert');
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
