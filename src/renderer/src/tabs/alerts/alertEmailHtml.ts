import { escapeHtmlAttribute, sanitizeHtml, SEVERITY_COLORS, type Severity } from '../alertUtils';
import { EVENT_TIME_LABELS, formatEventTimeRange } from '../alertTimeUtils';
import { sanitizeAlertClickUrl } from '../alertLinks';
import { HIGHLIGHTS } from './highlightColors';
import {
  ALERT_TONE_COLORS,
  alertBlockKind,
  isAlertCalloutTone,
  type AlertBlockKind,
  type AlertCalloutTone,
} from './alertBlocks';

/*
 * Outlook renders email HTML with Word: no SVG, no positioning, no stylesheet classes, and only
 * table layout is reliable. This module rebuilds the alert card that way, from the same inputs as
 * the on-screen preview. Colors and sizes mirror the fenced email-card rules in
 * alerts-email-card.css and alerts-email-event.css (DESIGN.md §10).
 */

export type AlertInlineImage = { cid: string; dataUrl: string; fileName: string };

export type AlertEmailAssets = {
  /** PNG at 2× of the banner-to-body strip carrying the circled severity icon. */
  iconStripDataUrl: string;
  /** White-tinted header logo. */
  logoDataUrl?: string | null;
  /** Grayscale footer logo. */
  footerLogoDataUrl?: string | null;
  /** PNG tone icons for callouts; a callout whose tone has none renders without an icon. */
  toneIcons?: Partial<Record<AlertCalloutTone, string>>;
};

export type AlertEmailHtmlInput = {
  severity: Severity;
  /** The card heading as the preview shows it, including any "UPDATE #n —" prefix. */
  subject: string;
  updateNumber?: number;
  eventTimeStart?: string;
  eventTimeEnd?: string;
  sender: string;
  recipient: string;
  bodyHtml: string;
  clickHref?: string;
  assets: AlertEmailAssets;
};

const CARD_WIDTH = 640;
const BODY_IMAGE_MAX_WIDTH = 516;
/** Shown height of the icon strip; the strip image is twice this. */
export const ALERT_ICON_STRIP_HEIGHT = 56;
const FONT = "'IBM Plex Sans','Segoe UI',Arial,sans-serif";
const MONO = "'JetBrains Mono',Consolas,'Courier New',monospace";

const EVENT_ICONS: Record<Severity, string> = {
  MAINTENANCE: '📅',
  ISSUE: '⏰',
  INFO: '📌',
  RESOLVED: '✅',
};

const escape = escapeHtmlAttribute;

/** Solid equivalent of white at `alpha` over `hex`; Outlook's Word renderer ignores rgba(). */
function whiteOver(hex: string, alpha: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * alpha)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const match = /^data:image\/[a-z]+;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    return Uint8Array.from(atob(match[1]!.slice(0, 64 * 1024)), (char) => char.codePointAt(0)!);
  } catch {
    return null;
  }
}

