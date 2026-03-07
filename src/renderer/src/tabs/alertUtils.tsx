import React from 'react';

export type Severity = 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';

export const SEVERITIES: Severity[] = ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'];

export const SEVERITY_COLORS: Record<
  Severity,
  { banner: string; bannerEnd: string; badgeBg: string; badgeText: string }
> = {
  ISSUE: { banner: '#d32f2f', bannerEnd: '#b71c1c', badgeBg: '#ffebee', badgeText: '#c62828' },
  MAINTENANCE: {
    banner: '#f9a825',
    bannerEnd: '#f57f17',
    badgeBg: '#fffde7',
    badgeText: '#827717',
  },
  INFO: { banner: '#1565c0', bannerEnd: '#0d47a1', badgeBg: '#e3f2fd', badgeText: '#0d47a1' },
  RESOLVED: { banner: '#2e7d32', bannerEnd: '#1b5e20', badgeBg: '#e8f5e9', badgeText: '#1b5e20' },
};

export const SEVERITY_ICONS: Record<Severity, React.ReactNode> = {
  ISSUE: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="m21.73 18-8-14a2 2 0 00-3.48 0l-8 14A2 2 0 004 21h16a2 2 0 001.73-3"
        fill="#d32f2f"
      />
      <path d="M12 9v4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.2" fill="#fff" />
    </svg>
  ),
  MAINTENANCE: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
        fill="#f9a825"
      />
    </svg>
  ),
  INFO: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="#1565c0" />
      <circle cx="12" cy="8.5" r="1.2" fill="#fff" />
      <path d="M12 11v5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  RESOLVED: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
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

/** Strip all HTML tags except basic formatting (b, i, u, em, strong, br, p). */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = Array.from(el.childNodes).map(walk).join('');
    const allowed = ['b', 'i', 'u', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li'];
    if (allowed.includes(tag)) {
      if (tag === 'br') return '<br>';
      return `<${tag}>${children}</${tag}>`;
    }
    return children;
  };
  return Array.from(doc.body.childNodes).map(walk).join('');
}

/** Check if HTML has any visible text content. */
export function hasVisibleText(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').trim().length > 0;
}
