import { useEffect, useEffectEvent } from 'react';
import { isAnyModalOpen } from '../components/modalStack';

export type UseDynatraceProblemShortcutsParams = Readonly<{
  active: boolean;
  /** Problems in the current view, in display order; Alt+↑/↓ cycles exactly these. */
  visibleProblemIds: readonly string[];
  selectedProblemId: string | null;
  filterCount: number;
  onSelectProblem: (problemId: string) => void;
  onFocusNote: () => void;
  onFocusSearch: () => void;
  /** Zero-based index into the filter tabs, from Alt+1…Alt+N. */
  onSelectFilter: (index: number) => void;
  onSubmitResponse: () => void;
  /** Shift+Mod+Enter: record the drafted note without changing addressed status. */
  onAddNote: () => void;
  onEmptyView: () => void;
}>;

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') ||
      target.isContentEditable ||
      target.contentEditable === 'true' ||
      target.closest('[contenteditable="true"]') !== null)
  );
}

/** The response composer's own fields still take queue navigation so triage never needs the mouse. */
function isResponseField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('.dt-problem-detail__actionbar') !== null;
}

/** Option+letter/digit produce composed characters on macOS, so match the physical key too. */
function matchesKey(event: KeyboardEvent, key: string, code: string): boolean {
  return event.key.toLowerCase() === key || event.code === code;
}

type ShortcutAction =
  | { kind: 'submit' }
  | { kind: 'add-note' }
  | { kind: 'search' }
  | { kind: 'cycle'; direction: 1 | -1 }
  | { kind: 'note' }
  | { kind: 'filter'; index: number };

function resolveAltAction(event: KeyboardEvent, filterCount: number): ShortcutAction | null {
  if (event.key === 'ArrowDown') return { kind: 'cycle', direction: 1 };
  if (event.key === 'ArrowUp') return { kind: 'cycle', direction: -1 };
  if (matchesKey(event, 'n', 'KeyN')) return { kind: 'note' };
  for (let index = 0; index < filterCount; index += 1) {
    const digit = String(index + 1);
    if (matchesKey(event, digit, `Digit${digit}`)) return { kind: 'filter', index };
  }
  return null;
}

function resolveShortcut(event: KeyboardEvent, filterCount: number): ShortcutAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === 'Enter' && mod) {
    if (event.altKey) return null;
    return event.shiftKey ? { kind: 'add-note' } : { kind: 'submit' };
  }
  if (event.key === '/' && !event.altKey && !mod) return { kind: 'search' };
  if (!event.altKey || mod || event.shiftKey) return null;
  return resolveAltAction(event, filterCount);
}

/** Mod+Enter and Shift+Mod+Enter work anywhere; `/` never steals typing; Alt triage works in the response fields. */
function isAllowedFrom(action: ShortcutAction, target: EventTarget | null): boolean {
  if (action.kind === 'submit' || action.kind === 'add-note' || !isEditableTarget(target)) {
    return true;
  }
  return action.kind !== 'search' && isResponseField(target);
}

export function useDynatraceProblemShortcuts({
  active,
  visibleProblemIds,
  selectedProblemId,
  filterCount,
  onSelectProblem,
  onFocusNote,
  onFocusSearch,
  onSelectFilter,
  onSubmitResponse,
  onAddNote,
  onEmptyView,
}: UseDynatraceProblemShortcutsParams): void {
  const cycleProblem = useEffectEvent((direction: 1 | -1) => {
    if (visibleProblemIds.length === 0) {
      onEmptyView();
      return;
    }
    const currentIndex = visibleProblemIds.indexOf(selectedProblemId ?? '');
    let origin = currentIndex;
    if (origin < 0) origin = direction === 1 ? -1 : 0;
    const nextIndex = (origin + direction + visibleProblemIds.length) % visibleProblemIds.length;
    onSelectProblem(visibleProblemIds[nextIndex]!);
  });

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isAnyModalOpen()) return;
    const action = resolveShortcut(event, filterCount);
    if (!action || !isAllowedFrom(action, event.target)) return;
    if (action.kind === 'note' && !selectedProblemId) return;
    event.preventDefault();
    if (action.kind === 'submit') onSubmitResponse();
    else if (action.kind === 'add-note') onAddNote();
    else if (action.kind === 'search') onFocusSearch();
    else if (action.kind === 'cycle') cycleProblem(action.direction);
    else if (action.kind === 'note') onFocusNote();
    else onSelectFilter(action.index);
  });

  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    globalThis.addEventListener('keydown', listener);
    return () => globalThis.removeEventListener('keydown', listener);
  }, [active]);
}
