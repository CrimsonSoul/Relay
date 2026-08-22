export type KnowledgePdfViewMode = 'continuous' | 'single';

export const KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY = 'relay.knowledge.pdfViewMode';

export function loadKnowledgePdfViewMode(): KnowledgePdfViewMode {
  try {
    return globalThis.localStorage.getItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY) === 'single'
      ? 'single'
      : 'continuous';
  } catch {
    return 'continuous';
  }
}

export function persistKnowledgePdfViewMode(mode: KnowledgePdfViewMode): void {
  try {
    globalThis.localStorage.setItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // A blocked preference store must not block PDF reading.
  }
}
