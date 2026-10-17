import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  dynatraceAnalystKey,
  isDynatraceProblemResolver,
  type DynatraceNocAnalyst,
  type DynatraceProblemRecord,
  type DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
import { isProblemAddressed } from './dynatraceProblemQueueModel';

export type ProblemSavingAction = 'address' | 'response' | 'refresh' | null;

type PendingDispositionResponse = {
  noteId: string;
  resolver: string;
};

type ProblemDraft = {
  note: string;
  /** Undefined until the operator picks for this problem; the remembered resolver applies. */
  resolver?: string;
};

type AddProblemNote = (problemId: string, note: string, author?: string) => Promise<{ id: string }>;

type SetProblemAddressed = (
  problemId: string,
  addressed: boolean,
  responseNoteId?: string,
  resolver?: string,
) => Promise<unknown>;

type ProblemDispositionWorkflowInput = {
  selectedProblem: DynatraceProblemRecord | undefined;
  selectedState: DynatraceProblemStateRecord | undefined;
  /** Names offered by the resolver select; a remembered name outside it is not preselected. */
  resolvers?: readonly DynatraceNocAnalyst[];
  addNote: AddProblemNote;
  setAddressed: SetProblemAddressed;
  /** Focused when a save is attempted without a NOC note; the first field in form order. */
  noteInputRef?: RefObject<HTMLTextAreaElement | null>;
  /** Focused when a save is attempted without a resolver, beside its inline error. */
  resolverSelectRef?: RefObject<HTMLSelectElement | null>;
  /** Called after Undo returns a just-addressed problem to the queue, so it can be reselected. */
  onAddressUndone?: (problemId: string) => void;
};

/** Long enough to read the toast and reach Undo after a commit. */
const UNDO_TOAST_DURATION_MS = 8_000;

export const RESOLVER_REQUIRED_MESSAGE = 'Select your name.';

const EMPTY_PROBLEM_DRAFT: ProblemDraft = { note: '' };

/** Per-workstation memory of who last marked a problem addressed, so the next one defaults to them. */
export const LAST_RESOLVER_STORAGE_KEY = 'relay-dynatrace-last-resolver';

function readRememberedResolver(): string {
  try {
    const stored = globalThis.localStorage?.getItem(LAST_RESOLVER_STORAGE_KEY) ?? '';
    return isDynatraceProblemResolver(stored) ? stored : '';
  } catch {
    return '';
  }
}

function writeRememberedResolver(resolver: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_RESOLVER_STORAGE_KEY, resolver);
  } catch {
    // Best-effort convenience; the resolver select still works without it.
  }
}

