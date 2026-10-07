import { formatMessageTime } from '../../utils/opsTime';

/** Containers mail clients wrap around the earlier messages a reply quotes. */
const QUOTE_CONTAINERS = [
  '.gmail_quote',
  '.gmail_quote_container',
  'blockquote[type="cite"]',
  '#divRplyFwdMsg',
  '#appendonsend',
  '.moz-cite-prefix',
  '.yahoo_quoted',
  '#mail-editor-reference-message-container',
].join(',');
/** Outlook desktop and plain-text replies start the quoted mail with a header block. */
const QUOTE_HEADER = /^(?:-{2,} ?Original Message ?-{2,}|From: [\s\S]{0,400}?(?:Sent|Date): )/i;
const INERT = 'script,style,iframe,object,embed,svg,math,link,meta,title';

/** The upload ID of an image SDP stored from an incoming email, from its image link. */
export function sdpStoredImagePath(src: string): string | undefined {
  try {
    const url = new URL(src, 'https://support.campingworld.com');
    const path = url.searchParams.get('path') ?? '';
    return url.origin === 'https://support.campingworld.com' &&
      url.pathname === '/app/itdesk/servlet/SDODAuthServlet' &&
      url.searchParams.get('ACTION') === 'FILE' &&
      /^\d{1,30}$/.test(path)
      ? path
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseEmail(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll(INERT).forEach((node) => node.remove());
  return template.content;
}

const textOf = (node: Node) => (node.textContent ?? '').replaceAll(/\s+/g, ' ').trim();

function earliest(a: Element | undefined, b: Element | undefined): Element | undefined {
  if (!a || !b) return a ?? b;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? a : b;
}

function hasContentBefore(root: DocumentFragment, stop: Node): boolean {
  const walker = (root.ownerDocument ?? document).createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node && node !== stop; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE ? textOf(node) : (node as Element).tagName === 'IMG')
      return true;
  }
  return false;
}

/**
 * The nodes holding earlier mail that a reply quotes. Nothing is returned when the message has no
 * new content before the quote, so a forwarded or quote-only message still shows in full.
 */
export function quotedNodes(root: DocumentFragment): Set<Node> | undefined {
  const header = Array.from(root.querySelectorAll('p,div,blockquote')).find((element) =>
    QUOTE_HEADER.test(textOf(element)),
  );
  let start = earliest(root.querySelector(QUOTE_CONTAINERS) ?? undefined, header);
  // Outlook on the web draws a rule before its reply header.
  while (start?.previousElementSibling?.matches('hr,#appendonsend'))
    start = start.previousElementSibling;
  if (!start || !hasContentBefore(root, start)) return undefined;
  const quoted = new Set<Node>([start]);
  for (let node: Node = start; node !== root && node.parentNode; node = node.parentNode)
    for (let next = node.nextSibling; next; next = next.nextSibling) quoted.add(next);
  return quoted;
}

/** The message as plain text without the earlier mail it quotes, for previews and reply quotes. */
export function emailText(html: string): string {
  const root = parseEmail(html);
  quotedNodes(root)?.forEach((node) => node.parentNode?.removeChild(node));
  root.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  root.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach((node) => node.append('\n'));
  return (root.textContent ?? '')
    .replaceAll('\u00a0', ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/** An Outlook-style quote of one message for a reply draft, leaving room for the reply itself. */
export function replyQuote(message: {
  author: string;
  createdAt: number | null;
  subject?: string;
  body: string;
}): string {
  const header = [
    '-----Original Message-----',
    `From: ${message.author}`,
    message.createdAt === null ? '' : `Sent: ${formatMessageTime(message.createdAt)}`,
    message.subject ? `Subject: ${message.subject}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n\n${emailText(message.body)}`.slice(0, 8000);
}
