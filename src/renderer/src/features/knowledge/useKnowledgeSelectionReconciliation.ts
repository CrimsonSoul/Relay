import { useEffect, useRef, useState } from 'react';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';

export type KnowledgeSelectionReconciliationInput = {
  selectedDocumentId: string | null;
  documents: readonly KnowledgeDocumentRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
  onConfirmedAbsent: () => void;
};

export function useKnowledgeSelectionReconciliation({
  selectedDocumentId,
  documents,
  loading,
  error,
  hasLoadedSnapshot,
  refetch,
  onConfirmedAbsent,
}: KnowledgeSelectionReconciliationInput): {
  selectedDocument: KnowledgeDocumentRecord | null;
  confirmingAbsence: boolean;
} {
  const retainedRef = useRef<KnowledgeDocumentRecord | null>(null);
  const confirmationGenerationRef = useRef(0);
  const lastAttemptedMissingIdRef = useRef<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    generation: number;
    refreshComplete: boolean;
  } | null>(null);
  const live = selectedDocumentId
    ? (documents.find(({ id }) => id === selectedDocumentId) ?? null)
    : null;

  if (live) retainedRef.current = live;
  if (!selectedDocumentId) retainedRef.current = null;

  useEffect(() => {
    if (live || !selectedDocumentId) {
      lastAttemptedMissingIdRef.current = null;
      setConfirmation(null);
    }
  }, [live, selectedDocumentId]);

  useEffect(() => {
    if (!selectedDocumentId || live || loading || error || !hasLoadedSnapshot) return;
    if (confirmation?.id === selectedDocumentId) return;
    if (lastAttemptedMissingIdRef.current === selectedDocumentId) return;

    lastAttemptedMissingIdRef.current = selectedDocumentId;
    const generation = confirmationGenerationRef.current + 1;
    confirmationGenerationRef.current = generation;
    setConfirmation({ id: selectedDocumentId, generation, refreshComplete: false });

    void refetch()
      .then(() => {
        setConfirmation((current) =>
          current?.id === selectedDocumentId && current.generation === generation
            ? { ...current, refreshComplete: true }
            : current,
        );
      })
      .catch(() => {
        setConfirmation((current) =>
          current?.id === selectedDocumentId && current.generation === generation ? null : current,
        );
      });
  }, [confirmation, error, hasLoadedSnapshot, live, loading, refetch, selectedDocumentId]);

  useEffect(() => {
    if (!confirmation?.refreshComplete) return;
    if (confirmation.id !== selectedDocumentId) {
      setConfirmation(null);
      return;
    }
    if (loading || error || !hasLoadedSnapshot) return;
    if (documents.some(({ id }) => id === confirmation.id)) {
      setConfirmation(null);
      return;
    }

    setConfirmation(null);
    onConfirmedAbsent();
  }, [
    confirmation,
    documents,
    error,
    hasLoadedSnapshot,
    loading,
    onConfirmedAbsent,
    selectedDocumentId,
  ]);

  return {
    selectedDocument: live ?? (selectedDocumentId ? retainedRef.current : null),
    confirmingAbsence: confirmation !== null,
  };
}
