import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { useToast } from '../../components/Toast';
import { sanitizeHtml, escapeHtml } from '../alertUtils';
import { HighlightPopover } from './HighlightPopover';
import { HIGHLIGHTS, type HighlightType } from './highlightColors';
import { toolbarActivationProps } from './toolbarActivation';

interface AlertBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
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

const getHighlightsIntersectingRange = (range: Range, editorRoot: HTMLElement) =>
  Array.from(editorRoot.querySelectorAll<HTMLElement>('[data-hl]')).filter((element) =>
    range.intersectsNode(element),
  );

const findHighlightAncestor = (node: HTMLElement, editorRoot: HTMLElement) => {
  let current = node.parentElement;
  while (current && current !== editorRoot) {
    if (current.dataset.hl !== undefined) return current;
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
    ancestor.replaceWith(replacement);

    ancestor = findHighlightAncestor(highlight, editorRoot);
  }
};

export const AlertBodyEditor: React.FC<AlertBodyEditorProps> = ({ value, onChange }) => {
  const { showToast } = useToast();
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedValueRef = useRef<string | null>(null);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  });

  useLayoutEffect(() => {
    const sanitizedValue = sanitizeHtml(value);
    if (sanitizedValue === lastEmittedValueRef.current) return;
    if (editorRef.current && editorRef.current.innerHTML !== sanitizedValue) {
      editorRef.current.innerHTML = sanitizedValue;
    }
    lastEmittedValueRef.current = null;
  }, [value]);

  const handleBodyInput = useCallback(() => {
    const nextValue = editorRef.current?.innerHTML ?? '';
    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
  }, [onChange]);

  const insertImageFile = useCallback(
    (file: File) => {
      if (
        !/^image\/(?:png|jpeg|webp)$/u.test(file.type) ||
        file.size > 5 * 1024 * 1024 ||
        file.size === 0
      ) {
        showToast('Choose a PNG, JPEG, or WebP image no larger than 5 MiB.', 'error');
        return;
      }
      const editor = editorRef.current;
      const selection = globalThis.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const reader = new FileReader();
      reader.onerror = () => showToast('Could not read this image. Try Insert image.', 'error');
      reader.onload = () => {
        if (!editor?.isConnected || typeof reader.result !== 'string') return;
        editor.focus();
        if (range && editor.contains(range.commonAncestorContainer)) {
          const currentSelection = globalThis.getSelection();
          currentSelection?.removeAllRanges();
          currentSelection?.addRange(range);
        }
        const html = sanitizeHtml(
          `<p><img src="${reader.result}" alt="Alert image" class="alert-body-image"></p>`,
        );
        // eslint-disable-next-line sonarjs/deprecation -- contentEditable insertion preserves native undo
        document.execCommand('insertHTML', false, html);
        handleBodyInput();
      };
      reader.readAsDataURL(file);
    },
    [handleBodyInput, showToast],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.clipboardData.files?.[0];
      if (file) {
        insertImageFile(file);
        return;
      }
      const html = e.clipboardData.getData('text/html');
      const plain = e.clipboardData.getData('text/plain');
      const cleaned = html ? sanitizeHtml(html) : escapeHtml(plain).replaceAll('\n', '<br>');
      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
      document.execCommand('insertHTML', false, cleaned);
    },
    [insertImageFile],
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

  const applyFormat = useCallback(
    (cmd: string) => {
      editorRef.current?.focus();
      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to toggle formatting in contentEditable
      document.execCommand(cmd);
      updateActiveFormats();
    },
    [updateActiveFormats],
  );

  const insertAlertImage = useCallback(async () => {
    const result = await window.api?.selectAlertBodyImage?.();
    if (!result?.success || !result.data) {
      if (result?.error && result.error !== 'Cancelled') showToast(result.error, 'error');
      return;
    }

    editorRef.current?.focus();
    const cleaned = sanitizeHtml(
      `<p><img src="${result.data}" alt="Alert image" class="alert-body-image"></p>`,
    );
    // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
    document.execCommand('insertHTML', false, cleaned);
    handleBodyInput();
  }, [handleBodyInput, showToast]);

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
        e.stopPropagation();
        const idx = Number.parseInt(key) - 1;
        if (HIGHLIGHTS[idx]) applyHighlight(HIGHLIGHTS[idx].type);
      } else if (key === '0') {
        e.preventDefault();
        e.stopPropagation();
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
              {...toolbarActivationProps(() => applyFormat('bold'))}
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
              {...toolbarActivationProps(() => applyFormat('italic'))}
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
              {...toolbarActivationProps(() => applyFormat('underline'))}
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
              {...toolbarActivationProps(() => applyFormat('insertUnorderedList'))}
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
              {...toolbarActivationProps(() => applyFormat('insertOrderedList'))}
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
          <Tooltip content="Insert image">
            <button
              type="button"
              className="alerts-fmt-btn"
              title="Insert Image"
              aria-label="Insert image"
              {...toolbarActivationProps(() => void insertAlertImage())}
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
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="M21 16l-5-5L5 19" />
              </svg>
            </button>
          </Tooltip>
          <span className="alerts-fmt-separator" />
          <HighlightPopover onApply={applyHighlight} onClear={clearHighlight} />
        </div>
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
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            insertImageFile(event.dataTransfer.files[0]!);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

AlertBodyEditor.displayName = 'AlertBodyEditor';
