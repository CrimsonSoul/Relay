import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { useKnowledgeCover } from './useKnowledgeCover';

export function KnowledgeSopCard({
  document,
  onOpen,
}: Readonly<{
  document: KnowledgeDocumentRecord;
  onOpen: (documentId: string) => void;
}>) {
  const cover = useKnowledgeCover({ documentId: document.id, checksum: document.checksum });
  return (
    <button
      type="button"
      className="knowledge-sop-card"
      aria-label={`Open ${document.displayTitle}`}
      onClick={() => onOpen(document.id)}
    >
      <div ref={cover.ref} className="knowledge-sop-card__cover" data-state={cover.state}>
        {cover.url ? (
          <img src={cover.url} alt="" />
        ) : (
          <div className="knowledge-sop-card__fallback" aria-hidden="true">
            <span>SOP</span>
            <strong>{document.displayTitle.slice(0, 1)}</strong>
          </div>
        )}
      </div>
      <span className="knowledge-sop-card__body">
        <strong>{document.displayTitle}</strong>
        <span>{document.pageCount} pages</span>
      </span>
    </button>
  );
}
