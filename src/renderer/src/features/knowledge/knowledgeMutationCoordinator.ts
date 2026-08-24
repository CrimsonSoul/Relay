import type { PublicPrivilegedCommandRequest } from '@shared/ipc';
import {
  knowledgeCategoryKey,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentType,
  type KnowledgeManagementSnapshot,
} from '@shared/knowledge';

export type KnowledgeMutationConfirmation = (snapshot: KnowledgeManagementSnapshot) => boolean;
export type KnowledgeConfirmationCollection = 'documents' | 'trash' | 'uploads';
export type KnowledgeDocumentAssignment = { documentId: string; expectedRevision: number };

export type KnowledgeMutationExecutor = (
  request: PublicPrivilegedCommandRequest,
  busyKey: string,
  confirmation?: KnowledgeMutationConfirmation,
  confirmationCollections?: KnowledgeConfirmationCollection[],
  requireAudit?: boolean,
) => Promise<boolean>;

function confirmsDocumentAssignments(
  authoritative: KnowledgeManagementSnapshot,
  documents: KnowledgeDocumentAssignment[],
  categoryId: string,
): boolean {
  return documents.every(({ documentId, expectedRevision }) => {
    const current = authoritative.documents.items.find(({ id }) => id === documentId);
    return current?.categoryId === categoryId && current.revision > expectedRevision;
  });
}