export function useProblemDispositionWorkflow({
  selectedProblem,
  selectedState,
  resolvers,
  addNote,
  setAddressed,
  noteInputRef,
  resolverSelectRef,
  onAddressUndone,
}: ProblemDispositionWorkflowInput) {
  const { showToast } = useToast();
  const selectedProblemId = selectedProblem?.problemId ?? null;
  const [draftsByProblemId, setDraftsByProblemId] = useState<Record<string, ProblemDraft>>({});
  const [pendingDispositionResponses, setPendingDispositionResponses] = useState<
    Record<string, PendingDispositionResponse>
  >({});
  const [savingAction, setSavingAction] = useState<ProblemSavingAction>(null);
  const [rememberedResolver, setRememberedResolver] = useState(readRememberedResolver);
  const [resolverErrorProblemId, setResolverErrorProblemId] = useState<string | null>(null);
  const savingActionRef = useRef<ProblemSavingAction>(null);
  const selectedDraft = selectedProblemId
    ? (draftsByProblemId[selectedProblemId] ?? EMPTY_PROBLEM_DRAFT)
    : EMPTY_PROBLEM_DRAFT;
  const noteDraft = selectedDraft.note;
  const offeredRememberedResolver =
    !resolvers || resolvers.some((analyst) => dynatraceAnalystKey(analyst) === rememberedResolver)
      ? rememberedResolver
      : '';
  const resolverDraft = selectedDraft.resolver ?? offeredRememberedResolver;
  // The remembered default is not operator input, so only an explicit different pick is unsaved.
  const hasUnsavedDraft =
    noteDraft.trim().length > 0 ||
    (selectedDraft.resolver !== undefined && selectedDraft.resolver !== offeredRememberedResolver);
  const selectedPendingDispositionResponse = selectedProblemId
    ? pendingDispositionResponses[selectedProblemId]
    : undefined;
  const pendingDispositionResponseNoteId =
    selectedPendingDispositionResponse?.resolver === resolverDraft
      ? selectedPendingDispositionResponse.noteId
      : '';
  // The error belongs to the problem it was raised on and clears once a name is picked.
  const resolverError =
    resolverErrorProblemId !== null &&
    resolverErrorProblemId === selectedProblemId &&
    !resolverDraft
      ? RESOLVER_REQUIRED_MESSAGE
      : '';
  /** An attempted save with missing input focuses the first missing field in form order. The
      resolver reports at its select (inline error); the note, which has no inline error, is named
      in a warning toast together with the resolver when both are missing. */
  const reportMissingInput = useCallback(
    (problemId: string, missing: { note: boolean; resolver: boolean }, attempted: string) => {
      if (missing.resolver) setResolverErrorProblemId(problemId);
      if (!missing.note) {
        resolverSelectRef?.current?.focus();
        return;
      }
      noteInputRef?.current?.focus();
      const needed = missing.resolver ? 'a NOC note and select your name' : 'a NOC note';
      showToast(`Add ${needed} before ${attempted}.`, 'warning');
    },
    [noteInputRef, resolverSelectRef, showToast],
  );

  const updateSelectedDraft = useCallback(
    (patch: Partial<ProblemDraft>) => {
      if (!selectedProblemId) return;
      setDraftsByProblemId((current) => ({
        ...current,
        [selectedProblemId]: {
          ...(current[selectedProblemId] ?? EMPTY_PROBLEM_DRAFT),
          ...patch,
        },
      }));
    },
    [selectedProblemId],
  );
  const setNoteDraft = useCallback(
    (value: string) => updateSelectedDraft({ note: value }),
    [updateSelectedDraft],
  );
  const setResolverDraft = useCallback(
    (value: string) => updateSelectedDraft({ resolver: value }),
    [updateSelectedDraft],
  );

  const runExclusive = useCallback(
    async (action: Exclude<ProblemSavingAction, null>, operation: () => Promise<void>) => {
      if (savingActionRef.current) return false;
      savingActionRef.current = action;
      setSavingAction(action);
      try {
        await operation();
        return true;
      } finally {
        savingActionRef.current = null;
        setSavingAction(null);
      }
    },
    [],
  );

  const addSelectedProblemNote = useCallback(
    (problemId: string, note: string) =>
      resolverDraft ? addNote(problemId, note, resolverDraft) : addNote(problemId, note),
    [addNote, resolverDraft],
  );

  const clearSavedNote = useCallback((problemId: string, savedNote: string) => {
    setDraftsByProblemId((current) => {
      const draft = current[problemId];
      // Text typed while the save was in flight is a new draft, not part of the saved note.
      if (draft?.note !== savedNote) return current;
      return { ...current, [problemId]: { ...draft, note: '' } };
    });
  }, []);

  const saveDraftedResponses = useCallback(
    async (problemId: string, onResponsePersisted?: (noteId: string) => void) => {
      let responseNoteId = '';
      if (noteDraft.trim()) {
        const savedNote = noteDraft;
        const nocNote = await addSelectedProblemNote(problemId, savedNote);
        responseNoteId = nocNote.id;
        if (responseNoteId) onResponsePersisted?.(responseNoteId);
        clearSavedNote(problemId, savedNote);
      }
      if (!responseNoteId) {
        throw new Error('Add a NOC note before marking this problem addressed.');
      }
      return responseNoteId;
    },
    [addSelectedProblemNote, clearSavedNote, noteDraft],
  );

  const rememberPendingDispositionResponse = useCallback(
    (problemId: string, noteId: string, resolver: string) => {
      setPendingDispositionResponses((current) => ({
        ...current,
        [problemId]: { noteId, resolver },
      }));
    },
    [],
  );

  const handleSaveResponse = useCallback(async () => {
    if (!selectedProblem || savingActionRef.current) return;
    const missing = { note: !noteDraft.trim(), resolver: !resolverDraft };
    if (missing.note || missing.resolver) {
      reportMissingInput(selectedProblem.problemId, missing, 'adding a note');
      return;
    }
    await runExclusive('response', async () => {
      try {
        await saveDraftedResponses(selectedProblem.problemId);
        showToast(`Added a note to ${selectedProblem.displayId}`, 'success');
      } catch (saveError) {
        showToast(
          formatFailure({
            what: `Couldn't add a note to ${selectedProblem.displayId}`,
            error: saveError,
          }),
          'error',
        );
      }
    });
  }, [
    noteDraft,
    reportMissingInput,
    resolverDraft,
    runExclusive,
    saveDraftedResponses,
    selectedProblem,
    showToast,
  ]);

  /** Undo from the success toast: the same as Return to Queue, then reselect the problem. */
  const undoAddressed = useCallback(
    async (problemId: string, displayId: string) => {
      try {
        await setAddressed(problemId, false);
        onAddressUndone?.(problemId);
        showToast(`Returned ${displayId} to the queue`, 'success');
      } catch (undoError) {
        showToast(
          formatFailure({ what: `Couldn't return ${displayId} to the queue`, error: undoError }),
          'error',
        );
      }
    },
    [onAddressUndone, setAddressed, showToast],
  );

  const handleAddressToggle = useCallback(async () => {
    if (!selectedProblem || savingActionRef.current) return;
    const nextAddressed = !isProblemAddressed(selectedState, selectedProblem);
    const hasDraftedResponse = Boolean(noteDraft.trim());
    const missing = {
      note: !hasDraftedResponse && !pendingDispositionResponseNoteId,
      resolver: !resolverDraft,
    };
    if (nextAddressed && (missing.note || missing.resolver)) {
      reportMissingInput(selectedProblem.problemId, missing, 'marking this problem addressed');
      return;
    }
    const problem = selectedProblem.displayId;
    const done = nextAddressed ? `Marked ${problem} addressed` : `Returned ${problem} to the queue`;
    const failed = nextAddressed
      ? `Couldn't mark ${problem} addressed`
      : `Couldn't return ${problem} to the queue`;
    await runExclusive('address', async () => {
      try {
        let responseNoteId = pendingDispositionResponseNoteId || undefined;
        if (nextAddressed) {
          const resolver = resolverDraft;
          if (hasDraftedResponse) {
            responseNoteId = await saveDraftedResponses(selectedProblem.problemId, (noteId) =>
              rememberPendingDispositionResponse(selectedProblem.problemId, noteId, resolver),
            );
          }
        }
        await setAddressed(
          selectedProblem.problemId,
          nextAddressed,
          responseNoteId,
          nextAddressed ? resolverDraft : undefined,
        );
        setPendingDispositionResponses((current) => {
          if (!current[selectedProblem.problemId]) return current;
          const next = { ...current };
          delete next[selectedProblem.problemId];
          return next;
        });
        if (nextAddressed) {
          const resolver = resolverDraft;
          writeRememberedResolver(resolver);
          setRememberedResolver(resolver);
        }
        updateSelectedDraft({ resolver: undefined });
        const problemId = selectedProblem.problemId;
        showToast(
          done,
          'success',
          nextAddressed
            ? {
                durationMs: UNDO_TOAST_DURATION_MS,
                action: { label: 'Undo', onClick: () => void undoAddressed(problemId, problem) },
              }
            : undefined,
        );
      } catch (saveError) {
        showToast(formatFailure({ what: failed, error: saveError }), 'error');
      }
    });
  }, [
    noteDraft,
    pendingDispositionResponseNoteId,
    reportMissingInput,
    resolverDraft,
    rememberPendingDispositionResponse,
    runExclusive,
    saveDraftedResponses,
    selectedProblem,
    selectedState,
    setAddressed,
    undoAddressed,
    updateSelectedDraft,
    showToast,
  ]);

  return {
    noteDraft,
    resolverDraft,
    resolverError,
    hasUnsavedDraft,
    hasPendingDispositionResponse: Boolean(pendingDispositionResponseNoteId),
    savingAction,
    setNoteDraft,
    setResolverDraft,
    handleSaveResponse,
    handleAddressToggle,
    runExclusive,
  };
}
