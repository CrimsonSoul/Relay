import type { KnowledgeDocumentRecord } from '@shared/knowledge';

export function KnowledgeCheatsheetRow({
  document,
  onOpen,
}: Readonly<{
  document: KnowledgeDocumentRecord;
  onOpen: (documentId: string) => void;
}>) {
  return (
    <button
      type="button"
      className="knowledge-cheatsheet-row"
      aria-label={`Open ${document.displayTitle}`}
      onClick={() => onOpen(document.id)}
    >
      <span className="knowledge-cheatsheet-row__mark" aria-hidden="true">
        QG
      </span>
      <span className="knowledge-cheatsheet-row__copy">
        <strong>{document.displayTitle}</strong>
        <span>{document.category}</span>
      </span>
      <span className="knowledge-cheatsheet-row__meta">{document.pageCount}p</span>
      <span className="knowledge-cheatsheet-row__arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}
