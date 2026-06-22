import type { AlertBodyFontSize, Severity } from '../alertUtils';

type InlineImage = {
  cid: string;
  filename: string;
  mimeType: string;
  base64: string;
};

export type AlertEmlInput = {
  severity: Severity;
  displaySubject: string;
  displaySender: string;
  displayRecipient: string;
  bodyHtml: string;
  logoDataUrl: string | null;
  footerLogoDataUrl: string | null;
  eventTimeStartIso?: string;
  eventTimeEndIso?: string;
  alertBodyFontSize?: AlertBodyFontSize;
  generatedAt?: Date;
};

const SEVERITY_COLORS: Record<Severity, { banner: string; subjectPrefix: string }> = {
  ISSUE: { banner: '#d32f2f', subjectPrefix: 'ISSUE' },
  MAINTENANCE: { banner: '#f9a825', subjectPrefix: 'MAINTENANCE' },
  INFO: { banner: '#1565c0', subjectPrefix: 'INFO' },
  RESOLVED: { banner: '#2e7d32', subjectPrefix: 'RESOLVED' },
};

const EVENT_CONTEXT: Record<Severity, { icon: string; label: string }> = {
  MAINTENANCE: { icon: '📅', label: 'Scheduled' },
  ISSUE: { icon: '⏰', label: 'Started' },
  INFO: { icon: '📌', label: 'When' },
  RESOLVED: { icon: '✅', label: 'Duration' },
};

const CENTRAL_TZ = 'America/Chicago';

const HIGHLIGHT_STYLES: Record<string, string> = {
  deadline:
    'background:#fff3cd; color:#856404; font-weight:600; padding:1px 5px; border-radius:3px;',
  warning:
    'background:#fee2e2; color:#991b1b; font-weight:600; padding:1px 5px; border-radius:3px;',
  success:
    'background:#d1fae5; color:#065f46; font-weight:600; padding:1px 5px; border-radius:3px;',
  number: 'color:#1565c0; font-weight:700;',
  service:
    "font-family:'Courier New', Courier, monospace; font-size:0.9em; background:#f0f0f5; color:#333333; padding:1px 6px; border-radius:3px;",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}

