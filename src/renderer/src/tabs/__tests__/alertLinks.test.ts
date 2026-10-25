import { describe, expect, it } from 'vitest';
import { MAX_ALERT_DRAFT_EML_LENGTH } from '@shared/ipc';
import {
  AlertEmlTooLargeError,
  buildAlertGuideEml,
  sanitizeAlertClickUrl,
  type AlertGuideEmlInput,
} from '../alertLinks';

const PNG = 'data:image/png;base64,QUJD';

function fixture(overrides: Partial<AlertGuideEmlInput> = {}): AlertGuideEmlInput {
  return {
    subject: 'VPN outage',
    html: '<!doctype html><html><body><img src="cid:relay-alert-body-0"></body></html>',
    text: 'ALERT ISSUE\n\nRestart the VPN client.',
    inlineImages: [{ cid: 'relay-alert-body-0', dataUrl: PNG, fileName: 'image-0.png' }],
    backupPngDataUrl: PNG,
    now: new Date('2026-07-02T12:00:00.000Z'),
    ...overrides,
  };
}

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

  it('nests alternative and related parts inside multipart/mixed', () => {
    const eml = buildAlertGuideEml(fixture());
    expect(eml).toMatch(
      /^Subject: .*\r\nDate: .*\r\nMIME-Version: 1\.0\r\nX-Unsent: 1\r\nContent-Type: multipart\/mixed;/,
    );
    expect(eml).toContain('Content-Type: multipart/alternative;');
    expect(eml).toContain('Content-Type: multipart/related;');
    expect(eml).toContain('Content-ID: <relay-alert-body-0>');
    expect(eml).toContain('Content-Disposition: inline; filename="image-0.png"');
    expect(eml).toContain('Content-Disposition: attachment; filename="relay-alert-card.png"');
    expect(decodeHtmlPart(eml)).toContain('src="cid:relay-alert-body-0"');
    expect(decodeTextPart(eml)).toContain('Restart the VPN client.');
  });

  it('omits the backup attachment when no PNG is given', () => {
    const eml = buildAlertGuideEml(fixture({ backupPngDataUrl: null }));
    expect(eml).not.toContain('relay-alert-card.png');
    expect(eml).toContain('Content-Type: multipart/mixed;');
  });

  it('keeps each image MIME type from its data URL', () => {
    const eml = buildAlertGuideEml(
      fixture({
        inlineImages: [
          {
            cid: 'relay-alert-body-0',
            dataUrl: 'data:image/jpeg;base64,QUJD',
            fileName: 'image-0.jpg',
          },
        ],
      }),
    );
    expect(eml).toContain('Content-Type: image/jpeg; name="image-0.jpg"');
  });

  it('refuses an EML at the size cap', () => {
    const big = `data:image/png;base64,${'A'.repeat(MAX_ALERT_DRAFT_EML_LENGTH)}`;
    expect(() =>
      buildAlertGuideEml(
        fixture({
          inlineImages: [{ cid: 'relay-alert-body-0', dataUrl: big, fileName: 'image-0.png' }],
        }),
      ),
    ).toThrow(AlertEmlTooLargeError);
  });

  it('keeps header injection out of the message headers', () => {
    const eml = buildAlertGuideEml(fixture({ subject: 'POS Alert\r\nBcc: injected@example.com' }));
    const headers = eml.split('\r\n\r\n', 1)[0];
    expect(headers).toContain('Subject: POS Alert');
    expect(headers).not.toMatch(/(^|\r\n)(Bcc|Cc|To|From):/);
  });

  it('preserves a non-BMP alert subject through UTF-8 MIME encoding', () => {
    expect(decodeMimeSubject(buildAlertGuideEml(fixture({ subject: '🚨 POS Alert' })))).toBe(
      '🚨 POS Alert',
    );
  });

  it('rejects malformed image data instead of building a draft', () => {
    expect(() =>
      buildAlertGuideEml(
        fixture({
          inlineImages: [
            { cid: 'relay-alert-body-0', dataUrl: 'data:text/plain;base64,QUJD', fileName: 'x' },
          ],
        }),
      ),
    ).toThrow('image data URL');
  });
});
