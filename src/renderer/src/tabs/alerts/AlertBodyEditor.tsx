import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { sanitizeHtml, escapeHtml } from '../alertUtils';
import { HighlightPopover } from './HighlightPopover';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';

const MAX_PASTED_IMAGE_BYTES = 3 * 1024 * 1024;

export interface AlertBodyEditorHandle {
  setEditorContent: (html: string) => void;
}

interface AlertBodyEditorProps {
  setBodyHtml: (s: string) => void;
  isCompact: boolean;
  onToggleCompact: () => void;
  isEnhanced: boolean;
  onToggleEnhanced: () => void;
}

const nodeHasContent = (node: Node): boolean => {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length > 0;
  if (node instanceof HTMLBRElement) return true;
  return Array.from(node.childNodes).some(nodeHasContent);
};

const unwrapElement = (element: Element) => {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
};

const unwrapHighlightDescendants = (root: ParentNode) => {
  Array.from(root.querySelectorAll('[data-hl]')).forEach(unwrapElement);
};

const removeEmptyHighlights = (root: ParentNode) => {
  Array.from(root.querySelectorAll('[data-hl]')).forEach((element) => {
    if (!nodeHasContent(element)) element.remove();
  });
};

const normalizeSafeHref = (rawHref: string): string | null => {
  const trimmed = rawHref.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['https:', 'http:', 'mailto:', 'tel:', 'msteams:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });

const getHighlightsIntersectingRange = (range: Range, editorRoot: HTMLElement) =>
  Array.from(editorRoot.querySelectorAll<HTMLElement>('[data-hl]')).filter((element) =>
    range.intersectsNode(element),
  );

const findHighlightAncestor = (node: HTMLElement, editorRoot: HTMLElement) => {
  let current = node.parentElement;
  while (current && current !== editorRoot) {
    if (current.hasAttribute('data-hl')) return current;
    current = current.parentElement;
  }
  return null;
};

const cloneAncestorPathAroundNode = (node: HTMLElement, stopAncestor: HTMLElement): Node => {
  let lifted: Node = node;
  let currentParent = node.parentNode;

  while (currentParent instanceof Element && currentParent !== stopAncestor) {
    const nextParent = currentParent.parentNode;
    const wrapper = currentParent.cloneNode(false);
    wrapper.appendChild(lifted);
    lifted = wrapper;
    currentParent = nextParent;
  }

  return lifted;
};

const appendHighlightedFragment = (
  replacement: DocumentFragment,
  ancestor: HTMLElement,
  contents: DocumentFragment,
) => {
  if (!nodeHasContent(contents)) return;
  const wrapper = ancestor.cloneNode(false);
  wrapper.appendChild(contents);
  replacement.appendChild(wrapper);
};

const liftHighlightOutOfAncestors = (highlight: HTMLElement, editorRoot: HTMLElement) => {
  let ancestor = findHighlightAncestor(highlight, editorRoot);

  while (ancestor) {
    const parent = ancestor.parentNode;
    if (!parent) return;

    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(ancestor);
    beforeRange.setEndBefore(highlight);
    const beforeContents = beforeRange.cloneContents();

    const afterRange = document.createRange();
    afterRange.selectNodeContents(ancestor);
    afterRange.setStartAfter(highlight);
    const afterContents = afterRange.cloneContents();

    const lifted = cloneAncestorPathAroundNode(highlight, ancestor);
    const replacement = document.createDocumentFragment();
    appendHighlightedFragment(replacement, ancestor, beforeContents);
    replacement.appendChild(lifted);
    appendHighlightedFragment(replacement, ancestor, afterContents);
    parent.replaceChild(replacement, ancestor);

    ancestor = findHighlightAncestor(highlight, editorRoot);
  }
};

export const AlertBodyEditor = React.forwardRef<AlertBodyEditorHandle, AlertBodyEditorProps>(
  ({ setBodyHtml, isCompact, onToggleCompact, isEnhanced, onToggleEnhanced }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);
    const linkRangeRef = useRef<Range | null>(null);
    const linkInputId = React.useId();
    const [activeFormats, setActiveFormats] = useState({
      bold: false,
      italic: false,
      underline: false,
    });
    const [isLinkEditorOpen, setIsLinkEditorOpen] = useState(false);
    const [linkValue, setLinkValue] = useState('');
    const [linkError, setLinkError] = useState('');

    React.useImperativeHandle(ref, () => ({
      setEditorContent(html: string) {
        if (editorRef.current) editorRef.current.innerHTML = sanitizeHtml(html);
      },
    }));

    const handleBodyInput = useCallback(() => {
      setBodyHtml(editorRef.current?.innerHTML ?? '');
    }, [setBodyHtml]);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        const pastedImage = Array.from(e.clipboardData.items ?? [])
          .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
          ?.getAsFile();

        if (pastedImage && pastedImage.size <= MAX_PASTED_IMAGE_BYTES) {
          void readFileAsDataUrl(pastedImage).then((dataUrl) => {
            const cleaned = sanitizeHtml(`<img src="${dataUrl}" alt="Pasted alert image">`);
            // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
            document.execCommand('insertHTML', false, cleaned);
            handleBodyInput();
          });
          return;
        }

        const html = e.clipboardData.getData('text/html');
        const plain = e.clipboardData.getData('text/plain');
        const cleaned = html ? sanitizeHtml(html) : escapeHtml(plain).replaceAll('\n', '<br>');
        // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
        document.execCommand('insertHTML', false, cleaned);
        handleBodyInput();
      },
      [handleBodyInput],
    );

    const updateActiveFormats = useCallback(() => {
      /* eslint-disable sonarjs/deprecation -- queryCommandState is the only way to check formatting in contentEditable */
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
      /* eslint-enable sonarjs/deprecation */
    }, []);

    useEffect(() => {
      const handler = () => {
        if (
          editorRef.current?.contains(document.activeElement) ||
          editorRef.current === document.activeElement
        ) {
          updateActiveFormats();
        }
      };
      document.addEventListener('selectionchange', handler);
      return () => document.removeEventListener('selectionchange', handler);
    }, [updateActiveFormats]);

    useEffect(() => {
      if (isLinkEditorOpen) linkInputRef.current?.focus();
    }, [isLinkEditorOpen]);

    const applyFormat = useCallback(
      (cmd: string) => {
        editorRef.current?.focus();
        // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to toggle formatting in contentEditable
        document.execCommand(cmd);
        updateActiveFormats();
      },
      [updateActiveFormats],
    );

    const closeLinkEditor = useCallback(() => {
      setIsLinkEditorOpen(false);
      setLinkValue('');
      setLinkError('');
      linkRangeRef.current = null;
    }, []);

    const openLinkEditor = useCallback(() => {
      const selection = globalThis.getSelection();
      const editor = editorRef.current;
      if (selection && selection.rangeCount > 0 && editor) {
        const range = selection.getRangeAt(0);
        linkRangeRef.current = editor.contains(range.commonAncestorContainer)
          ? range.cloneRange()
          : null;
      } else {
        linkRangeRef.current = null;
      }
      setLinkValue('');
      setLinkError('');
      setIsLinkEditorOpen(true);
    }, []);

    const applyLink = useCallback(() => {
      const href = normalizeSafeHref(linkValue);
      if (!href) {
        setLinkError('Enter a valid link');
        return;
      }

      const editor = editorRef.current;
      editor?.focus();
      const selection = globalThis.getSelection();
      const range = linkRangeRef.current;
      if (selection && range && editor?.contains(range.commonAncestorContainer)) {
        try {
          selection.removeAllRanges();
          selection.addRange(range);
        } catch {
          linkRangeRef.current = null;
        }
      }

      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to create links in contentEditable
      document.execCommand('createLink', false, href);
      closeLinkEditor();
      handleBodyInput();
    }, [closeLinkEditor, handleBodyInput, linkValue]);

    const applyHighlight = useCallback(
      (type: HighlightType) => {
        const selection = globalThis.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        const range = selection.getRangeAt(0);
        if (!editorRef.current?.contains(range.commonAncestorContainer)) return;

        const span = document.createElement('span');
        span.dataset.hl = type;
        span.append(range.extractContents());
        unwrapHighlightDescendants(span);
        range.insertNode(span);
        liftHighlightOutOfAncestors(span, editorRef.current);
        removeEmptyHighlights(editorRef.current);
        selection.removeAllRanges();
        const nextRange = document.createRange();
        nextRange.selectNodeContents(span);
        selection.addRange(nextRange);
        handleBodyInput();
      },
      [handleBodyInput],
    );

    const clearHighlight = useCallback(() => {
      const selection = globalThis.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const editor = editorRef.current;
      if (!editor?.contains(range.commonAncestorContainer)) return;

      if (!selection.isCollapsed) {
        const highlights = getHighlightsIntersectingRange(range, editor);
        if (highlights.length === 0) return;
        highlights.forEach(unwrapElement);
        handleBodyInput();
        return;
      }

      const anchor = selection.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const highlight = element?.closest<HTMLElement>('[data-hl]');
      if (highlight) {
        const parent = highlight.parentNode;
        while (highlight.firstChild) parent?.insertBefore(highlight.firstChild, highlight);
        highlight.remove();
        handleBodyInput();
      }
    }, [handleBodyInput]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!e.metaKey && !e.ctrlKey) return;
        const key = e.key;
        if (key >= '1' && key <= '5') {
          e.preventDefault();
          const idx = Number.parseInt(key) - 1;
          if (HIGHLIGHTS[idx]) applyHighlight(HIGHLIGHTS[idx].type);
        } else if (key === '0') {
          e.preventDefault();
          clearHighlight();
        }
      },
      [applyHighlight, clearHighlight],
    );

    return (
      <div className="alerts-field">
        <span className="alerts-field-label">Body</span>
        <div className="alerts-body-editor">
          <div className="alerts-body-toolbar" role="toolbar" aria-label="Body formatting">
            <Tooltip content="Bold (Cmd+B)">
              <button
                type="button"
                className={`alerts-fmt-btn${activeFormats.bold ? ' active' : ''}`}
                title="Bold (Cmd+B)"
                aria-label="Bold"
                aria-keyshortcuts="Meta+B Control+B"
                aria-pressed={activeFormats.bold}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat('bold');
                }}
              >
                <strong>B</strong>
              </button>
            </Tooltip>
            <Tooltip content="Italic (Cmd+I)">
              <button
                type="button"
                className={`alerts-fmt-btn${activeFormats.italic ? ' active' : ''}`}
                title="Italic (Cmd+I)"
                aria-label="Italic"
                aria-keyshortcuts="Meta+I Control+I"
                aria-pressed={activeFormats.italic}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat('italic');
                }}
              >
                <em>I</em>
              </button>
            </Tooltip>
            <Tooltip content="Underline (Cmd+U)">
              <button
                type="button"
                className={`alerts-fmt-btn${activeFormats.underline ? ' active' : ''}`}
                title="Underline (Cmd+U)"
                aria-label="Underline"
                aria-keyshortcuts="Meta+U Control+U"
                aria-pressed={activeFormats.underline}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat('underline');
                }}
              >
                <span className="alerts-fmt-underline">U</span>
              </button>
            </Tooltip>
            <span className="alerts-fmt-separator" />
            <Tooltip content="Bullet list">
              <button
                type="button"
                className="alerts-fmt-btn"
                title="Bullet List"
                aria-label="Bullet list"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat('insertUnorderedList');
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
                  <line x1="9" y1="6" x2="21" y2="6" />
                  <line x1="9" y1="12" x2="21" y2="12" />
                  <line x1="9" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Numbered list">
              <button
                type="button"
                className="alerts-fmt-btn"
                title="Numbered List"
                aria-label="Numbered list"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyFormat('insertOrderedList');
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <text
                    x="2"
                    y="8"
                    fontSize="7"
                    fontWeight="700"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    1
                  </text>
                  <text
                    x="2"
                    y="14.5"
                    fontSize="7"
                    fontWeight="700"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    2
                  </text>
                  <text
                    x="2"
                    y="21"
                    fontSize="7"
                    fontWeight="700"
                    fill="currentColor"
                    stroke="none"
                    fontFamily="sans-serif"
                  >
                    3
                  </text>
                  <line x1="9" y1="6" x2="21" y2="6" />
                  <line x1="9" y1="12" x2="21" y2="12" />
                  <line x1="9" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Insert link">
              <button
                type="button"
                className={`alerts-fmt-btn${isLinkEditorOpen ? ' active' : ''}`}
                title="Insert Link"
                aria-label="Insert link"
                aria-expanded={isLinkEditorOpen}
                onMouseDown={(e) => {
                  e.preventDefault();
                  openLinkEditor();
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33" />
                </svg>
              </button>
            </Tooltip>
            <span className="alerts-fmt-separator" />
            <HighlightPopover onApply={applyHighlight} onClear={clearHighlight} />
            <span className="alerts-fmt-separator" />
            <Tooltip content="Compact - strip filler phrases">
              <button
                type="button"
                className={`alerts-fmt-btn alerts-toggle-btn alerts-toggle-compact${isCompact ? ' active' : ''}`}
                title="Compact - strip filler phrases"
                aria-label="Compact message"
                aria-pressed={isCompact}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onToggleCompact();
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Enhance - auto-highlight key info">
              <button
                type="button"
                className={`alerts-fmt-btn alerts-toggle-btn alerts-toggle-enhance${isEnhanced ? ' active' : ''}`}
                title="Enhance - auto-highlight key info"
                aria-label="Enhance message"
                aria-pressed={isEnhanced}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onToggleEnhanced();
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z" />
                </svg>
              </button>
            </Tooltip>
          </div>
          {isLinkEditorOpen && (
            <form
              className="alerts-link-editor"
              aria-label="Insert link URL"
              onSubmit={(e) => {
                e.preventDefault();
                applyLink();
              }}
            >
              <label className="alerts-link-editor-label" htmlFor={linkInputId}>
                Link URL
              </label>
              <input
                id={linkInputId}
                ref={linkInputRef}
                className="alerts-link-editor-input"
                value={linkValue}
                placeholder="https://example.com"
                aria-invalid={linkError ? 'true' : undefined}
                onChange={(e) => {
                  setLinkValue(e.target.value);
                  if (linkError) setLinkError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeLinkEditor();
                  }
                }}
              />
              <button type="submit" className="alerts-link-editor-action" aria-label="Apply link">
                Apply
              </button>
              <button
                type="button"
                className="alerts-link-editor-action alerts-link-editor-action-secondary"
                onClick={closeLinkEditor}
              >
                Cancel
              </button>
              {linkError && <span className="alerts-link-editor-error">{linkError}</span>}
            </form>
          )}
          <div // NOSONAR - contentEditable rich text editor requires role="textbox", no native equivalent
            ref={editorRef}
            className="alerts-editable-body"
            contentEditable
            role="textbox"
            aria-label="Alert body"
            tabIndex={0}
            spellCheck
            data-placeholder="Write your alert message here. Cmd+B bold, Cmd+I italic, Cmd+U underline."
            onInput={handleBodyInput}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
    );
  },
);

AlertBodyEditor.displayName = 'AlertBodyEditor';
