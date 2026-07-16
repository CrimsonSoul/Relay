import { describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_UPLOADS_COLLECTION,
} from '@shared/knowledge';
import { KnowledgeManagementCleanup } from '../KnowledgeManagementCleanup';

const NOW = '2026-07-16T01:00:00.000Z';

describe('KnowledgeManagementCleanup', () => {
  it('expires staging uploads, records unfinished work, and never purges trash', async () => {
    const deleteUpload = vi.fn(async () => true);
    const createAudit = vi.fn(async () => ({}));
    const getAudits = vi.fn(async () => []);
    const deleteAudit = vi.fn(async () => true);
    const collection = vi.fn((name: string) => {
      if (name === KNOWLEDGE_UPLOADS_COLLECTION) {
        return {
          getFullList: vi.fn(async () => [
            {
              id: 'upload-ready',
              requestId: 'request-ready',
              fileName: 'Runbook.pdf',
              operatorId: 'operator-1',
              operatorName: 'Ryan Bledsoe',
              state: 'ready',
            },
            {
              id: 'upload-published',
              requestId: 'request-published',
              fileName: 'Published.pdf',
              operatorId: 'operator-1',
              operatorName: 'Ryan Bledsoe',
              state: 'published',
            },
          ]),
          delete: deleteUpload,
        };
      }
      if (name === KNOWLEDGE_AUDIT_EVENTS_COLLECTION) {
        return { getFullList: getAudits, create: createAudit, delete: deleteAudit };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    await new KnowledgeManagementCleanup({
      pb: { collection } as never,
      now: () => Date.parse(NOW),
    }).run();

    expect(collection).not.toHaveBeenCalledWith(KNOWLEDGE_DOCUMENTS_COLLECTION);
    expect(createAudit).toHaveBeenCalledOnce();
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-ready',
        action: 'upload-expired',
        fileName: 'Runbook.pdf',
        operatorName: 'Ryan Bledsoe',
      }),
      { requestKey: null },
    );
    expect(deleteUpload).toHaveBeenCalledTimes(2);
  });

  it('retains a full year of audit history and deletes only older events', async () => {
    const getFullList = vi.fn(async () => [{ id: 'audit-old' }]);
    const deleteAudit = vi.fn(async () => true);
    const collection = vi.fn((name: string) =>
      name === KNOWLEDGE_UPLOADS_COLLECTION
        ? { getFullList: vi.fn(async () => []), delete: vi.fn() }
        : { getFullList, create: vi.fn(), delete: deleteAudit },
    );

    await new KnowledgeManagementCleanup({
      pb: { collection } as never,
      now: () => Date.parse(NOW),
    }).run();

    const oneYearAgo = new Date(Date.parse(NOW) - 365 * 24 * 60 * 60 * 1_000).toISOString();
    expect(getFullList).toHaveBeenCalledWith({
      filter: `occurredAt < "${oneYearAgo}"`,
      requestKey: null,
    });
    expect(deleteAudit).toHaveBeenCalledWith('audit-old', { requestKey: null });
  });
});
