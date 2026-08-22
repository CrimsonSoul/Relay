import type { KnowledgeDocumentRecord, KnowledgeOutlineNode } from '@shared/knowledge';

export function KnowledgeContents({
  document,
  activeHeadingId,
  onSelectHeading,
}: Readonly<{
  document: KnowledgeDocumentRecord;
  activeHeadingId: string | null;
  onSelectHeading: (heading: KnowledgeOutlineNode) => void;
}>) {
  return (
    <nav className="knowledge-contents" aria-label={`Contents of ${document.displayTitle}`}>
      <div className="knowledge-contents__heading">
        <span>In this guide</span>
        <span>{document.pageCount} pages</span>
      </div>
      {document.outline.length > 0 ? (
        <div className="knowledge-outline knowledge-outline--contents">
          {document.outline.map((heading) => (
            <button
              type="button"
              aria-label={`${heading.label}, page ${heading.pageIndex + 1}`}
              aria-current={activeHeadingId === heading.id ? 'location' : undefined}
              className="knowledge-outline__button"
              data-level={heading.level}
              key={heading.id}
              onClick={() => onSelectHeading(heading)}
            >
              <span className="knowledge-outline__rule" aria-hidden="true" />
              <span>{heading.label}</span>
              <span className="knowledge-outline__page">{heading.pageIndex + 1}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="knowledge-contents__empty">
          <strong>No section index</strong>
          <span>Use the page controls above the document to move through this guide.</span>
        </div>
      )}
    </nav>
  );
}
