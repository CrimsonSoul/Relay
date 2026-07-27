import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { describe, expect, it, vi } from 'vitest';
import { useKnowledgeSelectionReconciliation } from '../useKnowledgeSelectionReconciliation';

type Props = {
  selectedDocumentId: string | null;
  documents: KnowledgeDocumentRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
  onConfirmedAbsent: () => void;
};

function record(id: string): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `Operations/${id}.pdf`,
    category: 'Operations',
    categoryId: 'operations',
    documentType: 'sop',
    title: 'Operator guide',
    displayTitle: 'Operator guide',
    fileName: `${id}.pdf`,
    pdf: `${id}.pdf`,
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 3,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-19T12:00:00.000Z',
    indexedAt: '2026-07-19T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-19T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'publisher',
    publishedByName: 'Paris',
    publishedAt: '2026-07-19T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-19T12:00:00.000Z',
    updated: '2026-07-19T12:00:00.000Z',
  };
}

function state(
  documents: KnowledgeDocumentRecord[],
  overrides: Partial<Props> & Pick<Props, 'selectedDocumentId' | 'onConfirmedAbsent'>,
): Props {
  return {
    documents,
    loading: false,
    error: null,
    hasLoadedSnapshot: true,
    refetch: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('useKnowledgeSelectionReconciliation', () => {
  it('retains the selected record through loading and failed refreshes', () => {
    const onConfirmedAbsent = vi.fn();
    const guide = record('guide');
    const { result, rerender } = renderHook(
      (props: Props) => useKnowledgeSelectionReconciliation(props),
      {
        initialProps: state([guide], { selectedDocumentId: 'guide', onConfirmedAbsent }),
      },
    );

    rerender(state([], { selectedDocumentId: 'guide', loading: true, onConfirmedAbsent }));
    expect(result.current.selectedDocument).toEqual(guide);

    rerender(state([], { selectedDocumentId: 'guide', error: 'offline', onConfirmedAbsent }));
    expect(result.current.selectedDocument).toEqual(guide);
    expect(onConfirmedAbsent).not.toHaveBeenCalled();
  });

  it('clears only after an authoritative refetch confirms absence', async () => {
    const onConfirmedAbsent = vi.fn();
    const refetch = vi.fn(async () => undefined);
    const { rerender } = renderHook((props: Props) => useKnowledgeSelectionReconciliation(props), {
      initialProps: state([record('guide')], {
        selectedDocumentId: 'guide',
        refetch,
        onConfirmedAbsent,
      }),
    });

    act(() => {
      rerender(state([], { selectedDocumentId: 'guide', refetch, onConfirmedAbsent }));
    });

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(onConfirmedAbsent).toHaveBeenCalledOnce());
  });

  it('keeps the selected record when the authoritative refetch fails', async () => {
    const onConfirmedAbsent = vi.fn();
    const refetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const guide = record('guide');
    const { result, rerender } = renderHook(
      (props: Props) => useKnowledgeSelectionReconciliation(props),
      {
        initialProps: state([guide], {
          selectedDocumentId: 'guide',
          refetch,
          onConfirmedAbsent,
        }),
      },
    );

    rerender(state([], { selectedDocumentId: 'guide', refetch, onConfirmedAbsent }));

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(result.current.selectedDocument).toEqual(guide);
    expect(onConfirmedAbsent).not.toHaveBeenCalled();
  });
});