/** Natural size of a PNG, JPEG or GIF data URL, read from its header; null when unreadable. */
export function readImageSize(dataUrl: string): { width: number; height: number } | null {
  const bytes = dataUrlBytes(dataUrl);
  if (!bytes || bytes.length < 24) return null;
  const u16 = (offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
  const u32 = (offset: number) => u16(offset) * 65536 + u16(offset + 2);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: u32(16), height: u32(20) };
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      const length = u16(offset + 2);
      const isStartOfFrame =
        marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) return { width: u16(offset + 7), height: u16(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

function imageSizeAttributes(dataUrl: string, maxWidth: number, maxHeight?: number): string {
  const size = readImageSize(dataUrl);
  if (!size || size.width <= 0 || size.height <= 0) return `width="${maxWidth}"`;
  let scale = Math.min(1, maxWidth / size.width);
  if (maxHeight) scale = Math.min(scale, maxHeight / size.height);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  return `width="${width}" height="${height}"`;
}

function fileExtension(dataUrl: string): string {
  const mime = /^data:(image\/[a-z]+);/i.exec(dataUrl)?.[1]?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS[mime] ?? 'png';
}

const HIGHLIGHT_STYLES: Record<string, string> = Object.fromEntries(
  HIGHLIGHTS.map((highlight) => {
    const pill = `background:${highlight.bg};padding:1px 5px;font-weight:600;color:${highlight.text};`;
    if (highlight.type === 'number')
      return [highlight.type, `font-weight:700;color:${highlight.text};`];
    if (highlight.type === 'service') {
      return [
        highlight.type,
        `font-family:${MONO};font-size:0.9em;background:${highlight.bg};padding:1px 6px;color:${highlight.text};`,
      ];
    }
    return [highlight.type, pill];
  }),
);

const STYLE = {
  p: 'margin:0 0 12px;',
  h2: `margin:22px 0 6px;font-family:${FONT};font-size:17px;font-weight:700;line-height:1.35;color:#1a1a2e;`,
  list: 'margin:8px 0;padding-left:24px;',
  li: 'margin:4px 0;',
  link: 'color:#1565c0;text-decoration:underline;',
  figure: 'margin:17px 0 18px;',
  image: 'display:block;border:1px solid #d7d7dc;background:#ffffff;max-width:100%;',
  caption: 'margin:6px 0 0;font-size:12.5px;line-height:1.5;color:#5f6368;',
  stepTitle: `margin:3px 0 6px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.4;color:#1a1a2e;`,
};

const TONE_LABELS: Record<AlertCalloutTone, string> = {
  note: 'Note',
  warning: 'Warning',
  success: 'Expected result',
};

const TABLE = 'role="presentation" border="0" cellpadding="0" cellspacing="0"';
/** Card rule colour (DESIGN.md §10), shared by the divider. */
const RULE_COLOR = '#eaeaea';

function parseBody(bodyHtml: string): Document {
  return new DOMParser().parseFromString(sanitizeHtml(bodyHtml), 'text/html');
}

/** Each callout tone the body uses, once, in document order. */
export function alertCalloutTonesIn(bodyHtml: string): AlertCalloutTone[] {
  const tones = new Set<AlertCalloutTone>();
  for (const callout of parseBody(bodyHtml).querySelectorAll('[data-relay-block="callout"]')) {
    const tone = callout.getAttribute('data-tone') ?? undefined;
    if (isAlertCalloutTone(tone)) tones.add(tone);
  }
  return [...tones];
}

function calloutTone(element: Element): AlertCalloutTone {
  const tone = element.getAttribute('data-tone') ?? undefined;
  return isAlertCalloutTone(tone) ? tone : 'note';
}

function renderStepTable(accent: string, number: number, contentHtml: string): string {
  const circle = `<table ${TABLE} style="border-collapse:collapse;"><tr><td width="28" height="28" align="center" valign="middle" bgcolor="${accent}" style="width:28px;height:28px;background:${accent};border-radius:14px;color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;line-height:28px;">${number}</td></tr></table>`;
  return `<table ${TABLE} width="100%" style="border-collapse:collapse;margin:0 0 16px;"><tr><td width="44" valign="top" style="width:44px;padding:0 16px 0 0;">${circle}</td><td valign="top">${contentHtml}</td></tr></table>`;
}

function renderCalloutTable(
  tone: AlertCalloutTone,
  iconCid: string | null,
  contentHtml: string,
): string {
  const colors = ALERT_TONE_COLORS[tone];
  const icon = iconCid
    ? `<td width="30" valign="top" style="width:30px;padding:3px 10px 0 0;"><img src="cid:${iconCid}" width="20" height="20" alt="${TONE_LABELS[tone]}" border="0" style="display:block;border:0;"></td>`
    : '';
  return `<table ${TABLE} width="100%" style="border-collapse:collapse;margin:0 0 16px;"><tr><td bgcolor="${colors.background}" style="background:${colors.background};border-left:4px solid ${colors.rule};padding:12px 16px 0;color:${colors.text};"><table ${TABLE} width="100%" style="border-collapse:collapse;"><tr>${icon}<td valign="top">${contentHtml}</td></tr></table></td></tr></table>`;
}

function renderDividerTable(): string {
  return `<table ${TABLE} width="100%" style="border-collapse:collapse;margin:8px 0 20px;"><tr><td height="1" bgcolor="${RULE_COLOR}" style="height:1px;line-height:1px;font-size:0;background:${RULE_COLOR};">&nbsp;</td></tr></table>`;
}

function renderButtonTable(accent: string, link: Element | null): string {
  const href = escape(link?.getAttribute('href') ?? '');
  const label = escape(link?.textContent ?? '');
  return `<table ${TABLE} style="border-collapse:collapse;margin:4px 0 16px;"><tr><td align="center" bgcolor="${accent}" style="background:${accent};border-radius:6px;padding:12px 24px;"><a href="${href}" style="color:#ffffff;font-family:${FONT};font-size:14.5px;font-weight:700;text-decoration:none;">${label}</a></td></tr></table>`;
}

type BodyRender = { html: string; images: AlertInlineImage[]; tones: AlertCalloutTone[] };
type BodyRenderOptions = {
  accent: string;
  toneIcons: Partial<Record<AlertCalloutTone, string>>;
};

function renderBody(bodyHtml: string, options: BodyRenderOptions): BodyRender {
  const doc = parseBody(bodyHtml);
  const images: AlertInlineImage[] = [];
  const tones = new Set<AlertCalloutTone>();
  let stepNumber = 0;

  const renderImage = (image: Element): string => {
    const src = image.getAttribute('src') ?? '';
    const alt = escape(image.getAttribute('alt') ?? '');
    if (!src.startsWith('data:image/')) {
      return alt ? `<p style="${STYLE.p}"><em>[Image: ${alt}]</em></p>` : '';
    }
    const index = images.length;
    const cid = `relay-alert-body-${index}`;
    images.push({ cid, dataUrl: src, fileName: `image-${index}.${fileExtension(src)}` });
    return `<img src="cid:${cid}" ${imageSizeAttributes(src, BODY_IMAGE_MAX_WIDTH)} alt="${alt}" border="0" style="${STYLE.image}">`;
  };

  const renderChildren = (nodes: Iterable<Node>): string => Array.from(nodes).map(render).join('');

  const renderBlock = (kind: AlertBlockKind, element: Element): string => {
    switch (kind) {
      case 'step': {
        stepNumber += 1;
        const [title, ...rest] = Array.from(element.childNodes);
        const titleHtml = `<h3 style="${STYLE.stepTitle}">${renderChildren(title?.childNodes ?? [])}</h3>`;
        return renderStepTable(options.accent, stepNumber, titleHtml + renderChildren(rest));
      }
      case 'callout': {
        const tone = calloutTone(element);
        const hasIcon = Boolean(options.toneIcons[tone]);
        if (hasIcon) tones.add(tone);
        const iconCid = hasIcon ? `relay-alert-tone-${tone}` : null;
        return renderCalloutTable(tone, iconCid, renderChildren(element.childNodes));
      }
      case 'divider':
        return renderDividerTable();
      case 'button':
        return renderButtonTable(options.accent, element.querySelector('a'));
    }
  };

  function render(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const kind = alertBlockKind(element);
    if (kind) return renderBlock(kind, element);
    const tag = element.tagName.toLowerCase();
    if (tag === 'img') return renderImage(element);
    if (tag === 'figure') {
      const image = element.querySelector('img');
      const caption = element.querySelector('figcaption')?.textContent?.trim() ?? '';
      const captionHtml = caption ? `<p style="${STYLE.caption}">${escape(caption)}</p>` : '';
      return `<div style="${STYLE.figure}">${image ? renderImage(image) : ''}${captionHtml}</div>`;
    }
    const children = Array.from(element.childNodes).map(render).join('');
    switch (tag) {
      case 'br':
        return '<br>';
      case 'p':
        return `<p style="${STYLE.p}">${children}</p>`;
      case 'h2':
        return `<h2 style="${STYLE.h2}">${children}</h2>`;
      case 'ul':
      case 'ol':
        return `<${tag} style="${STYLE.list}">${children}</${tag}>`;
      case 'li':
        return `<li style="${STYLE.li}">${children}</li>`;
      case 'a':
        return `<a href="${escape(element.getAttribute('href') ?? '')}" style="${STYLE.link}">${children}</a>`;
      case 'span': {
        const style = HIGHLIGHT_STYLES[(element as HTMLElement).dataset.hl ?? ''];
        return style ? `<span style="${style}">${children}</span>` : children;
      }
      case 'b':
      case 'strong':
      case 'i':
      case 'em':
      case 'u':
      case 'div':
        return `<${tag}>${children}</${tag}>`;
      default:
        return children;
    }
  }

  return { html: renderChildren(doc.body.childNodes), images, tones: [...tones] };
}

/** Build the Outlook card HTML and the inline images its CID references point at. */
export function buildAlertEmailHtml(input: AlertEmailHtmlInput): {
  html: string;
  inlineImages: AlertInlineImage[];
} {
  const banner = SEVERITY_COLORS[input.severity].banner;
  const href = input.clickHref ? sanitizeAlertClickUrl(input.clickHref) : null;
  const { assets } = input;
  const inlineImages: AlertInlineImage[] = [
    { cid: 'relay-alert-icon', dataUrl: assets.iconStripDataUrl, fileName: 'relay-alert-icon.png' },
  ];

  let logoHtml = '';
  if (assets.logoDataUrl) {
    inlineImages.push({
      cid: 'relay-alert-logo',
      dataUrl: assets.logoDataUrl,
      fileName: 'relay-alert-logo.png',
    });
    logoHtml = `<img src="cid:relay-alert-logo" ${imageSizeAttributes(assets.logoDataUrl, 200, 36)} alt="" border="0" style="display:block;border:0;">`;
  }
  let footerLogoHtml = '&nbsp;';
  if (assets.footerLogoDataUrl) {
    inlineImages.push({
      cid: 'relay-alert-footer-logo',
      dataUrl: assets.footerLogoDataUrl,
      fileName: 'relay-alert-footer-logo.png',
    });
    footerLogoHtml = `<img src="cid:relay-alert-footer-logo" ${imageSizeAttributes(assets.footerLogoDataUrl, 120, 14)} alt="" border="0" style="display:block;border:0;">`;
  }

  const toneIcons = assets.toneIcons ?? {};
  const body = renderBody(input.bodyHtml, { accent: banner, toneIcons });
  inlineImages.push(...body.images);
  for (const tone of body.tones) {
    inlineImages.push({
      cid: `relay-alert-tone-${tone}`,
      dataUrl: toneIcons[tone]!,
      fileName: `relay-alert-tone-${tone}.png`,
    });
  }

  const subjectText = escape(input.subject.trim() || 'Relay Alert');
  const subjectHtml = href
    ? `<a href="${escape(href)}" style="color:#111118;text-decoration:none;">${subjectText}</a>`
    : subjectText;
  const eventRow = input.eventTimeStart
    ? `<tr><td align="center" bgcolor="#fff8e1" style="background:#fff8e1;border-bottom:1px solid #f0dca0;padding:9px 36px;font-family:${FONT};font-size:12.5px;">${EVENT_ICONS[input.severity]}&nbsp;&nbsp;<span style="font-weight:700;color:#856404;text-transform:uppercase;font-size:10.5px;letter-spacing:0.06em;">${escape(EVENT_TIME_LABELS[input.severity])}</span>&nbsp;&nbsp;<span style="color:#6d5200;font-family:${MONO};font-size:11.5px;">${escape(formatEventTimeRange(input.eventTimeStart, input.eventTimeEnd))}</span></td></tr>`
    : '';
  const metaValue = (value: string) =>
    `<span style="color:#222222;font-weight:600;text-transform:none;">${escape(value)}</span>`;
  const moreInformation = href
    ? `<p style="margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;"><a href="${escape(href)}" style="${STYLE.link}">More information</a></p>`
    : '';

  const html = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CARD_WIDTH}" style="width:${CARD_WIDTH}px;border-collapse:collapse;border-spacing:0;border:2px solid ${banner};border-bottom-width:5px;background:#ffffff;">
      <tr><td bgcolor="${banner}" style="background:${banner};padding:12px 36px 2px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>
          <td valign="middle" style="font-family:${FONT};line-height:1;"><div style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:${whiteOver(banner, 0.6)};text-transform:uppercase;margin-bottom:2px;">ALERT</div><div style="font-size:22px;font-weight:700;letter-spacing:0.1em;color:#ffffff;text-transform:uppercase;">${escape(input.severity)}</div></td>
          <td valign="middle" align="right">${logoHtml}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:0;line-height:0;font-size:0;"><img src="cid:relay-alert-icon" width="${CARD_WIDTH - 4}" height="${ALERT_ICON_STRIP_HEIGHT}" alt="" border="0" style="display:block;border:0;width:${CARD_WIDTH - 4}px;height:${ALERT_ICON_STRIP_HEIGHT}px;"></td></tr>
      <tr><td align="center" style="padding:10px 36px 22px;border-bottom:1px solid #eaeaea;font-family:${FONT};font-size:24px;font-weight:700;color:#111118;line-height:1.3;">${subjectHtml}</td></tr>
      ${eventRow}
      <tr><td align="center" bgcolor="#fafafa" style="background:#fafafa;border-bottom:1px solid #eaeaea;padding:14px 36px;font-family:${MONO};font-size:13px;color:#666666;letter-spacing:0.03em;text-transform:uppercase;">FROM ${metaValue(input.sender)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;TO ${metaValue(input.recipient)}</td></tr>
      <tr><td bgcolor="#f7f7f8" style="background:#f7f7f8;padding:28px 36px 36px;font-family:${FONT};font-size:14.5px;line-height:1.7;color:#2d2d2d;">${body.html}</td></tr>
      <tr><td bgcolor="#fafafa" style="background:#fafafa;border-top:1px solid #eaeaea;padding:14px 36px;">${footerLogoHtml}</td></tr>
    </table>
    ${moreInformation}
  </body>
</html>`;

  return { html, inlineImages };
}

/** Plain-text alternative: the same message as readable text, images named by caption. */
export function buildAlertEmailText(input: Omit<AlertEmailHtmlInput, 'assets'>): string {
  const doc = parseBody(input.bodyHtml);
  const imageLine = (image: Element | null, caption: string) =>
    `[Image: ${caption || image?.getAttribute('alt')?.trim() || 'Embedded alert image'}]\n\n`;
  let stepNumber = 0;
  const textOf = (nodes: Iterable<Node>) => Array.from(nodes).map(renderText).join('').trim();
  const renderBlockText = (kind: AlertBlockKind, element: Element): string => {
    switch (kind) {
      case 'step': {
        stepNumber += 1;
        const [title, ...rest] = Array.from(element.childNodes);
        const body = textOf(rest).replaceAll(/\n{3,}/g, '\n\n');
        const indented = body.replaceAll(/^(?=.)/gm, '   ');
        return `${stepNumber}. ${textOf(title?.childNodes ?? [])}\n${indented}\n\n`;
      }
      case 'callout':
        return `${TONE_LABELS[calloutTone(element)]}: ${textOf(element.childNodes)}\n\n`;
      case 'divider':
        return '----------\n\n';
      case 'button': {
        const link = element.querySelector('a');
        return `${link?.textContent?.trim() ?? ''}: ${link?.getAttribute('href') ?? ''}\n\n`;
      }
    }
  };
  function renderText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const kind = alertBlockKind(element);
    if (kind) return renderBlockText(kind, element);
    const tag = element.tagName.toLowerCase();
    if (tag === 'figure') {
      const caption = element.querySelector('figcaption')?.textContent?.trim() ?? '';
      return imageLine(element.querySelector('img'), caption);
    }
    if (tag === 'img') return imageLine(element, '');
    const children = Array.from(element.childNodes).map(renderText).join('');
    if (tag === 'br') return '\n';
    if (tag === 'li') return `• ${children.trim()}\n`;
    if (tag === 'a') return `${children.trim()} (${element.getAttribute('href') ?? ''})`;
    if (['p', 'ul', 'ol', 'h2'].includes(tag)) return `${children.trim()}\n\n`;
    return children;
  }
  const body = renderText(doc.body)
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
  const href = input.clickHref ? sanitizeAlertClickUrl(input.clickHref) : null;
  const eventTime = input.eventTimeStart
    ? `${EVENT_TIME_LABELS[input.severity]}: ${formatEventTimeRange(input.eventTimeStart, input.eventTimeEnd)}`
    : null;
  const text = (value: string, fallback: string) =>
    value.replaceAll(/\r\n?/g, '\n').trim() || fallback;
  return [
    `ALERT ${input.severity}`,
    input.updateNumber && input.updateNumber > 0
      ? `UPDATE #${Math.floor(input.updateNumber)}`
      : null,
    text(input.subject, 'Relay Alert'),
    eventTime,
    `FROM: ${text(input.sender, 'IT')}`,
    `TO: ${text(input.recipient, 'All Employees')}`,
    body || 'No additional message was provided.',
    href ? `More information: ${href}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}
