/**
 * Guide blocks are fixed markup inside an alert body, identified by `data-relay-block`. This
 * module owns their shapes, so the editor, templates, sanitizer and email builder agree on them.
 * It imports nothing from the alert utilities, which depend on it.
 */

export type AlertBlockKind = 'step' | 'callout' | 'divider' | 'button';
export type AlertCalloutTone = 'note' | 'warning' | 'success';

export const ALERT_CALLOUT_TONES: readonly AlertCalloutTone[] = ['note', 'warning', 'success'];
export const ALERT_BUTTON_LABEL_MAX_LENGTH = 60;

/** Solid colors, so classic Outlook renders callouts the same as the preview's light theme. */
export const ALERT_TONE_COLORS: Record<
  AlertCalloutTone,
  { background: string; rule: string; text: string }
> = {
  note: { background: '#F1F3F5', rule: '#6B7280', text: '#1F2937' },
  warning: { background: '#FFF4E5', rule: '#B45309', text: '#1F2937' },
  success: { background: '#ECFDF3', rule: '#15803D', text: '#1F2937' },
};

const EMPTY_PARAGRAPH = '<p><br></p>';

export function sanitizeHttpHref(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isAlertCalloutTone(value: string | undefined): value is AlertCalloutTone {
  return (ALERT_CALLOUT_TONES as readonly string[]).includes(value ?? '');
}

/** The label problem a button would have, or null when it is usable. */
export function buttonLabelError(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return 'Enter a button label.';
  if (trimmed.length > ALERT_BUTTON_LABEL_MAX_LENGTH) return 'Use 60 characters or fewer.';
  return null;
}

function escapeText(text: string): string {
  const holder = document.createElement('span');
  holder.textContent = text;
  return holder.innerHTML;
}

export function stepBlockHtml(title = '', bodyHtml = EMPTY_PARAGRAPH): string {
  return `<div data-relay-block="step"><h3>${escapeText(title)}</h3>${bodyHtml}</div>`;
}

export function calloutBlockHtml(tone: AlertCalloutTone, bodyHtml = EMPTY_PARAGRAPH): string {
  return `<div data-relay-block="callout" data-tone="${tone}">${bodyHtml}</div>`;
}

export function dividerBlockHtml(): string {
  return '<hr data-relay-block="divider">';
}

export function buttonBlockHtml(href: string, label: string): string {
  const safeHref = sanitizeHttpHref(href.trim());
  if (!safeHref) throw new Error('Button links must be http or https.');
  const labelError = buttonLabelError(label);
  if (labelError) throw new Error(labelError);
  const anchor = document.createElement('a');
  anchor.setAttribute('href', safeHref);
  anchor.textContent = label.trim();
  return `<p data-relay-block="button">${anchor.outerHTML}</p>`;
}

const BLOCK_TAGS: Record<AlertBlockKind, string> = {
  step: 'div',
  callout: 'div',
  divider: 'hr',
  button: 'p',
};

/** The block an element is, judged by its marker and the tag that marker belongs on. */
export function alertBlockKind(element: Element): AlertBlockKind | null {
  const kind = element.getAttribute('data-relay-block') as AlertBlockKind | null;
  if (!kind || !(kind in BLOCK_TAGS)) return null;
  return element.tagName.toLowerCase() === BLOCK_TAGS[kind] ? kind : null;
}

/**
 * Clipboard flavor the editor writes beside text/html on copy and cut. Only a paste carrying it
 * keeps blocks; Outlook, browsers and Office never write it.
 */
export const RELAY_BLOCKS_CLIPBOARD_TYPE = 'application/x-relay-alert-blocks';

/** The same HTML with every block and tone marker removed, so blocks become ordinary content. */
export function stripBlockMarkers(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('[data-relay-block], [data-tone]')) {
    element.removeAttribute('data-relay-block');
    element.removeAttribute('data-tone');
  }
  return template.innerHTML;
}
