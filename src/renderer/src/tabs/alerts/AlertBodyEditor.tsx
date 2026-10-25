import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { Tooltip } from '../../components/Tooltip';
import { useToast } from '../../components/Toast';
import { sanitizeHtml, escapeHtml } from '../alertUtils';
import { HighlightPopover } from './HighlightPopover';
import { HIGHLIGHTS, HIGHLIGHT_STYLE_VARS, type HighlightType } from './highlightColors';
import { toolbarActivationProps } from './toolbarActivation';
import { getEditorShortcutLabel } from './editorShortcut';
import { prepareAlertBodyImage } from '../../utils/alertBodyImage';
import { AlertLinkPopover } from './AlertLinkPopover';
import { AlertInsertMenu, type AlertInsertKind } from './AlertInsertMenu';
import { AlertBlockToolbar } from './AlertBlockToolbar';
import { useAlertBlockControls } from './useAlertBlockControls';
import {
  alertBlockKind,
  buttonBlockHtml,
  calloutBlockHtml,
  dividerBlockHtml,
  RELAY_BLOCKS_CLIPBOARD_TYPE,
  stepBlockHtml,
  stripBlockMarkers,
} from './alertBlocks';
import {
  focusFirstField,
  insertBlockAfter,
  insertFigureInStep,
  topLevelBlockOf,
} from './alertBlockEditing';

interface AlertBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
}

const alertFigureHtml = (dataUrl: string) =>
  `<figure class="alert-body-figure"><img src="${dataUrl}" alt="Alert image" class="alert-body-image"><figcaption></figcaption></figure>`;

/** An inserted image is a captioned figure followed by a paragraph to keep typing in. */
const alertImageFigureHtml = (dataUrl: string) => `${alertFigureHtml(dataUrl)}<p><br></p>`;

const IMAGE_TOO_LARGE_MESSAGE =
  'This image is too large to insert. Resize it or choose a smaller image.';

