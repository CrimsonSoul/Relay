import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sdpRichEditorHtml, sdpRichEscape, sdpRichHtml } from '@shared/sdpRichText';
import { Tooltip } from '../../components/Tooltip';
import { getEditorShortcutLabel } from '../../tabs/alerts/editorShortcut';
import { toolbarActivationProps } from '../../tabs/alerts/toolbarActivation';
import { richMarkupFromHtml, richMarkupFromNode } from './sdpRichDraft';

type Format = 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList';
const FORMATS: readonly { format: Format; label: string; key?: string; text: string }[] = [
  { format: 'bold', label: 'Bold', key: 'B', text: 'B' },
  { format: 'italic', label: 'Italic', key: 'I', text: 'I' },
  { format: 'underline', label: 'Underline', key: 'U', text: 'U' },
  { format: 'insertUnorderedList', label: 'Bullet List', text: '•' },
  { format: 'insertOrderedList', label: 'Numbered List', text: '1.' },
];
const SAFE_HREF = /^(?:https?:\/\/|mailto:)[^\s()<>"'\\]+$/i;

/** An address as a link target: a bare host gains https://, an address gains mailto:. */
export function replyLinkHref(text: string): string | undefined {
  const value = text.trim();
  let href = value;
  if (/^[^@]+@[^@]+$/.test(value) && !/[\s/:]/.test(value)) href = `mailto:${value}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) href = `https://${value}`;
  return SAFE_HREF.test(href) ? href : undefined;
}

/**
 * The reply message: text with SDP's email formatting (bold, italic, underline, lists and links)
 * and the quoted message beneath. What it holds is always reply markup, so pasted content keeps
 * only that formatting and the server escapes everything typed.
 */
export function SdpRichReplyEditor({
  initial,
  disabled,
  onChange,
}: Readonly<{
  /** The markup the editor opens with; later changes to it are ignored. */
  initial: string;
  disabled: boolean;
  onChange: (markup: string) => void;
}>) {
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [active, setActive] = useState<Partial<Record<Format, boolean>>>({});
  const [link, setLink] = useState<string>();
  const [linkError, setLinkError] = useState(false);
  const linkField = useRef<HTMLInputElement>(null);
  const linkOpen = link !== undefined;
  // The field opens from the toolbar to take the address straight away.
  useEffect(() => {
    if (linkOpen) linkField.current?.focus();
  }, [linkOpen]);
  const initialMarkup = useRef(initial);
  useLayoutEffect(() => {
    const node = editor.current;
    // Showing Tickets again reruns effects over the same editor; its draft stays as it is.
    if (!node || node.childNodes.length) return;
    node.innerHTML = sdpRichEditorHtml(initialMarkup.current) || '<div><br></div>';
    // The reply is written above the quoted message.
    const caret = document.createRange();
    caret.setStart(node.firstChild ?? node, 0);
    caret.collapse(true);
    range.current = caret;
  }, []);
  const changed = useCallback(() => {
    if (editor.current) onChange(richMarkupFromNode(editor.current));
  }, [onChange]);
  const refresh = useCallback(() => {
    const node = editor.current;
    const selection = globalThis.getSelection();
    if (!node || !selection?.rangeCount || !node.contains(selection.anchorNode)) return;
    range.current = selection.getRangeAt(0).cloneRange();
    setActive(
      Object.fromEntries(
        // eslint-disable-next-line sonarjs/deprecation -- queryCommandState reports contentEditable formatting
        FORMATS.map(({ format }) => [format, document.queryCommandState?.(format) ?? false]),
      ),
    );
  }, []);
  useEffect(() => {
    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
  }, [refresh]);
  /** Focuses the editor where its last selection was, so a toolbar command applies there. */
  function restore() {
    const node = editor.current;
    node?.focus();
    const selection = globalThis.getSelection();
    if (range.current && selection && node?.contains(range.current.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range.current);
    }
  }
  function apply(format: Format) {
    if (disabled) return;
    restore();
    // eslint-disable-next-line sonarjs/deprecation -- execCommand keeps formatting on the native undo stack
    document.execCommand(format);
    refresh();
    changed();
  }
  /** Inserts at the caret without splitting its line: lines break with <br>, as in a message. */
  function insertMarkup(markup: string) {
    // eslint-disable-next-line sonarjs/deprecation -- execCommand keeps the insertion on the native undo stack
    document.execCommand('insertHTML', false, sdpRichHtml(markup));
    changed();
  }
  function applyLink() {
    const href = replyLinkHref(link ?? '');
    if (!href) {
      setLinkError(true);
      return;
    }
    restore();
    const selection = globalThis.getSelection();
    if (selection && !selection.isCollapsed)
      // eslint-disable-next-line sonarjs/deprecation -- execCommand keeps link edits on the native undo stack
      document.execCommand('createLink', false, href);
    else insertMarkup(`[${sdpRichEscape(link!.trim())}](${href})`);
    setLink(undefined);
    changed();
  }
  return (
    <div className="sdp-reply-editor">
      <div className="sdp-reply-toolbar" role="toolbar" aria-label="Message formatting">
        {FORMATS.map(({ format, label, key, text }) => {
          const shortcut = key && getEditorShortcutLabel(key);
          return (
            <Tooltip key={format} content={shortcut ? `${label} (${shortcut})` : label}>
              <button
                type="button"
                className={`sdp-reply-format sdp-reply-format--${format}${active[format] ? ' active' : ''}`}
                aria-label={label}
                aria-pressed={!!active[format]}
                aria-keyshortcuts={key ? `Meta+${key} Control+${key}` : undefined}
                disabled={disabled}
                {...toolbarActivationProps(() => apply(format))}
              >
                {text}
              </button>
            </Tooltip>
          );
        })}
        <Tooltip content="Insert Link">
          <button
            type="button"
            className="sdp-reply-format"
            aria-label="Insert Link"
            aria-expanded={link !== undefined}
            disabled={disabled}
            {...toolbarActivationProps(() => {
              refresh();
              setLinkError(false);
              setLink(link === undefined ? '' : undefined);
            })}
          >
            Link
          </button>
        </Tooltip>
      </div>
      {link !== undefined && (
        <div className="sdp-reply-link">
          <label>
            <span>Link address</span>
            <input
              ref={linkField}
              value={link}
              placeholder="https://"
              aria-invalid={linkError || undefined}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkError(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                } else if (event.key === 'Escape') {
                  event.stopPropagation();
                  setLink(undefined);
                  restore();
                }
              }}
            />
          </label>
          <button type="button" className="sdp-reply-link-apply" onClick={applyLink}>
            Add Link
          </button>
          {linkError && (
            <p className="field-error" role="alert">
              Enter a web address (https://…) or an email address.
            </p>
          )}
        </div>
      )}
      <div // NOSONAR - contentEditable rich text editor requires role="textbox", no native equivalent
        ref={editor}
        className="sdp-reply-body"
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        tabIndex={0}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={changed}
        onKeyUp={refresh}
        onMouseUp={refresh}
        onPaste={(event) => {
          event.preventDefault();
          const html = event.clipboardData.getData('text/html');
          const text = event.clipboardData.getData('text/plain');
          insertMarkup(
            html ? richMarkupFromHtml(html) : sdpRichEscape(text.replaceAll('\r\n', '\n')),
          );
        }}
        onDrop={(event) => event.preventDefault()}
      />
    </div>
  );
}
