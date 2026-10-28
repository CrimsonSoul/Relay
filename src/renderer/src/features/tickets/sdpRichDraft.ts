import { sdpRichEscape } from '@shared/sdpRichText';
import { formatMessageTime } from '../../utils/opsTime';
import { parseEmail, quotedNodes } from './sdpEmailThread';

/** A reply body is reply markup; the quoted message must leave room for the reply itself. */
export const SDP_REPLY_MAX = 12000;
const QUOTE_MAX = 9000;

const BLOCKS = new Set([
  'address',
  'article',
  'blockquote',
  'center',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'ul',
]);
const SKIPPED = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'img']);
const SAFE_HREF = /^(?:https?:\/\/|mailto:)[^\s()<>"'\\]+$/i;

const escapeText = (text: string) => text.replaceAll(/[\\*_[\]]/g, String.raw`\$&`);
/** A plain line that would read as a bullet, quote or numbered item keeps its first character. */
const escapeLineStart = (line: string) =>
  line.replace(/^(?:- |>(?: |$))/, String.raw`\$&`).replace(/^(\d{1,9})\. /, String.raw`$1\. `);
/** Wraps each line of `text` in `mark`, so a mark never spans a line break. */
const wrapLines = (text: string, mark: string) =>
  text
    .split('\n')
    .map((part) => (part.trim() ? `${mark}${part}${mark}` : part))
    .join('\n');

function inlineMarkup(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeText((node.textContent ?? '').replaceAll(/[\s\u00a0]+/g, ' '));
  if (!(node instanceof Element)) return '';
  const tag = node.tagName.toLowerCase();
  if (SKIPPED.has(tag)) return '';
  if (tag === 'br') return '\n';
  const inner = [...node.childNodes].map(inlineMarkup).join('');
  if (!inner.trim()) return inner;
  const weight = (node as HTMLElement).style?.fontWeight;
  if (tag === 'b' || tag === 'strong' || weight === 'bold' || Number(weight) >= 600)
    return wrapLines(inner, '**');
  if (tag === 'i' || tag === 'em') return wrapLines(inner, '*');
  if (tag === 'u') return wrapLines(inner, '__');
  if (tag === 'a') {
    const href = node.getAttribute('href') ?? '';
    if (SAFE_HREF.test(href) && !inner.includes('\n')) return `[${inner}](${href})`;
  }
  return inner;
}

/** A list's items as bullet or numbered lines. */
function listLines(list: Element): string[] {
  const numbered = list.tagName.toLowerCase() === 'ol';
  return [...list.children]
    .filter((item) => item.tagName.toLowerCase() === 'li')
    .map((item, index) => {
      const marker = numbered ? String(index + 1) + '. ' : '- ';
      return marker + blockLines(item).filter(Boolean).join(' ');
    });
}
/** One block element's lines of markup. */
function elementLines(element: Element): string[] {
  const tag = element.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') return listLines(element);
  if (tag === 'blockquote') return blockLines(element).map((line) => (line ? `> ${line}` : '>'));
  if (tag === 'hr') return [''];
  if (tag === 'tr') {
    const cells = [...element.children].map((cell) => blockLines(cell).filter(Boolean).join(' '));
    return [escapeLineStart(cells.filter(Boolean).join(' '))];
  }
  const inner = blockLines(element);
  if (!inner.length) return [''];
  return /^h[1-6]$/.test(tag) ? inner.map((l) => (l ? `**${l}**` : l)) : inner;
}
/** Inline text as lines; a <br> that ends a block shows no empty line, so it is dropped. */
function textLines(text: string): string[] {
  const kept = text.endsWith('\n') ? text.slice(0, -1) : text;
  return kept.split('\n').map((l) => escapeLineStart(l.trim()));
}

/** The node's content as lines of reply markup; blocks start new lines and keep their markers. */
function blockLines(parent: Node): string[] {
  const lines: string[] = [];
  let current: string | null = null;
  for (const child of parent.childNodes) {
    if (child instanceof Element && SKIPPED.has(child.tagName.toLowerCase())) continue;
    if (child instanceof Element && BLOCKS.has(child.tagName.toLowerCase())) {
      if (current !== null) lines.push(...textLines(current));
      current = null;
      lines.push(...elementLines(child));
      continue;
    }
    const text = inlineMarkup(child);
    // Whitespace between blocks (as in email HTML) is layout, not a line.
    if (current !== null || text.trim() || text.includes('\n')) current = (current ?? '') + text;
  }
  if (current !== null) lines.push(...textLines(current));
  return lines;
}

/** The editor's content as reply markup, line for line as the person sees it. */
export function richMarkupFromNode(root: Node): string {
  const lines = blockLines(root);
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join('\n');
}

/**
 * A message's HTML (an SDP email or description) as reply markup, keeping its paragraphs, lists,
 * links and emphasis; layout whitespace and runs of blank lines are folded.
 */
export function richMarkupFromHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  return foldedMarkup(template.content);
}
function foldedMarkup(root: Node): string {
  return blockLines(root)
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A reply that starts with an empty line to write on, above the quoted message: its header, then
 * its own text without the earlier mail it quotes, all quoted. A long message is cut at a line
 * so the reply fits.
 */
export function replyQuoteMarkup(message: {
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
    .map(sdpRichEscape);
  const body = parseEmail(message.body);
  quotedNodes(body)?.forEach((node) => (node as ChildNode).remove());
  const quoted = [...header, '', ...foldedMarkup(body).split('\n')].map((line) =>
    line ? `> ${line}` : '>',
  );
  let kept = '';
  for (const line of quoted) {
    if (kept.length + line.length + 1 > QUOTE_MAX) {
      kept += '\n> …';
      break;
    }
    kept += `${kept ? '\n' : ''}${line}`;
  }
  return `\n\n${kept}`;
}