const caretNode = (): Node | null => {
  const selection = globalThis.getSelection();
  return selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
};

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
    if (value === lastEmittedValueRef.current) return;
    const sanitizedValue = sanitizeHtml(value);
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

  const frameRef = useRef<HTMLDivElement>(null);
  const {
    activeBlock,
    announcement,
    refreshActiveBlock,
    clearActiveBlock,
    moveCurrentStep,
    removeCurrentBlock,
    handleBlockKey,
  } = useAlertBlockControls({ editorRef, frameRef, commit: handleBodyInput });

  /**
   * Insert an image at the caret. Inside a step it joins that step after the caret's paragraph;
   * inside another block it lands after the block, since callouts and buttons hold text only.
   */
  const insertFigure = useCallback(
    (dataUrl: string) => {
      const editor = editorRef.current;
      const figureHtml = sanitizeHtml(alertFigureHtml(dataUrl));
      if (!editor || !figureHtml.includes('<img ')) {
        showToast(IMAGE_TOO_LARGE_MESSAGE, 'error');
        return;
      }
      const caret = caretNode();
      const block = topLevelBlockOf(editor, caret);
      const kind = block ? alertBlockKind(block) : null;
      if (block && kind === 'step') {
        insertFigureInStep(block, caret, figureHtml);
      } else if (block && kind) {
        insertBlockAfter(editor, block, figureHtml);
      } else {
        // eslint-disable-next-line sonarjs/deprecation -- contentEditable insertion preserves native undo
        document.execCommand('insertHTML', false, sanitizeHtml(alertImageFigureHtml(dataUrl)));
      }
      handleBodyInput();
    },
    [handleBodyInput, showToast],
  );

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
      const insertDataUrl = (dataUrl: string) => {
        if (!editor?.isConnected) return;
        editor.focus();
        if (range && editor.contains(range.commonAncestorContainer)) {
          const currentSelection = globalThis.getSelection();
          currentSelection?.removeAllRanges();
          currentSelection?.addRange(range);
        }
        insertFigure(dataUrl);
      };
      prepareAlertBodyImage(file).then(insertDataUrl, () =>
        showToast('Could not read this image. Try Insert Image.', 'error'),
      );
    },
    [insertFigure, showToast],
  );

  /**
   * Insert pasted top-level content after the caret's block when it contains blocks, so a pasted
   * step never nests inside another. Returns false when there is no block to place.
   */
  const pasteBlocks = useCallback(
    (cleanHtml: string): boolean => {
      const editor = editorRef.current;
      const template = document.createElement('template');
      template.innerHTML = cleanHtml;
      const nodes = Array.from(template.content.childNodes);
      const hasBlock = nodes.some((node) => node instanceof Element && alertBlockKind(node));
      if (!editor || !hasBlock) return false;
      // Pasting over a selection replaces it, as an ordinary paste would.
      const selection = globalThis.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
      }
      let anchor = topLevelBlockOf(editor, caretNode());
      for (const node of nodes) {
        const html =
          node instanceof Element ? node.outerHTML : `<p>${escapeHtml(node.textContent ?? '')}</p>`;
        anchor = insertBlockAfter(editor, anchor, html);
      }
      if (anchor && selection) focusFirstField(anchor, selection);
      handleBodyInput();
      return true;
    },
    [handleBodyInput],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const html = e.clipboardData.getData('text/html');
      const plain = e.clipboardData.getData('text/plain');
      // Office and many apps put a rendered picture beside copied text; the text is what was
      // copied. A file wins only when nothing textual came with it (screenshots, "Copy image").
      const file = e.clipboardData.files?.[0];
      if (file && !plain.trim()) {
        insertImageFile(file);
        return;
      }
      // Only Relay's own copy carries the blocks flavor; anything else loses its block markers so
      // a guide pasted back from Outlook or a browser becomes ordinary content.
      const relayHtml = e.clipboardData.getData(RELAY_BLOCKS_CLIPBOARD_TYPE);
      if (relayHtml && pasteBlocks(sanitizeHtml(relayHtml))) return;
      let cleaned = escapeHtml(plain).replaceAll('\n', '<br>');
      if (relayHtml) cleaned = sanitizeHtml(relayHtml);
      else if (html) cleaned = sanitizeHtml(stripBlockMarkers(html));
      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to insert HTML into contentEditable
      document.execCommand('insertHTML', false, cleaned);
    },
    [insertImageFile, pasteBlocks],
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
      refreshActiveBlock();
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [refreshActiveBlock, updateActiveFormats]);

  const applyFormat = useCallback(
    (cmd: string) => {
      editorRef.current?.focus();
      // eslint-disable-next-line sonarjs/deprecation -- execCommand is the only way to toggle formatting in contentEditable
      document.execCommand(cmd);
      updateActiveFormats();
    },
    [updateActiveFormats],
  );

  /** The selection, when it is inside the body, kept so a menu, dialog or popover can restore it. */
  const captureEditorRange = useCallback((): Range | null => {
    const selection = globalThis.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    return range && editorRef.current?.contains(range.commonAncestorContainer) ? range : null;
  }, []);

  const restoreEditorRange = useCallback((range: Range | null) => {
    editorRef.current?.focus();
    if (!range) return;
    const selection = globalThis.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  /** Copy and cut write the Relay blocks flavor beside text/html so blocks survive a paste here. */
  const handleCopy = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>, isCut = false) => {
      const range = captureEditorRange();
      if (!range || range.collapsed) return;
      const holder = document.createElement('div');
      holder.append(range.cloneContents());
      e.preventDefault();
      e.clipboardData.setData('text/html', holder.innerHTML);
      e.clipboardData.setData('text/plain', globalThis.getSelection()?.toString() ?? '');
      e.clipboardData.setData(RELAY_BLOCKS_CLIPBOARD_TYPE, holder.innerHTML);
      if (!isCut) return;
      // eslint-disable-next-line sonarjs/deprecation -- execCommand keeps the cut on the native undo stack
      document.execCommand('delete');
      handleBodyInput();
    },
    [captureEditorRange, handleBodyInput],
  );

  const insertAlertImage = useCallback(async () => {
    const range = captureEditorRange();
    const result = await window.api?.selectAlertBodyImage?.();
    if (!result?.success || !result.data) {
      if (result?.error && result.error !== 'Cancelled') showToast(result.error, 'error');
      return;
    }

    restoreEditorRange(range);
    insertFigure(result.data);
  }, [captureEditorRange, insertFigure, restoreEditorRange, showToast]);

  const toggleHeading = useCallback(() => {
    editorRef.current?.focus();
    /* eslint-disable sonarjs/deprecation -- formatBlock is the only way to change the block type in contentEditable */
    const isHeading = document.queryCommandValue('formatBlock').toLowerCase() === 'h2';
    document.execCommand('formatBlock', false, isHeading ? 'p' : 'h2');
    /* eslint-enable sonarjs/deprecation */
    handleBodyInput();
  }, [handleBodyInput]);

  const [linkDraft, setLinkDraft] = useState<{ range: Range | null; url: string } | null>(null);

  const [buttonDraft, setButtonDraft] = useState<{ range: Range | null } | null>(null);
  const insertRangeRef = useRef<Range | null>(null);

  const openLinkPopover = useCallback(() => {
    const range = captureEditorRange();
    const anchorNode = range?.commonAncestorContainer ?? null;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
    const existing = anchorElement?.closest('a')?.getAttribute('href') ?? '';
    setLinkDraft({ range, url: existing });
  }, [captureEditorRange]);

  const insertBlock = useCallback(
    (html: string, range: Range | null) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const anchor = topLevelBlockOf(editor, range?.startContainer ?? null);
      const block = insertBlockAfter(editor, anchor, html);
      const selection = globalThis.getSelection();
      if (selection) focusFirstField(block, selection);
      handleBodyInput();
    },
    [handleBodyInput],
  );

  const chooseInsert = useCallback(
    (kind: AlertInsertKind) => {
      const range = insertRangeRef.current;
      insertRangeRef.current = null;
      if (kind === 'button') {
        setButtonDraft({ range });
        return;
      }
      if (kind === 'step') insertBlock(stepBlockHtml(), range);
      else if (kind === 'divider') insertBlock(dividerBlockHtml(), range);
      else insertBlock(calloutBlockHtml(kind), range);
    },
    [insertBlock],
  );

  const applyButtonLink = useCallback(
    (url: string, label?: string) => {
      const range = buttonDraft?.range ?? null;
      setButtonDraft(null);
      insertBlock(buttonBlockHtml(url, label ?? ''), range);
    },
    [buttonDraft, insertBlock],
  );

  const applyLink = useCallback(
    (url: string) => {
      const range = linkDraft?.range ?? null;
      restoreEditorRange(range);
      /* eslint-disable sonarjs/deprecation -- execCommand keeps link edits on the native undo stack */
      if (range && !range.collapsed) {
        document.execCommand('createLink', false, url);
      } else {
        const label = escapeHtml(url);
        document.execCommand('insertHTML', false, sanitizeHtml(`<a href="${label}">${label}</a>`));
      }
      /* eslint-enable sonarjs/deprecation */
      setLinkDraft(null);
      handleBodyInput();
    },
    [handleBodyInput, linkDraft, restoreEditorRange],
  );

  const removeLink = useCallback(() => {
    restoreEditorRange(linkDraft?.range ?? null);
    // eslint-disable-next-line sonarjs/deprecation -- execCommand keeps link edits on the native undo stack
    document.execCommand('unlink');
    setLinkDraft(null);
    handleBodyInput();
  }, [handleBodyInput, linkDraft, restoreEditorRange]);

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
      unwrapElement(highlight);
      handleBodyInput();
    }
  }, [handleBodyInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (handleBlockKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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
    [applyHighlight, clearHighlight, handleBlockKey],
  );

  const boldKey = getEditorShortcutLabel('B');
  const italicKey = getEditorShortcutLabel('I');
  const underlineKey = getEditorShortcutLabel('U');

  return (
    <div className="alerts-field">
      <span className="alerts-field-label">Body</span>
      <div
        ref={frameRef}
        className="alerts-body-editor"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            clearActiveBlock();
          }
        }}
      >
        <div className="alerts-body-toolbar" role="toolbar" aria-label="Body formatting">
          <Tooltip content={`Bold (${boldKey})`}>
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.bold ? ' active' : ''}`}
              aria-label="Bold"
              aria-keyshortcuts="Meta+B Control+B"
              aria-pressed={activeFormats.bold}
              {...toolbarActivationProps(() => applyFormat('bold'))}
            >
              <strong>B</strong>
            </button>
          </Tooltip>
          <Tooltip content={`Italic (${italicKey})`}>
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.italic ? ' active' : ''}`}
              aria-label="Italic"
              aria-keyshortcuts="Meta+I Control+I"
              aria-pressed={activeFormats.italic}
              {...toolbarActivationProps(() => applyFormat('italic'))}
            >
              <em>I</em>
            </button>
          </Tooltip>
          <Tooltip content={`Underline (${underlineKey})`}>
            <button
              type="button"
              className={`alerts-fmt-btn${activeFormats.underline ? ' active' : ''}`}
              aria-label="Underline"
              aria-keyshortcuts="Meta+U Control+U"
              aria-pressed={activeFormats.underline}
              {...toolbarActivationProps(() => applyFormat('underline'))}
            >
              <span className="alerts-fmt-underline">U</span>
            </button>
          </Tooltip>
          <span className="alerts-fmt-separator" />
          <Tooltip content="Heading">
            <button
              type="button"
              className="alerts-fmt-btn alerts-fmt-btn--text"
              aria-label="Heading"
              {...toolbarActivationProps(toggleHeading)}
            >
              H
            </button>
          </Tooltip>
          <Tooltip content="Bullet List">
            <button
              type="button"
              className="alerts-fmt-btn"
              aria-label="Bullet List"
              {...toolbarActivationProps(() => applyFormat('insertUnorderedList'))}
            >
              <svg
                aria-hidden="true"
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
          <Tooltip content="Numbered List">
            <button
              type="button"
              className="alerts-fmt-btn"
              aria-label="Numbered List"
              {...toolbarActivationProps(() => applyFormat('insertOrderedList'))}
            >
              <svg
                aria-hidden="true"
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
          <Tooltip content="Insert Image">
            <button
              type="button"
              className="alerts-fmt-btn"
              aria-label="Insert Image"
              {...toolbarActivationProps(() => void insertAlertImage())}
            >
              <svg
                aria-hidden="true"
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
          <div className="alerts-link-wrapper">
            <Tooltip content="Insert Link">
              <button
                type="button"
                className={`alerts-fmt-btn${linkDraft ? ' active' : ''}`}
                aria-label="Insert Link"
                aria-expanded={linkDraft !== null}
                {...toolbarActivationProps(openLinkPopover)}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5" />
                </svg>
              </button>
            </Tooltip>
            {linkDraft && (
              <AlertLinkPopover
                initialUrl={linkDraft.url}
                onApply={applyLink}
                onRemove={removeLink}
                onClose={() => setLinkDraft(null)}
              />
            )}
          </div>
          <div className="alerts-link-wrapper">
            <AlertInsertMenu
              onOpen={() => {
                insertRangeRef.current = captureEditorRange();
              }}
              onChoose={chooseInsert}
            />
            {buttonDraft && (
              <AlertLinkPopover
                initialUrl=""
                labelMode={{ initialLabel: '' }}
                onApply={applyButtonLink}
                onRemove={() => setButtonDraft(null)}
                onClose={() => setButtonDraft(null)}
              />
            )}
          </div>
          <span className="alerts-fmt-separator" />
          <HighlightPopover onApply={applyHighlight} onClear={clearHighlight} />
        </div>
        <div // NOSONAR - contentEditable rich text editor requires role="textbox", no native equivalent
          ref={editorRef}
          id="alerts-body"
          className="alerts-editable-body"
          style={HIGHLIGHT_STYLE_VARS as React.CSSProperties}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-required="true"
          aria-label="Alert body"
          tabIndex={0}
          spellCheck
          data-placeholder={`Write your alert message here. ${boldKey} bold, ${italicKey} italic, ${underlineKey} underline.`}
          onInput={handleBodyInput}
          onPaste={handlePaste}
          onCopy={(event) => handleCopy(event)}
          onCut={(event) => handleCopy(event, true)}
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
        {activeBlock && (
          <AlertBlockToolbar
            kind={activeBlock.kind}
            top={activeBlock.top}
            stepNumber={activeBlock.stepNumber}
            stepCount={activeBlock.stepCount}
            onMove={(direction) => moveCurrentStep(activeBlock.element, direction)}
            onRemove={() => removeCurrentBlock(activeBlock.element)}
          />
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {announcement.text && <span key={announcement.id}>{announcement.text}</span>}
        </div>
      </div>
    </div>
  );
};

AlertBodyEditor.displayName = 'AlertBodyEditor';
