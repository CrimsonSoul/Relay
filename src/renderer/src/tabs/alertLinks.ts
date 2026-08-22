export const ALERT_CLICK_URL_MAX_LENGTH = 2048;

const ALERT_IMAGE_CID = 'relay-alert-image';
const OUTLOOK_ALERT_WIDTH = 640;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

type AlertOutlookImageDimensions = {
  width: number;
  height: number;
};

type AlertOutlookHtmlInput = AlertOutlookImageDimensions & {
  imageCid?: string;
  imageHref?: string;
};

type AlertOutlookEmlInput = AlertOutlookHtmlInput & {
  subject: string;
  imageDataUrl: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function normalizeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function getOutlookDisplayDimensions({
  width,
  height,
}: AlertOutlookImageDimensions): AlertOutlookImageDimensions {
  const sourceWidth = normalizeDimension(width, OUTLOOK_ALERT_WIDTH);
  const sourceHeight = normalizeDimension(height, OUTLOOK_ALERT_WIDTH);
  const displayWidth = Math.min(sourceWidth, OUTLOOK_ALERT_WIDTH);
  return {
    width: displayWidth,
    height: Math.max(1, Math.round((sourceHeight * displayWidth) / sourceWidth)),
  };
}

/** Build Outlook-safe HTML with one CID image and one optional whole-image link. */
export function buildAlertOutlookHtml({
  imageCid = ALERT_IMAGE_CID,
  imageHref,
  width,
  height,
}: AlertOutlookHtmlInput): string {
  const safeHref = imageHref ? sanitizeAlertClickUrl(imageHref) : null;
  const display = getOutlookDisplayDimensions({ width, height });
  const imageHtml = `<img src="cid:${escapeHtml(imageCid)}" width="${display.width}" height="${display.height}" alt="Relay alert" border="0" style="display:block;width:${display.width}px;height:${display.height}px;border:0;outline:none;text-decoration:none;margin:0;padding:0;">`;
  const alertHtml = safeHref
    ? `<a href="${escapeHtml(safeHref)}" style="display:block;width:${display.width}px;border:0;outline:none;text-decoration:none;margin:0;padding:0;">${imageHtml}</a>`
    : imageHtml;

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${display.width}" style="width:${display.width}px;border-collapse:collapse;border-spacing:0;">
      <tr><td width="${display.width}" style="width:${display.width}px;margin:0;padding:0;">${alertHtml}</td></tr>
    </table>
  </body>
</html>`;
}

function imagePayloadFromDataUrl(dataUrl: string): string {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error('Alert draft image must be a PNG data URL');
  }
  const payload = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (!payload || !/^[a-z0-9+/=]+$/i.test(payload)) {
    throw new Error('Alert draft image must contain valid PNG base64 data');
  }
  return payload;
}

/** Build an editable Outlook EML draft with the alert preserved as an inline PNG. */
export function buildAlertOutlookEml({
  subject,
  imageDataUrl,
  imageHref,
  width,
  height,
  now = new Date(),
}: AlertOutlookEmlInput): string {
  const boundary = `relay_alert_${now.getTime()}`;
  const html = buildAlertOutlookHtml({
    imageCid: ALERT_IMAGE_CID,
    imageHref,
    width,
    height,
  });
  const htmlPayload = wrapBase64(base64EncodeUtf8(html));
  const imagePayload = wrapBase64(imagePayloadFromDataUrl(imageDataUrl));

  return [
    `Subject: ${encodeMimeHeader(subject, 'Relay Alert')}`,
    `Date: ${now.toUTCString()}`,
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlPayload,
    `--${boundary}`,
    'Content-Type: image/png; name="relay-alert.png"',
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${ALERT_IMAGE_CID}>`,
    'Content-Disposition: inline; filename="relay-alert.png"',
    '',
    imagePayload,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