export function createKnowledgeMutationActions({
  execute,
  snapshot,
}: {
  execute: KnowledgeMutationExecutor;
  snapshot: KnowledgeManagementSnapshot | null;
}) {
  return {
    retrySearchIndex: (documentId: string) =>
      execute(
        {
          command: 'knowledge.document.search-index.retry',
          payload: { documentId },
          expectedRevision: null,
        },
        `search-index:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) => document.id === documentId && document.searchIndexState !== 'failed',
          ),
        ['documents'],
        false,
      ),
    publish: (
      uploadId: string,
      title: string,
      category: string,
      documentType: KnowledgeDocumentType = 'sop',
    ) =>
      execute(
        {
          command: 'knowledge.document.publish',
          payload: { uploadId, title, category, documentType },
          expectedRevision: null,
        },
        `publish:${uploadId}`,
        (authoritative) =>
          !authoritative.uploads.items.some(
            ({ id, state }) => id === uploadId && state !== 'published',
          ) &&
          authoritative.documents.items.some(
            (document) =>
              document.lifecycleState === 'active' &&
              document.displayTitle === title.trim().replace(/\s+/g, ' ') &&
              knowledgeCategoryKey(document.category) === knowledgeCategoryKey(category) &&
              document.documentType === documentType,
          ),
        ['documents', 'uploads'],
        true,
      ),
    replace: (uploadId: string, documentId: string, expectedRevision: number) => {
      const current = snapshot?.documents.items.find(({ id }) => id === documentId);
      return execute(
        {
          command: 'knowledge.document.replace',
          payload: { uploadId, documentId, expectedRevision },
          expectedRevision: null,
        },
        `replace:${documentId}`,
        (authoritative) =>
          !authoritative.uploads.items.some(
            ({ id, state }) => id === uploadId && state !== 'published',
          ) &&
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              (!current ||
                (document.displayTitle === current.displayTitle &&
                  document.categoryId === current.categoryId &&
                  document.documentType === current.documentType &&
                  document.fileName === current.fileName &&
                  document.publishedAt === current.publishedAt &&
                  document.publishedByName === current.publishedByName)),
          ),
        ['documents', 'uploads'],
        true,
      );
    },
    setTitle: (documentId: string, expectedRevision: number, title: string) =>
      execute(
        {
          command: 'knowledge.document.title.set',
          payload: { documentId, expectedRevision, title },
          expectedRevision: null,
        },
        `title:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              document.displayTitle === title,
          ),
      ),
    setCategory: (documentId: string, expectedRevision: number, category: string) =>
      execute(
        {
          command: 'knowledge.document.category.set',
          payload: { documentId, expectedRevision, category },
          expectedRevision: null,
        },
        `category:${documentId}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (document) =>
              document.id === documentId &&
              document.revision > expectedRevision &&
              document.category === category,
          ),
      ),
    renameCategory: (from: string, to: string, expectedDocumentRevisions: Record<string, number>) =>
      execute(
        {
          command: 'knowledge.category.rename',
          payload: { from, to, expectedDocumentRevisions },
          expectedRevision: null,
        },
        `category:${from}`,
        (authoritative) =>
          authoritative.categories.some(({ name }) => name === to) &&
          !authoritative.categories.some(({ name }) => name === from) &&
          !authoritative.documents.items.some(({ category }) => category === from),
      ),
    createCategory: (name: string, afterCategoryId: string | null) =>
      execute(
        {
          command: 'knowledge.category.create',
          payload: { name, afterCategoryId },
          expectedRevision: null,
        },
        'category:create',
        (authoritative) => authoritative.categories.some(({ name: current }) => current === name),
      ),
    setCategoryName: (categoryId: string, name: string, expectedRevision: number) =>
      execute(
        {
          command: 'knowledge.category.name.set',
          payload: { categoryId, name, expectedRevision },
          expectedRevision: null,
        },
        `category:name:${categoryId}`,
        (authoritative) =>
          authoritative.categories.some(
            (category) =>
              category.id === categoryId &&
              category.name === name &&
              category.revision > expectedRevision,
          ),
      ),
    setCategoryOrder: (categories: KnowledgeCategoryRecord[]) =>
      execute(
        {
          command: 'knowledge.category.order.set',
          payload: {
            orderedCategoryIds: categories.map(({ id }) => id),
            expectedRevisions: Object.fromEntries(
              categories.map(({ id, revision }) => [id, revision]),
            ),
          },
          expectedRevision: null,
        },
        'category:order',
        (authoritative) => {
          const expectedIds = categories.map(({ id }) => id);
          return (
            authoritative.categories.length === expectedIds.length &&
            authoritative.categories.every(({ id }, index) => id === expectedIds[index])
          );
        },
      ),
    deleteCategory: (
      categoryId: string,
      replacementCategoryId: string,
      expectedRevision: number,
      expectedDocumentRevisions: Record<string, number>,
    ) =>
      execute(
        {
          command: 'knowledge.category.delete',
          payload: {
            categoryId,
            replacementCategoryId,
            expectedRevision,
            expectedDocumentRevisions,
          },
          expectedRevision: null,
        },
        `category:delete:${categoryId}`,
        (authoritative) =>
          !authoritative.categories.some(({ id }) => id === categoryId) &&
          !authoritative.documents.items.some(
            ({ categoryId: currentCategoryId }) => currentCategoryId === categoryId,
          ),
      ),
    setDocumentMetadata: (
      document: { id: string; revision: number },
      title: string,
      categoryId: string,
      documentType: KnowledgeDocumentType,
    ) =>
      execute(
        {
          command: 'knowledge.document.metadata.set',
          payload: {
            documentId: document.id,
            title,
            categoryId,
            documentType,
            expectedRevision: document.revision,
          },
          expectedRevision: null,
        },
        `metadata:${document.id}`,
        (authoritative) =>
          authoritative.documents.items.some(
            (current) =>
              current.id === document.id &&
              current.revision > document.revision &&
              current.displayTitle === title &&
              current.categoryId === categoryId &&
              current.documentType === documentType,
          ),
      ),
    assignDocumentCategories: (categoryId: string, documents: KnowledgeDocumentAssignment[]) =>
      execute(
        {
          command: 'knowledge.documents.category.assign',
          payload: { categoryId, documents },
          expectedRevision: null,
        },
        'documents:category',
        (authoritative) => confirmsDocumentAssignments(authoritative, documents, categoryId),
      ),
    trash: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.trash', payload, expectedRevision: null },
        `trash:${payload.documentId}`,
        (authoritative) =>
          !authoritative.documents.items.some(({ id }) => id === payload.documentId) &&
          authoritative.trash.items.some(
            (document) =>
              document.id === payload.documentId &&
              document.revision > payload.expectedRevision &&
              document.lifecycleState === 'trashed',
          ),
      ),
    restore: (payload: { documentId: string; expectedRevision: number }) =>
      execute(
        { command: 'knowledge.document.restore', payload, expectedRevision: null },
        `restore:${payload.documentId}`,
        (authoritative) =>
          !authoritative.trash.items.some(({ id }) => id === payload.documentId) &&
          authoritative.documents.items.some(
            (document) =>
              document.id === payload.documentId &&
              document.revision > payload.expectedRevision &&
              document.lifecycleState === 'active',
          ),
      ),
  };
}
