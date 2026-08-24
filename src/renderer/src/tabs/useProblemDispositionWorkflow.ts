import { useCallback, useRef, useState } from 'react';
import type {
  DynatraceProblemRecord,
  DynatraceProblemResolver,
  DynatraceProblemStateRecord,
} from '@shared/dynatraceProblems';
import { useToast } from '../components/Toast';
import { formatDynatraceTicketReferenceNote } from '../services/dynatraceProblemsService';
import { isProblemAddressed } from './dynatraceProblemQueueModel';

export type ProblemSavingAction = 'address' | 'response' | 'refresh' | null;

type PendingDispositionResponse = {
  noteId: string;
  resolver: DynatraceProblemResolver;
};

type ProblemDraft = {
  ticket: string;
  note: string;
  resolver: DynatraceProblemResolver | '';
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
  addNote: AddProblemNote;
  setAddressed: SetProblemAddressed;
};

const EMPTY_PROBLEM_DRAFT: ProblemDraft = { ticket: '', note: '', resolver: '' };

export function useProblemDispositionWorkflow({
  selectedProblem,
  selectedState,
  addNote,
  setAddressed,
}: ProblemDispositionWorkflowInput) {
  const { showToast } = useToast();
  const selectedProblemId = selectedProblem?.problemId ?? null;
  const [draftsByProblemId, setDraftsByProblemId] = useState<Record<string, ProblemDraft>>({});
  const [pendingDispositionResponses, setPendingDispositionResponses] = useState<
    Record<string, PendingDispositionResponse>
  >({});
  const [savingAction, setSavingAction] = useState<ProblemSavingAction>(null);
  const savingActionRef = useRef<ProblemSavingAction>(null);
  const {
    ticket: ticketDraft,
    note: noteDraft,
    resolver: resolverDraft,
  } = selectedProblemId
    ? (draftsByProblemId[selectedProblemId] ?? EMPTY_PROBLEM_DRAFT)
    : EMPTY_PROBLEM_DRAFT;
  const hasUnsavedDraft =
    ticketDraft.trim().length > 0 || noteDraft.trim().length > 0 || resolverDraft.length > 0;
  const selectedPendingDispositionResponse = selectedProblemId
    ? pendingDispositionResponses[selectedProblemId]
    : undefined;
  const pendingDispositionResponseNoteId =
    selectedPendingDispositionResponse?.resolver === resolverDraft
      ? selectedPendingDispositionResponse.noteId
      : '';

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
  const setTicketDraft = useCallback(
    (value: string) => updateSelectedDraft({ ticket: value }),
    [updateSelectedDraft],
  );
  const setNoteDraft = useCallback(
    (value: string) => updateSelectedDraft({ note: value }),
    [updateSelectedDraft],
  );
  const setResolverDraft = useCallback(
    (value: DynatraceProblemResolver | '') => updateSelectedDraft({ resolver: value }),
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

  const saveDraftedResponses = useCallback(
    async (problemId: string, onResponsePersisted?: (noteId: string) => void) => {
      let responseNoteId = '';
      if (ticketDraft.trim()) {
        const ticketNote = await addSelectedProblemNote(
          problemId,
          formatDynatraceTicketReferenceNote(ticketDraft),
        );
        responseNoteId = ticketNote.id;
        if (responseNoteId) onResponsePersisted?.(responseNoteId);
        setTicketDraft('');
      }
      if (noteDraft.trim()) {
        const nocNote = await addSelectedProblemNote(problemId, noteDraft);
        responseNoteId ||= nocNote.id;
        if (responseNoteId) onResponsePersisted?.(responseNoteId);
        setNoteDraft('');
      }
      if (!responseNoteId) {
        throw new Error(
          'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
        );
      }
      return responseNoteId;
    },
    [addSelectedProblemNote, noteDraft, setNoteDraft, setTicketDraft, ticketDraft],
  );

  const rememberPendingDispositionResponse = useCallback(
    (problemId: string, noteId: string, resolver: DynatraceProblemResolver) => {
      setPendingDispositionResponses((current) => ({
        ...current,
        [problemId]: { noteId, resolver },
      }));
    },
    [],
  );

  const handleSaveResponse = useCallback(async () => {
    if (
      !selectedProblem ||
      !resolverDraft ||
      (!ticketDraft.trim() && !noteDraft.trim()) ||
      savingActionRef.current
    ) {
      return;
    }
    await runExclusive('response', async () => {
      try {
        await saveDraftedResponses(selectedProblem.problemId);
        showToast('Local response saved', 'success');
      } catch (saveError) {
        showToast(
          saveError instanceof Error ? saveError.message : 'Failed to save local response',
          'error',
        );
      }
    });
  }, [
    noteDraft,
    resolverDraft,
    runExclusive,
    saveDraftedResponses,
    selectedProblem,
    showToast,
    ticketDraft,
  ]);

  const handleAddressToggle = useCallback(async () => {
    if (!selectedProblem || savingActionRef.current) return;
    const nextAddressed = !isProblemAddressed(selectedState);
    if (nextAddressed && !resolverDraft) {
      showToast('Select your name from the resolver list.', 'warning');
      return;
    }
    const hasDraftedResponse = Boolean(ticketDraft.trim() || noteDraft.trim());
    if (nextAddressed && !hasDraftedResponse && !pendingDispositionResponseNoteId) {
      showToast(
        'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
        'warning',
      );
      return;
    }
    await runExclusive('address', async () => {
      try {
        let responseNoteId = pendingDispositionResponseNoteId || undefined;
        if (nextAddressed) {
          const resolver = resolverDraft as DynatraceProblemResolver;
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
        setResolverDraft('');
        showToast(
          nextAddressed ? 'Problem marked addressed locally' : 'Problem returned to queue',
          'success',
        );
      } catch (saveError) {
        showToast(
          saveError instanceof Error ? saveError.message : 'Failed to update local problem state',
          'error',
        );
      }
    });
  }, [
    noteDraft,
    pendingDispositionResponseNoteId,
    resolverDraft,
    rememberPendingDispositionResponse,
    runExclusive,
    saveDraftedResponses,
    selectedProblem,
    selectedState,
    setAddressed,
    setResolverDraft,
    showToast,
    ticketDraft,
  ]);

  return {
    ticketDraft,
    noteDraft,
    resolverDraft,
    hasUnsavedDraft,
    hasPendingDispositionResponse: Boolean(pendingDispositionResponseNoteId),
    savingAction,
    setTicketDraft,
    setNoteDraft,
    setResolverDraft,
    handleSaveResponse,
    handleAddressToggle,
    runExclusive,
  };
}
