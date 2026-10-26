import React from 'react';
import { HIGHLIGHT_TYPES } from './alerts/highlightColors';
import {
  ALERT_BUTTON_LABEL_MAX_LENGTH,
  alertBlockKind,
  elementDataset,
  isAlertCalloutTone,
  sanitizeHttpHref,
} from './alerts/alertBlocks';

export type Severity = 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';

export const SEVERITIES: Severity[] = ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'];

/** Audience the card and email use when the operator leaves "To" empty. */
export const DEFAULT_ALERT_RECIPIENT = 'All Employees';

export const SEVERITY_COLORS: Record<
  Severity,
  { banner: string; badgeBg: string; badgeText: string }
> = {
  ISSUE: { banner: '#d32f2f', badgeBg: '#ffebee', badgeText: '#c62828' },
  MAINTENANCE: {
    banner: '#f9a825',
    badgeBg: '#fffde7',
    badgeText: '#827717',
  },
  INFO: { banner: '#1565c0', badgeBg: '#e3f2fd', badgeText: '#0d47a1' },
  RESOLVED: { banner: '#2e7d32', badgeBg: '#e8f5e9', badgeText: '#1b5e20' },
};

/** Neutral grey card palette while no severity is confirmed: never a severity hue such as INFO blue. */
export const UNCONFIRMED_SEVERITY_COLORS = {
  banner: '#5f6368',
  badgeBg: '#f1f3f4',
  badgeText: '#3c4043',
} as const;

/** Card header label while no severity is confirmed. */
export const UNCONFIRMED_SEVERITY_LABEL = 'Choose severity';

export const SEVERITY_ICONS: Record<Severity, React.ReactNode> = {
  ISSUE: (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="m21.73 18-8-14a2 2 0 00-3.48 0l-8 14A2 2 0 004 21h16a2 2 0 001.73-3"
        fill="#d32f2f"
      />
      <path d="M12 9v4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.2" fill="#fff" />
    </svg>
  ),
  MAINTENANCE: (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
        fill="#f9a825"
      />
    </svg>
  ),
  INFO: (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#1565c0" />
      <circle cx="12" cy="8.5" r="1.2" fill="#fff" />
      <path d="M12 11v5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  RESOLVED: (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#2e7d32" />
      <path
        d="M8 12l3 3 5-5"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

/** Escape characters that are meaningful in HTML so text stays as text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Also escapes `'`, so the value is safe in either attribute quoting style. */
export function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text).replaceAll("'", '&#39;');
}

// Large enough for anything the insert pipeline produces (516px-wide images),
// small enough to reject multi-megabyte screenshots pasted as raw data URLs,
// which would bypass the size/width caps of the insert pipeline entirely.
const MAX_DATA_IMAGE_SRC_LENGTH = 1_500_000;

function isAllowedDataImage(src: string): boolean {
  return (
    src.length <= MAX_DATA_IMAGE_SRC_LENGTH &&
    /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)
  );
}

function renderDataImage(el: Element): string | null {
  const src = el.getAttribute('src')?.trim() ?? '';
  if (!isAllowedDataImage(src)) return null;
  const alt = el.getAttribute('alt')?.trim() ?? '';
  const className = el.classList.contains('alert-body-image') ? ' class="alert-body-image"' : '';
  return `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}"${className}>`;
}

/**
 * A saved guide keeps its images as alert_history files and references each one by its index in
 * the record's `images` list. The reference wins over any `src`, which is never trusted here.
 */
function renderStoredImageReference(el: Element): string | null {
  const index = (el as HTMLElement).dataset.relayImage;
  if (index === undefined) return null;
  if (!/^\d{1,2}$/.test(index)) return '';
  const alt = el.getAttribute('alt')?.trim() ?? '';
  return `<img data-relay-image="${index}" alt="${escapeHtmlAttribute(alt)}">`;
}

/** Where the walker is: guide blocks live only at the top level, and some content is narrowed. */
type SanitizeContext = { topLevel: boolean; within: 'body' | 'step' | 'callout' | 'nested' };

const ALLOWED_TAGS = new Set([
  'b',
  'i',
  'u',
  'em',
  'strong',
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'figcaption',
]);
const INNER: SanitizeContext = { topLevel: false, within: 'nested' };

function sanitizeChildren(el: Element, context: SanitizeContext): string {
  return Array.from(el.childNodes)
    .map((child) => sanitizeNode(child, context))
    .join('');
}

/** A heading where blocks don't allow one keeps its words as a bold paragraph. */
function boldParagraph(el: Element, context: SanitizeContext): string {
  return `<p><strong>${sanitizeChildren(el, context)}</strong></p>`;
}

/** A step always starts with its `h3` title, empty when the source had none. */
function sanitizeStep(el: Element): string {
  const context: SanitizeContext = { topLevel: false, within: 'step' };
  const children = Array.from(el.childNodes).filter(
    (child, index) => index > 0 || child.nodeType !== Node.TEXT_NODE || child.textContent?.trim(),
  );
  const [first] = children;
  const hasTitle = first instanceof Element && first.tagName.toLowerCase() === 'h3';
  const title = hasTitle ? `<h3>${sanitizeChildren(first, context)}</h3>` : '<h3></h3>';
  const body = children
    .slice(hasTitle ? 1 : 0)
    .map((child) => sanitizeNode(child, context))
    .join('');
  return `<div data-relay-block="step">${title}${body}</div>`;
}

function sanitizeCallout(el: Element): string {
  const tone = elementDataset(el)?.tone;
  const body = sanitizeChildren(el, { topLevel: false, within: 'callout' });
  return `<div data-relay-block="callout" data-tone="${isAlertCalloutTone(tone) ? tone : 'note'}">${body}</div>`;
}

