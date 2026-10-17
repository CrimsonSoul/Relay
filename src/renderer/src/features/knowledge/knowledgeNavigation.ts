export const OPEN_KNOWLEDGE_DOCUMENT_EVENT = 'relay:open-knowledge-document';

export type KnowledgeOpenRequest = {
  documentId: string;
  headingId?: string;
  pageIndex?: number;
  highlightText?: string;
  normalizedStart?: number;
  normalizedEnd?: number;
};

let pendingRequest: KnowledgeOpenRequest | null = null;

export function requestKnowledgeDocumentOpen(request: KnowledgeOpenRequest): void {
  const normalizedId = request.documentId.trim();
  if (!normalizedId) return;
  const offsets = [request.pageIndex, request.normalizedStart, request.normalizedEnd];
  if (offsets.some((offset) => offset !== undefined && !isSafeNonNegativeInteger(offset))) return;

  const normalizedHeadingId = request.headingId?.trim() || undefined;
  const normalizedHighlightText = request.highlightText?.trim() || undefined;
  pendingRequest = {
    documentId: normalizedId,
    ...(normalizedHeadingId ? { headingId: normalizedHeadingId } : {}),
    ...(request.pageIndex !== undefined ? { pageIndex: request.pageIndex } : {}),
    ...(normalizedHighlightText ? { highlightText: normalizedHighlightText } : {}),
    ...(request.normalizedStart !== undefined ? { normalizedStart: request.normalizedStart } : {}),
    ...(request.normalizedEnd !== undefined ? { normalizedEnd: request.normalizedEnd } : {}),
  };
  globalThis.dispatchEvent(
    new CustomEvent(OPEN_KNOWLEDGE_DOCUMENT_EVENT, { detail: { ...pendingRequest } }),
  );
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function getPendingKnowledgeDocumentOpen(): KnowledgeOpenRequest | null {
  return pendingRequest ? { ...pendingRequest } : null;
}

export function acknowledgeKnowledgeDocumentOpen(documentId: string): void {
  if (pendingRequest?.documentId === documentId) pendingRequest = null;
}
