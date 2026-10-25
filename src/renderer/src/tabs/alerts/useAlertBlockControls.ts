import { useCallback, useRef, useState, type RefObject } from 'react';
import type React from 'react';
import { alertBlockKind, type AlertBlockKind } from './alertBlocks';
import {
  focusFirstField,
  isEmptyBlock,
  moveStep,
  removeBlock,
  stepNumberOf,
  topLevelBlockOf,
} from './alertBlockEditing';

export type ActiveAlertBlock = {
  element: Element;
  kind: AlertBlockKind;
  top: number;
  stepNumber: number;
  stepCount: number;
};

type UseAlertBlockControlsOptions = {
  editorRef: RefObject<HTMLDivElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
  /** Emits the edited body through the editor's change path. */
  commit: () => void;
};

const caretPoint = (): { node: Node; offset: number; collapsed: boolean } | null => {
  const selection = globalThis.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return { node: range.startContainer, offset: range.startOffset, collapsed: range.collapsed };
};

const newLine = (): HTMLParagraphElement => {
  const paragraph = document.createElement('p');
  paragraph.append(document.createElement('br'));
  return paragraph;
};

const placeCaret = (node: Node, offset: number) => {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = globalThis.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * Step reordering, block removal and the keys that act on guide blocks. Every change is announced
 * through `announcement` and emitted with `commit`.
 */
export function useAlertBlockControls({
  editorRef,
  frameRef,
  commit,
}: UseAlertBlockControlsOptions) {
  const [activeBlock, setActiveBlock] = useState<ActiveAlertBlock | null>(null);
  // Each message gets a fresh id so the live region re-renders and repeats an identical message.
  const [announcement, setAnnouncementState] = useState({ text: '', id: 0 });
  const setAnnouncement = useCallback(
    (text: string) => setAnnouncementState((previous) => ({ text, id: previous.id + 1 })),
    [],
  );
  const pendingRemovalRef = useRef<Element | null>(null);

  const describeBlock = useCallback(
    (block: Element | null): ActiveAlertBlock | null => {
      const editor = editorRef.current;
      const kind = block ? alertBlockKind(block) : null;
      if (!editor || !block || !kind) return null;
      const frameTop = frameRef.current?.getBoundingClientRect().top ?? 0;
      return {
        element: block,
        kind,
        top: block.getBoundingClientRect().top - frameTop,
        stepNumber: kind === 'step' ? stepNumberOf(editor, block) : 0,
        stepCount: editor.querySelectorAll(':scope > [data-relay-block="step"]').length,
      };
    },
    [editorRef, frameRef],
  );

  /** Follow the caret; a selection outside the body (a toolbar button) keeps the current block. */
  const refreshActiveBlock = useCallback(() => {
    const editor = editorRef.current;
    const caret = caretPoint();
    if (!editor || !caret || !editor.contains(caret.node)) return;
    setActiveBlock(describeBlock(topLevelBlockOf(editor, caret.node)));
  }, [describeBlock, editorRef]);

  const moveCurrentStep = useCallback(
    (step: Element, direction: 'up' | 'down') => {
      const editor = editorRef.current;
      if (!editor) return;
      const caret = caretPoint();
      const result = moveStep(editor, step, direction);
      if (!result) return;
      editor.focus();
      if (caret && editor.contains(caret.node)) placeCaret(caret.node, caret.offset);
      setAnnouncement(`Moved step ${result.from} to step ${result.to}`);
      commit();
      setActiveBlock(describeBlock(step));
    },
    [commit, describeBlock, editorRef, setAnnouncement],
  );

  const removeCurrentBlock = useCallback(
    (block: Element) => {
      const editor = editorRef.current;
      if (!editor) return;
      const isStep = alertBlockKind(block) === 'step';
      const message = isStep ? `Removed step ${stepNumberOf(editor, block)}` : 'Removed the block';
      pendingRemovalRef.current = null;
      const neighbour = removeBlock(block);
      editor.focus();
      const selection = globalThis.getSelection();
      if (neighbour && selection) focusFirstField(neighbour, selection);
      setAnnouncement(message);
      commit();
      setActiveBlock(describeBlock(neighbour));
    },
    [commit, describeBlock, editorRef, setAnnouncement],
  );

  /** Backspace in an empty step or callout asks first, then removes it on the second press. */
  const handleEmptyBackspace = useCallback(
    (block: Element) => {
      if (pendingRemovalRef.current === block) {
        removeCurrentBlock(block);
        return;
      }
      pendingRemovalRef.current = block;
      const noun = alertBlockKind(block) === 'step' ? 'step' : 'block';
      setAnnouncement(`Press Backspace again to remove this ${noun}`);
    },
    [removeCurrentBlock, setAnnouncement],
  );

  /** Enter in a step title continues in the step's first paragraph instead of splitting it. */
  const enterStepBody = useCallback(
    (step: Element) => {
      const title = step.querySelector(':scope > h3');
      let paragraph = title?.nextElementSibling;
      if (paragraph?.tagName !== 'P') {
        paragraph = newLine();
        (title ?? step).after(paragraph);
      }
      placeCaret(paragraph, 0);
      commit();
    },
    [commit],
  );

  /** Enter in a button starts an ordinary line below it instead of copying the button. */
  const startLineAfter = useCallback(
    (block: Element) => {
      const paragraph = newLine();
      block.after(paragraph);
      placeCaret(paragraph, 0);
      commit();
    },
    [commit],
  );

  /** Backspace and Enter on a plain caret; returns true when the key was used. */
  const handlePlainKey = useCallback(
    (key: string, block: Element, kind: AlertBlockKind, caretNode: Node): boolean => {
      const removable = kind === 'step' || kind === 'callout';
      if (key === 'Backspace' && removable && isEmptyBlock(block)) {
        handleEmptyBackspace(block);
        return true;
      }
      if (key !== 'Enter') return false;
      const caretElement = caretNode instanceof Element ? caretNode : caretNode.parentElement;
      if (kind === 'step' && caretElement?.closest('h3')) {
        enterStepBody(block);
        return true;
      }
      if (kind === 'button') {
        startLineAfter(block);
        return true;
      }
      return false;
    },
    [enterStepBody, handleEmptyBackspace, startLineAfter],
  );

  /** Handle a key that acts on the caret's block; returns true when it was consumed. */
  const handleBlockKey = useCallback(
    (event: React.KeyboardEvent): boolean => {
      const editor = editorRef.current;
      const caret = caretPoint();
      const block = editor && caret ? topLevelBlockOf(editor, caret.node) : null;
      // A pending removal survives only a second Backspace in the same block.
      if (event.key !== 'Backspace' || block !== pendingRemovalRef.current) {
        pendingRemovalRef.current = null;
      }
      const kind = block ? alertBlockKind(block) : null;
      if (!caret || !block || !kind) return false;

      const isMove = event.ctrlKey && event.altKey && /^Arrow(?:Up|Down)$/.test(event.key);
      if (isMove && kind === 'step') {
        moveCurrentStep(block, event.key === 'ArrowUp' ? 'up' : 'down');
        return true;
      }
      // Selections and modified keys (Ctrl+Enter exports) keep their native behaviour.
      const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
      if (!caret.collapsed || modified) return false;
      return handlePlainKey(event.key, block, kind, caret.node);
    },
    [editorRef, handlePlainKey, moveCurrentStep],
  );

  return {
    activeBlock: activeBlock?.element.isConnected ? activeBlock : null,
    announcement,
    refreshActiveBlock,
    clearActiveBlock: () => setActiveBlock(null),
    moveCurrentStep,
    removeCurrentBlock,
    handleBlockKey,
  };
}
