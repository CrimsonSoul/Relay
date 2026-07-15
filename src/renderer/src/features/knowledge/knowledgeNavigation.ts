export const OPEN_KNOWLEDGE_DOCUMENT_EVENT = 'relay:open-knowledge-document';

export type KnowledgeOpenRequest = {
  documentId: string;
  headingId?: string;
};

let pendingRequest: KnowledgeOpenRequest | null = null;

export function requestKnowledgeDocumentOpen(documentId: string, headingId?: string): void {
  const normalizedId = documentId.trim();
  if (!normalizedId) return;
  const normalizedHeadingId = headingId?.trim() || undefined;
  pendingRequest = { documentId: normalizedId, headingId: normalizedHeadingId };
  globalThis.dispatchEvent(
    new CustomEvent(OPEN_KNOWLEDGE_DOCUMENT_EVENT, { detail: pendingRequest }),
  );
}

export function getPendingKnowledgeDocumentOpen(): KnowledgeOpenRequest | null {
  return pendingRequest ? { ...pendingRequest } : null;
}

export function acknowledgeKnowledgeDocumentOpen(documentId: string): void {
  if (pendingRequest?.documentId === documentId) pendingRequest = null;
}
