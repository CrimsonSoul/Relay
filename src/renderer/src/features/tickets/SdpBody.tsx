import { createElement, Fragment, useMemo, useState, type ReactElement } from 'react';
import { TactileButton } from '../../components/TactileButton';
import { SdpInlineImage } from './SdpInlineImage';
import { parseEmail, quotedNodes, sdpStoredImagePath } from './sdpEmailThread';

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const size = (value: string | null): number | undefined => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2000 ? number : undefined;
};
/**
 * Raster images embedded in the email and the images SDP stored from it show at their sent size;
 * no remote image ever loads.
 */
function bodyImage(node: Element, key: string, ticketId?: string): ReactElement {
  const src = node.getAttribute('src') ?? '';
  const alt = (node.getAttribute('alt') ?? '').trim().slice(0, 200);
  const width = size(node.getAttribute('width'));
  const height = size(node.getAttribute('height'));
  if (src.length <= 4_000_000 && DATA_IMAGE.test(src))
    return (
      <img key={key} className="sdp-live-image" src={src} alt={alt} width={width} height={height} />
    );
  const path = ticketId && sdpStoredImagePath(src);
  if (ticketId && path)
    return (
      <SdpInlineImage
        key={`${key}:${path}`}
        ticketId={ticketId}
        path={path}
        alt={alt}
        width={width}
        height={height}
      />
    );
  return <span key={key}>[Image omitted]</span>;
}
/** Email layout tables draw no lines; a table the sender gave a border keeps cell lines. */
function cellProps(node: Element, key: string): Record<string, unknown> {
  const tag = node.tagName;
  const span = (name: string) => {
    const value = Number(node.getAttribute(name));
    return Number.isInteger(value) && value > 1 && value <= 50 ? value : undefined;
  };
  if (tag === 'TABLE')
    return {
      key,
      className: Number(node.getAttribute('border')) > 0 ? 'sdp-live-grid' : undefined,
    };
  if (tag === 'TD' || tag === 'TH')
    return { key, colSpan: span('colspan'), rowSpan: span('rowspan') };
  return { key };
}
const ALLOWED = new Set([
  'p',
  'div',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'pre',
  'code',
]);
const TABLE_PARTS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);
/** Rebuilds an explicit formatting allowlist with no source attributes; `hidden` nodes are skipped. */
function renderNodes(root: DocumentFragment, ticketId?: string, hidden?: Set<Node>) {
  const render = (node: Node, key: string, depth = 0): ReactElement | null => {
    if (hidden?.has(node)) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      // Table structure elements cannot hold text; source indentation between cells is dropped.
      const parent = node.parentNode?.nodeName ?? '';
      if (TABLE_PARTS.has(parent) && !node.textContent?.trim()) return null;
      return <Fragment key={key}>{node.textContent}</Fragment>;
    }
    if (!(node instanceof Element)) return null;
    if (node.tagName === 'IMG') return bodyImage(node, key, ticketId);
    if (depth > 80) return <Fragment key={key}>{node.textContent}</Fragment>;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return <br key={key} />;
    if (tag === 'hr') return <hr key={key} />;
    const children = Array.from(node.childNodes).map((child, index) =>
      render(child, `${key}-${index}`, depth + 1),
    );
    if (ALLOWED.has(tag)) return createElement(tag, cellProps(node, key), children);
    return <Fragment key={key}>{children}</Fragment>;
  };
  return Array.from(root.childNodes).map((node, index) => render(node, String(index)));
}
/**
 * Provider HTML is parsed inertly. With `quotes`, earlier mail that an email reply quotes folds
 * behind Show Quoted Text.
 */
export function SdpBody({
  html,
  ticketId,
  quotes = false,
}: Readonly<{ html: string; ticketId?: string; quotes?: boolean }>) {
  const [showQuoted, setShowQuoted] = useState(false);
  const parsed = useMemo(() => {
    const root = parseEmail(html);
    root.querySelectorAll('form,input,button,select,textarea').forEach((node) => node.remove());
    return { root, quoted: quotes ? quotedNodes(root) : undefined };
  }, [html, quotes]);
  const content = useMemo(
    () => renderNodes(parsed.root, ticketId, showQuoted ? undefined : parsed.quoted),
    [parsed, ticketId, showQuoted],
  );
  return (
    <>
      <div className="sdp-live-body">{html.trim() ? content : 'No content.'}</div>
      {parsed.quoted && (
        <TactileButton
          size="xs"
          variant="ghost"
          className="sdp-quote-toggle"
          aria-expanded={showQuoted}
          onClick={() => setShowQuoted((shown) => !shown)}
        >
          {showQuoted ? 'Hide Quoted Text' : 'Show Quoted Text'}
        </TactileButton>
      )}
    </>
  );
}
