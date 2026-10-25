import { MAX_ALERT_DRAFT_EML_LENGTH } from '@shared/ipc';
import type { AlertInlineImage } from './alerts/alertEmailHtml';

export const ALERT_CLICK_URL_MAX_LENGTH = 2048;

const BACKUP_CARD_FILE_NAME = 'relay-alert-card.png';
const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([a-z0-9+/=]+)$/i;

/** Thrown when a draft would reach the main process's EML size cap. */
export class AlertEmlTooLargeError extends Error {
  constructor() {
    super('The alert draft is too large for one email');
    this.name = 'AlertEmlTooLargeError';
  }
}

export type AlertGuideEmlInput = {
  /** The Subject header, which may carry the "UPDATE #n —" prefix. */
  subject: string;
  html: string;
  text: string;
  inlineImages: AlertInlineImage[];
  /** The full-card PNG attached as a backup; omitted when capture failed. */
  backupPngDataUrl?: string | null;
  now?: Date;
};

/**
 * Accept one HTTP(S) destination for the alert image. Bare hostnames are
 * treated as HTTPS; LAN HTTP links must include their explicit http:// scheme.
 */
export function sanitizeAlertClickUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ALERT_CLICK_URL_MAX_LENGTH) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  if (hasScheme && !/^https?:/i.test(trimmed)) return null;

  try {
    const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeHeaderValue(value: string, fallback: string): string {
  const firstLine = String(value).split(/[\r\n]/)[0] ?? '';
  const withoutControls = Array.from(firstLine)
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint === 9 || (codePoint >= 32 && codePoint !== 127);
    })
    .join('');
  return withoutControls.trim() || fallback;
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCodePoint(...Array.from(bytes.subarray(index, index + chunkSize)));
  }
  return btoa(binary);
}

function encodeMimeHeader(value: string, fallback: string): string {
  const sanitized = sanitizeHeaderValue(value, fallback);
  if (/^[\x20-\x7e]*$/.test(sanitized)) return sanitized;
  return `=?UTF-8?B?${base64EncodeUtf8(sanitized)}?=`;
}

function wrapBase64(value: string): string {
  return value.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function imagePart(dataUrl: string): { mimeType: string; payload: string } {
  const match = IMAGE_DATA_URL.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!match) throw new Error('Alert draft images must be image data URLs');
  const mimeType = match[1]!.toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1]!.toLowerCase();
  return { mimeType, payload: wrapBase64(match[2]!) };
}

function safeFileName(value: string): string {
  return value.replaceAll(/[^a-z0-9._-]/gi, '') || 'image';
}

/**
 * Build an editable Outlook EML draft: the alert card as HTML with its images inline, a plain-text
 * alternative, and the full-card PNG attached as a backup.
 */
export function buildAlertGuideEml({
  subject,
  html,
  text,
  inlineImages,
  backupPngDataUrl,
  now = new Date(),
}: AlertGuideEmlInput): string {
  const stamp = now.getTime();
  const mixedBoundary = `relay_alert_mixed_${stamp}`;
  const alternativeBoundary = `relay_alert_alt_${stamp}`;
  const relatedBoundary = `relay_alert_related_${stamp}`;

  const inlineParts = inlineImages.flatMap((image) => {
    const { mimeType, payload } = imagePart(image.dataUrl);
    const fileName = safeFileName(image.fileName);
    return [
      `--${relatedBoundary}`,
      `Content-Type: ${mimeType}; name="${fileName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${safeFileName(image.cid)}>`,
      `Content-Disposition: inline; filename="${fileName}"`,
      '',
      payload,
    ];
  });
  const backupParts = backupPngDataUrl
    ? [
        `--${mixedBoundary}`,
        `Content-Type: image/png; name="${BACKUP_CARD_FILE_NAME}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${BACKUP_CARD_FILE_NAME}"`,
        '',
        imagePart(backupPngDataUrl).payload,
      ]
    : [];

  const eml = [
    `Subject: ${encodeMimeHeader(subject, 'Relay Alert')}`,
    `Date: ${now.toUTCString()}`,
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(base64EncodeUtf8(text)),
    `--${alternativeBoundary}`,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"; type="text/html"`,
    '',
    `--${relatedBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(base64EncodeUtf8(html)),
    ...inlineParts,
    `--${relatedBoundary}--`,
    `--${alternativeBoundary}--`,
    ...backupParts,
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n');

  if (eml.length >= MAX_ALERT_DRAFT_EML_LENGTH) throw new AlertEmlTooLargeError();
  return eml;
}