function cleanHeader(value: string): string {
  return value
    .replaceAll(/[\r\n]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function isSafeHref(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:', 'msteams:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function parseDataImage(dataUrl: string): { mimeType: string; base64: string; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const extByMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return { mimeType, base64: match[2], ext: extByMime[mimeType] ?? 'png' };
}

function createInlineImage(
  dataUrl: string | null,
  cid: string,
  filenameBase: string,
): InlineImage | null {
  if (!dataUrl) return null;
  const parsed = parseDataImage(dataUrl);
  if (!parsed) return null;
  return {
    cid,
    filename: `${filenameBase}.${parsed.ext}`,
    mimeType: parsed.mimeType,
    base64: parsed.base64,
  };
}

function addBodyImage(images: InlineImage[], dataUrl: string): InlineImage | null {
  const parsed = parseDataImage(dataUrl);
  if (!parsed) return null;
  const index = images.filter((image) => image.cid.startsWith('relay-body-image-')).length + 1;
  const image = {
    cid: `relay-body-image-${index}`,
    filename: `relay-body-image-${index}.${parsed.ext}`,
    mimeType: parsed.mimeType,
    base64: parsed.base64,
  };
  images.push(image);
  return image;
}

function sanitizeEmailBodyHtml(html: string, images: InlineImage[]): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const getVisibleText = (element: Element): string =>
    (element.textContent ?? '')
      .replaceAll('\u200b', '')
      .replaceAll('\u200c', '')
      .replaceAll('\u200d', '')
      .replaceAll('\ufeff', '')
      .replaceAll('\u2060', '')
      .trim();

  const hasImageDescendant = (element: Element): boolean => element.querySelector('img') !== null;

  const walk = (node: Node, activeImageHref?: string): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const renderChildren = (imageHref?: string) =>
      Array.from(el.childNodes)
        .map((child) => walk(child, imageHref))
        .join('');

    switch (tag) {
      case 'br':
        return '<br>';
      case 'b':
      case 'strong':
        return `<strong style="font-weight:700;">${renderChildren(activeImageHref)}</strong>`;
      case 'i':
      case 'em':
        return `<em>${renderChildren(activeImageHref)}</em>`;
      case 'u':
        return `<u>${renderChildren(activeImageHref)}</u>`;
      case 'p':
        return `<p style="margin:0 0 14px;">${renderChildren(activeImageHref)}</p>`;
      case 'ul':
        return `<ul style="margin:0 0 16px; padding-left:22px;">${renderChildren(activeImageHref)}</ul>`;
      case 'ol':
        return `<ol style="margin:0 0 16px; padding-left:22px;">${renderChildren(activeImageHref)}</ol>`;
      case 'li':
        return `<li style="margin:4px 0;">${renderChildren(activeImageHref)}</li>`;
      case 'a': {
        const href = el.getAttribute('href')?.trim() ?? '';
        if (!href || !isSafeHref(href)) return renderChildren(activeImageHref);
        if (hasImageDescendant(el) && getVisibleText(el).length === 0) {
          return renderChildren(href);
        }
        const children = renderChildren(activeImageHref);
        return `<a href="${escapeAttr(href)}" class="relay-email-link" style="color:#1565c0; font-weight:700; text-decoration:underline;">${children}</a>`;
      }
      case 'img': {
        const src = el.getAttribute('src')?.trim() ?? '';
        const image = addBodyImage(images, src);
        if (!image) return '';
        const alt = el.getAttribute('alt')?.trim() || 'Alert image';
        const imageMarkup = `<img src="cid:${image.cid}" alt="${escapeAttr(alt)}" width="516" style="display:block; border:0; width:516px; max-width:516px; height:auto;">`;
        const linkedImageMarkup = activeImageHref
          ? `<a href="${escapeAttr(activeImageHref)}" class="relay-email-link" style="color:#1565c0; text-decoration:none;">${imageMarkup}</a>`
          : imageMarkup;
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:17px 0 18px;"><tr><td class="relay-email-image-frame" style="border:1px solid #d7d7dc; background:#ffffff; background-color:#ffffff; padding:0;">${linkedImageMarkup}</td></tr></table>`;
      }
      case 'span': {
        const hlType = (el as HTMLElement).dataset.hl;
        const children = renderChildren(activeImageHref);
        if (hlType && HIGHLIGHT_STYLES[hlType]) {
          return `<span style="${HIGHLIGHT_STYLES[hlType]}">${children}</span>`;
        }
        return children;
      }
      default:
        return renderChildren(activeImageHref);
    }
  };

  const result = Array.from(doc.body.childNodes)
    .map((child) => walk(child))
    .join('');
  return result.trim() || '<p style="margin:0 0 14px;">Your message will appear here...</p>';
}

function formatEventDateTime(isoString: string): string {
  const date = new Date(isoString);
  return (
    date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: CENTRAL_TZ,
    }) +
    ' · ' +
    date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: CENTRAL_TZ,
      timeZoneName: 'short',
    })
  );
}

function formatTimeOnly(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: CENTRAL_TZ,
    timeZoneName: 'short',
  });
}

