import { useEffect } from 'react';
import { isAnyModalOpen } from '../components/modalStack';

export type UseDynatraceProblemShortcutsParams = Readonly<{
  active: boolean;
  unaddressedProblemIds: readonly string[];
  selectedProblemId: string | null;
  onSelectProblem: (problemId: string) => void;
  onFocusNote: () => void;
  onNoUnaddressedProblems: () => void;
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

export function useDynatraceProblemShortcuts({
  active,
  unaddressedProblemIds,
  selectedProblemId,
  onSelectProblem,
  onFocusNote,
  onNoUnaddressedProblems,
}: UseDynatraceProblemShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !active ||
        !event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        isAnyModalOpen() ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        if (!selectedProblemId) return;
        event.preventDefault();
        onFocusNote();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();

      if (unaddressedProblemIds.length === 0) {
        onNoUnaddressedProblems();
        return;
      }

      const currentIndex = unaddressedProblemIds.indexOf(selectedProblemId ?? '');
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let origin = currentIndex;
      if (origin < 0) origin = direction === 1 ? -1 : 0;
      const nextIndex =
        (origin + direction + unaddressedProblemIds.length) % unaddressedProblemIds.length;
      onSelectProblem(unaddressedProblemIds[nextIndex]!);
    };

    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [
    active,
    onFocusNote,
    onNoUnaddressedProblems,
    onSelectProblem,
    selectedProblemId,
    unaddressedProblemIds,
  ]);
}
