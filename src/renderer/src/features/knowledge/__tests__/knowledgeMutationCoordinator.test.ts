import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeManagementSnapshot } from '@shared/knowledge';
import {
  createKnowledgeMutationActions,
  type KnowledgeMutationExecutor,
} from '../knowledgeMutationCoordinator';

const snapshot: KnowledgeManagementSnapshot = {
  mode: 'managed',
  categories: [],
  documents: { items: [], nextCursor: null },
  trash: { items: [], nextCursor: null },
  uploads: { items: [], nextCursor: null },
};

describe('createKnowledgeMutationActions', () => {
  it('coordinates publish commands and their authoritative confirmation predicate', async () => {
    const execute = vi.fn<KnowledgeMutationExecutor>(async () => true);
    const actions = createKnowledgeMutationActions({ execute, snapshot });

    await actions.publish('upload-1', '  Runbook  ', 'Operations', 'sop');

    expect(execute).toHaveBeenCalledWith(
      {
        command: 'knowledge.document.publish',
        payload: {
          uploadId: 'upload-1',
          title: '  Runbook  ',
          category: 'Operations',
          documentType: 'sop',
        },
        expectedRevision: null,
      },
      'publish:upload-1',
      expect.any(Function),
      ['documents', 'uploads'],
      true,
    );
    const confirmation = execute.mock.calls[0]?.[2];
    expect(
      confirmation?.({
        ...snapshot,
        documents: {
          items: [
            {
              id: 'document-1',
              checksum: 'a'.repeat(64),
              category: 'Operations',
              categoryId: 'category-operations',
              documentType: 'sop',
              displayTitle: 'Runbook',
              fileName: 'Runbook.pdf',
              byteSize: 100,
              pageCount: 3,
              lifecycleState: 'active',
              revision: 1,
              publishedByName: 'Wiki Publisher',
              publishedAt: '2026-07-16T01:00:00.000Z',
              trashedByName: null,
              trashedAt: null,
              searchIndexState: 'ready',
              searchIndexChecksum: 'a'.repeat(64),
              searchIndexVersion: 1,
              searchIndexedAt: '2026-07-16T01:00:00.000Z',
              searchIndexError: null,
              updated: '2026-07-16T01:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      }),
    ).toBe(true);
  });
});