function formatEventWindow(
  severity: Severity,
  startIso?: string,
  endIso?: string,
): { icon: string; label: string; value: string } | null {
  if (!startIso) return null;

  const context = EVENT_CONTEXT[severity];
  const endDate = endIso ? new Date(endIso) : null;
  const sameDay =
    endDate &&
    new Date(startIso).toLocaleDateString('en-US', { timeZone: CENTRAL_TZ }) ===
      endDate.toLocaleDateString('en-US', { timeZone: CENTRAL_TZ });

  let value: string;
  if (endIso && sameDay) {
    value = formatEventDateTime(startIso).replace(
      /(\d{1,2}:\d{2}\s*[AP]M\s*\w+)$/,
      `$1 – ${formatTimeOnly(endIso)}`,
    );
  } else if (endIso) {
    value = `${formatEventDateTime(startIso)} – ${formatEventDateTime(endIso)}`;
  } else {
    value = formatEventDateTime(startIso);
  }

  return { ...context, value };
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

function buildHtml(input: AlertEmlInput, images: InlineImage[]): string {
  const colors = SEVERITY_COLORS[input.severity];
  const bodyFontSize = input.alertBodyFontSize === 'large' ? '19px' : '14.5px';
  const bodyHtml = sanitizeEmailBodyHtml(input.bodyHtml, images);
  const eventWindow = formatEventWindow(
    input.severity,
    input.eventTimeStartIso,
    input.eventTimeEndIso,
  );
  const logo = images.find((image) => image.cid === 'relay-logo-1');
  const footerLogo = images.find((image) => image.cid === 'relay-footer-logo-1');
  let logoMarkup =
    '<span style="font-size:13px; font-weight:800; letter-spacing:6px; color:#ffffff; text-transform:uppercase;">RELAY</span>';
  if (logo) {
    logoMarkup = `<img src="cid:${logo.cid}" height="36" alt="Relay" style="display:block; border:0; height:36px; width:auto; max-width:200px;">`;
  }
  let eventWindowMarkup = '';
  if (eventWindow) {
    eventWindowMarkup = `<tr><td class="relay-email-event" align="center" bgcolor="#fff8e1" style="background:#fff8e1; background-color:#fff8e1; background:linear-gradient(135deg, #fff8e1 0%, #fff3cd 100%); border-bottom:1px solid #f0dca0; padding:0;"><table class="relay-email-event-lock" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff8e1" style="border-collapse:collapse; background:#fff8e1; background-color:#fff8e1; background-image:linear-gradient(#fff8e1,#fff8e1);"><tr><td align="center" style="padding:9px 36px; font-family:Arial, Helvetica, sans-serif; font-size:12.5px;"><span style="font-size:14px; padding-right:8px;">${escapeHtml(eventWindow.icon)}</span><span class="relay-email-event-label" style="font-size:10.5px; font-weight:700; letter-spacing:0.06em; color:#856404; text-transform:uppercase;">${escapeHtml(eventWindow.label)}</span><span class="relay-email-event-value" style="font-family:'Courier New', Courier, monospace; font-size:11.5px; font-weight:500; letter-spacing:0.01em; color:#6d5200; padding-left:8px;">${escapeHtml(eventWindow.value)}</span></td></tr></table></td></tr>`;
  }
  let footerLogoMarkup = '&nbsp;';
  if (footerLogo) {
    footerLogoMarkup = `<img src="cid:${footerLogo.cid}" height="14" alt="" style="display:block; border:0; height:14px; width:auto; max-width:120px; opacity:0.45;">`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body, table, td, div, span, p { color-scheme: light dark; }
      @media (prefers-color-scheme: dark) {
        .relay-email-page { background:#101113 !important; background-color:#101113 !important; color:#f3f4f6 !important; }
        .relay-email-card { background:#191a1d !important; background-color:#191a1d !important; border-color:${colors.banner} !important; box-shadow:none !important; }
        .relay-email-title { background:#191a1d !important; background-color:#191a1d !important; border-bottom-color:#3a3d42 !important; }
        .relay-email-title-lock { background:#191a1d !important; background-color:#191a1d !important; background-image:linear-gradient(#191a1d,#191a1d) !important; }
        .relay-email-subject { color:#f3f4f6 !important; }
        .relay-email-event { background:#2a2415 !important; background-color:#2a2415 !important; border-bottom-color:#4b3f1d !important; }
        .relay-email-event-lock { background:#2a2415 !important; background-color:#2a2415 !important; background-image:linear-gradient(#2a2415,#2a2415) !important; }
        .relay-email-event-label { color:#f4c84a !important; }
        .relay-email-event-value { color:#ecdca4 !important; }
        .relay-email-meta { background:#161719 !important; background-color:#161719 !important; border-bottom-color:#3a3d42 !important; }
        .relay-email-meta-lock { background:#161719 !important; background-color:#161719 !important; background-image:linear-gradient(#161719,#161719) !important; }
        .relay-email-meta-text { color:#a9adb5 !important; }
        .relay-email-meta-strong { color:#e9eaee !important; }
        .relay-email-content { background:#202124 !important; background-color:#202124 !important; color:#d8dbe1 !important; }
        .relay-email-content-lock { background:#202124 !important; background-color:#202124 !important; background-image:linear-gradient(#202124,#202124) !important; color:#d8dbe1 !important; }
        .relay-email-content-inner, .relay-email-content p, .relay-email-content li { color:#d8dbe1 !important; }
        .relay-email-footer { background:#191a1d !important; background-color:#191a1d !important; border-top-color:#3a3d42 !important; }
        .relay-email-footer-lock { background:#191a1d !important; background-color:#191a1d !important; background-image:linear-gradient(#191a1d,#191a1d) !important; }
        .relay-email-link { color:#5aa8ff !important; }
        .relay-email-image-frame { background:#111214 !important; background-color:#111214 !important; border-color:#3a3d42 !important; }
      }
      [data-ogsc] .relay-email-page, [data-ogsb] .relay-email-page { background:#101113 !important; background-color:#101113 !important; color:#f3f4f6 !important; }
      [data-ogsc] .relay-email-card, [data-ogsb] .relay-email-card { background:#191a1d !important; background-color:#191a1d !important; border-color:${colors.banner} !important; box-shadow:none !important; }
      [data-ogsc] .relay-email-title, [data-ogsb] .relay-email-title { background:#191a1d !important; background-color:#191a1d !important; border-bottom-color:#3a3d42 !important; }
      [data-ogsc] .relay-email-title-lock, [data-ogsb] .relay-email-title-lock, .relay-email-title-lock[data-ogsc], .relay-email-title-lock[data-ogsb] { background:#191a1d !important; background-color:#191a1d !important; background-image:linear-gradient(#191a1d,#191a1d) !important; }
      [data-ogsc] .relay-email-subject, [data-ogsb] .relay-email-subject { color:#f3f4f6 !important; }
      [data-ogsc] .relay-email-event, [data-ogsb] .relay-email-event { background:#2a2415 !important; background-color:#2a2415 !important; border-bottom-color:#4b3f1d !important; }
      [data-ogsc] .relay-email-event-lock, [data-ogsb] .relay-email-event-lock, .relay-email-event-lock[data-ogsc], .relay-email-event-lock[data-ogsb] { background:#2a2415 !important; background-color:#2a2415 !important; background-image:linear-gradient(#2a2415,#2a2415) !important; }
      [data-ogsc] .relay-email-event-label, [data-ogsb] .relay-email-event-label { color:#f4c84a !important; }
      [data-ogsc] .relay-email-event-value, [data-ogsb] .relay-email-event-value { color:#ecdca4 !important; }
      [data-ogsc] .relay-email-meta, [data-ogsb] .relay-email-meta { background:#161719 !important; background-color:#161719 !important; border-bottom-color:#3a3d42 !important; }
      [data-ogsc] .relay-email-meta-lock, [data-ogsb] .relay-email-meta-lock, .relay-email-meta-lock[data-ogsc], .relay-email-meta-lock[data-ogsb] { background:#161719 !important; background-color:#161719 !important; background-image:linear-gradient(#161719,#161719) !important; }
      [data-ogsc] .relay-email-meta-text, [data-ogsb] .relay-email-meta-text { color:#a9adb5 !important; }
      [data-ogsc] .relay-email-meta-strong, [data-ogsb] .relay-email-meta-strong { color:#e9eaee !important; }
      [data-ogsc] .relay-email-content, [data-ogsb] .relay-email-content { background:#202124 !important; background-color:#202124 !important; color:#d8dbe1 !important; }
      [data-ogsc] .relay-email-content-lock, [data-ogsb] .relay-email-content-lock, .relay-email-content-lock[data-ogsc], .relay-email-content-lock[data-ogsb] { background:#202124 !important; background-color:#202124 !important; background-image:linear-gradient(#202124,#202124) !important; color:#d8dbe1 !important; }
      [data-ogsc] .relay-email-content-inner, [data-ogsb] .relay-email-content-inner, [data-ogsc] .relay-email-content p, [data-ogsb] .relay-email-content p, [data-ogsc] .relay-email-content li, [data-ogsb] .relay-email-content li { color:#d8dbe1 !important; }
      [data-ogsc] .relay-email-footer, [data-ogsb] .relay-email-footer { background:#191a1d !important; background-color:#191a1d !important; border-top-color:#3a3d42 !important; }
      [data-ogsc] .relay-email-footer-lock, [data-ogsb] .relay-email-footer-lock, .relay-email-footer-lock[data-ogsc], .relay-email-footer-lock[data-ogsb] { background:#191a1d !important; background-color:#191a1d !important; background-image:linear-gradient(#191a1d,#191a1d) !important; }
      [data-ogsc] .relay-email-link, [data-ogsb] .relay-email-link { color:#5aa8ff !important; }
      [data-ogsc] .relay-email-image-frame, [data-ogsb] .relay-email-image-frame { background:#111214 !important; background-color:#111214 !important; border-color:#3a3d42 !important; }
    </style>
    <title>${escapeHtml(input.displaySubject)}</title>
  </head>
  <body class="relay-email-page" bgcolor="#f0f1f4" style="margin:0; padding:0; background:#f0f1f4; background-color:#f0f1f4; color:#2d2d2d; font-family:Arial, Helvetica, sans-serif;">
    <table class="relay-email-page" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f1f4" style="border-collapse:collapse; background:#f0f1f4; background-color:#f0f1f4; margin:0; padding:0;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table class="relay-email-card" role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:640px; max-width:640px; border-collapse:separate; border-spacing:0; background:#ffffff; background-color:#ffffff; border:2px solid ${colors.banner}; border-bottom:5px solid ${colors.banner}; border-radius:10px; box-shadow:0 2px 20px rgba(0,0,0,0.1); overflow:hidden;">
            <tr>
              <td class="relay-email-banner" bgcolor="${colors.banner}" style="background:${colors.banner}; background-color:${colors.banner}; padding:16px 36px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td align="left" valign="middle" style="font-family:Arial, Helvetica, sans-serif; line-height:1;">
                      <div style="font-size:11px; font-weight:800; letter-spacing:0.18em; color:#ffe3e3; text-transform:uppercase; padding-bottom:2px;">ALERT</div>
                      <div style="font-size:22px; font-weight:800; letter-spacing:0.1em; color:#ffffff; text-transform:uppercase;">${escapeHtml(input.severity)}</div>
                    </td>
                    <td align="right" valign="middle" style="font-family:Arial, Helvetica, sans-serif;">${logoMarkup}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="relay-email-title" align="center" bgcolor="#ffffff" style="background:#ffffff; background-color:#ffffff; border-bottom:1px solid #eaeaea; padding:0;">
                <table class="relay-email-title-lock" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-collapse:collapse; background:#ffffff; background-color:#ffffff; background-image:linear-gradient(#ffffff,#ffffff);">
                  <tr>
                    <td align="center" style="padding:24px 36px 26px;">
                      <div class="relay-email-subject" style="font-family:Arial, Helvetica, sans-serif; font-size:24px; font-weight:700; line-height:1.3; color:#111118; letter-spacing:-0.02em;">${escapeHtml(input.displaySubject)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${eventWindowMarkup}
            <tr>
              <td class="relay-email-meta" align="center" bgcolor="#fafafa" style="background:#fafafa; background-color:#fafafa; border-bottom:1px solid #eaeaea; padding:0;">
                <table class="relay-email-meta-lock" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fafafa" style="border-collapse:collapse; background:#fafafa; background-color:#fafafa; background-image:linear-gradient(#fafafa,#fafafa);">
                  <tr>
                    <td align="center" style="padding:14px 36px;">
                      <span class="relay-email-meta-text" style="font-family:'Courier New', Courier, monospace; font-size:13px; color:#777777; letter-spacing:0.3px; text-transform:uppercase;">FROM <strong class="relay-email-meta-strong" style="color:#222222; font-weight:600; text-transform:none;">${escapeHtml(input.displaySender)}</strong></span>
                      <span style="display:inline-block; width:4px; height:4px; border-radius:4px; background:#bbbbbb; margin:0 10px; vertical-align:middle; line-height:4px; font-size:4px;">&nbsp;</span>
                      <span class="relay-email-meta-text" style="font-family:'Courier New', Courier, monospace; font-size:13px; color:#777777; letter-spacing:0.3px; text-transform:uppercase;">TO <strong class="relay-email-meta-strong" style="color:#222222; font-weight:600; text-transform:none;">${escapeHtml(input.displayRecipient)}</strong></span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="relay-email-content" bgcolor="#f7f7f8" style="background:#f7f7f8; background-color:#f7f7f8; padding:0; word-break:break-word;">
                <table class="relay-email-content-lock" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f7f8" style="border-collapse:collapse; background:#f7f7f8; background-color:#f7f7f8; background-image:linear-gradient(#f7f7f8,#f7f7f8);">
                  <tr>
                    <td style="padding:28px 36px 36px; font-family:Arial, Helvetica, sans-serif; font-size:${bodyFontSize}; line-height:1.7; color:#2d2d2d; word-break:break-word;"><div class="relay-email-content-inner" style="min-height:350px;">${bodyHtml}</div></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="relay-email-footer" bgcolor="#fafafa" style="background:#fafafa; background-color:#fafafa; border-top:1px solid #eaeaea; padding:0;">
                <table class="relay-email-footer-lock" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fafafa" style="border-collapse:collapse; background:#fafafa; background-color:#fafafa; background-image:linear-gradient(#fafafa,#fafafa);">
                  <tr>
                    <td align="left" valign="middle" style="padding:14px 36px;">${footerLogoMarkup}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildImagePart(image: InlineImage): string {
  return [
    `Content-Type: ${image.mimeType}; name="${image.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${image.cid}>`,
    `Content-Disposition: inline; filename="${image.filename}"`,
    '',
    wrapBase64(image.base64),
  ].join('\r\n');
}

export function buildAlertEml(input: AlertEmlInput): string {
  const images: InlineImage[] = [];
  const logo = createInlineImage(input.logoDataUrl, 'relay-logo-1', 'relay-logo');
  if (logo) images.push(logo);
  const footerLogo = createInlineImage(
    input.footerLogoDataUrl,
    'relay-footer-logo-1',
    'relay-footer-logo',
  );
  if (footerLogo) images.push(footerLogo);

  const html = buildHtml(input, images);
  const boundary = `----=_Relay_Alert_${Date.now().toString(36)}`;
  const subject = `${SEVERITY_COLORS[input.severity].subjectPrefix} - ${cleanHeader(input.displaySubject) || 'Alert'}`;

  const headers = [
    `From: ${cleanHeader(input.displaySender) || 'Relay'} <relay@example.invalid>`,
    `To: ${cleanHeader(input.displayRecipient) || 'All Employees'} <relay-recipients@example.invalid>`,
    `Subject: ${subject}`,
    `Date: ${(input.generatedAt ?? new Date()).toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
  ];

  const parts = [
    [
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(encodeBase64Utf8(html)),
    ].join('\r\n'),
    ...images.map(buildImagePart),
  ];
  const mimeBody = parts.map((part) => `--${boundary}\r\n${part}`).join('\r\n');

  return `${headers.join('\r\n')}\r\n\r\n${mimeBody}\r\n--${boundary}--\r\n`;
}