/** A button is one HTTP(S) link with a short plain label; anything less keeps only its words. */
function sanitizeButton(el: Element): string {
  const label = el.textContent?.trim() ?? '';
  if (!label) return '';
  const href = sanitizeHttpHref(el.querySelector('a')?.getAttribute('href')?.trim() ?? '');
  if (!href || label.length > ALERT_BUTTON_LABEL_MAX_LENGTH) return `<p>${escapeHtml(label)}</p>`;
  return `<p data-relay-block="button"><a href="${escapeHtmlAttribute(href)}">${escapeHtml(label)}</a></p>`;
}

function sanitizeBlock(el: Element, context: SanitizeContext): string | null {
  const kind = alertBlockKind(el);
  if (!kind) return null;
  // A block anywhere but the top level is unwrapped to its content.
  if (!context.topLevel) return kind === 'divider' ? '' : sanitizeChildren(el, context);
  if (kind === 'step') return sanitizeStep(el);
  if (kind === 'callout') return sanitizeCallout(el);
  if (kind === 'button') return sanitizeButton(el);
  return '<hr data-relay-block="divider">';
}

/** A block's limits hold at every depth, so an image wrapped in a callout paragraph is still dropped. */
function childContext(context: SanitizeContext): { narrowed: boolean; inner: SanitizeContext } {
  const narrowed = context.within === 'step' || context.within === 'callout';
  return { narrowed, inner: narrowed ? { topLevel: false, within: context.within } : INNER };
}

function sanitizeElement(el: Element, context: SanitizeContext): string {
  const tag = el.tagName.toLowerCase();
  const { narrowed, inner } = childContext(context);
  if (tag === 'br') return '<br>';
  if (tag === 'h3' || (tag === 'h2' && narrowed)) return boldParagraph(el, inner);
  if (context.within === 'callout' && (tag === 'figure' || tag === 'img')) return '';
  const children = sanitizeChildren(el, inner);
  if (ALLOWED_TAGS.has(tag) || tag === 'h2') return `<${tag}>${children}</${tag}>`;
  if (tag === 'figure') return `<figure class="alert-body-figure">${children}</figure>`;
  // Allow <span data-hl="knownType"> for highlight support
  if (tag === 'span') {
    const hlType = (el as HTMLElement).dataset.hl;
    if (hlType && (HIGHLIGHT_TYPES as readonly string[]).includes(hlType)) {
      return `<span data-hl="${escapeHtml(hlType)}">${children}</span>`;
    }
  }
  if (tag === 'a') {
    const href = sanitizeHttpHref(el.getAttribute('href')?.trim() ?? '');
    if (href) return `<a href="${escapeHtmlAttribute(href)}">${children}</a>`;
  }
  if (tag === 'img') {
    return renderStoredImageReference(el) ?? renderDataImage(el) ?? '';
  }
  return children;
}

function sanitizeNode(node: Node | undefined, context: SanitizeContext): string {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  return sanitizeBlock(el, context) ?? sanitizeElement(el, context);
}

/**
 * Strip unsafe HTML while keeping alert formatting, guide headings, captioned figures, guide
 * blocks, HTTP(S) links, highlights, inline data images, and stored image references.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const context: SanitizeContext = { topLevel: true, within: 'body' };
  return Array.from(doc.body.childNodes)
    .map((child) => sanitizeNode(child, context))
    .join('');
}

/**
 * Sanitized body HTML for the preview and the email. The editor keeps an empty line after each
 * image so there is somewhere to type; the reader should not see it as a gap.
 */
export function renderableAlertBodyHtml(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeHtml(html), 'text/html');
  for (const line of doc.body.querySelectorAll('figure + p')) {
    if (!line.textContent?.trim() && !line.querySelector('img')) line.remove();
  }
  return doc.body.innerHTML;
}

/** Check if HTML has any visible text content. */
export function hasVisibleText(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const visibleText = (doc.body.textContent ?? '')
    .replaceAll('\u200b', '')
    .replaceAll('\u200c', '')
    .replaceAll('\u200d', '')
    .replaceAll('\ufeff', '')
    .replaceAll('\u2060', '');
  return visibleText.trim().length > 0;
}

export type AlertMessageField = 'subject' | 'body';

/** Required message fields still empty, in form order. Body counts only visible text. */
export function missingAlertMessageFields(subject: string, bodyHtml: string): AlertMessageField[] {
  const missing: AlertMessageField[] = [];
  if (subject.trim().length === 0) missing.push('subject');
  if (!hasVisibleText(bodyHtml)) missing.push('body');
  return missing;
}

/** Fields an export needs: a deliberate severity choice plus the required message fields. */
export type AlertExportField = 'severity' | AlertMessageField;

/** Export prerequisites still missing, in form order. INFO is only a default until chosen. */
export function missingAlertExportFields(
  severityConfirmed: boolean,
  subject: string,
  bodyHtml: string,
): AlertExportField[] {
  const missing: AlertExportField[] = severityConfirmed ? [] : ['severity'];
  return [...missing, ...missingAlertMessageFields(subject, bodyHtml)];
}

const ALERT_FIELD_NAMES: Record<AlertExportField, string> = {
  severity: 'severity',
  subject: 'subject',
  body: 'message body',
};

/** "subject", "subject and message body", or "severity, subject and message body". */
export function describeMissingAlertFields(missing: readonly AlertExportField[]): string {
  const names = missing.map((field) => ALERT_FIELD_NAMES[field]);
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A required alert message is complete only when subject and visible body text are present. */
export function isAlertMessageComplete(subject: string, bodyHtml: string): boolean {
  return missingAlertMessageFields(subject, bodyHtml).length === 0;
}
