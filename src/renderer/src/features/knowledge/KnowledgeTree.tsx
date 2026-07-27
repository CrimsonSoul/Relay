import { useEffect, useState, type KeyboardEvent } from 'react';
import type { KnowledgeDocumentRecord, KnowledgeOutlineNode } from '@shared/knowledge';
import type { KnowledgeCategoryGroup } from './knowledgeModel';

type Props = {
  groups: KnowledgeCategoryGroup[];
  selectedDocumentId: string | null;
  activeHeadingId: string | null;
  expandMatches?: boolean;
  onSelectDocument: (document: KnowledgeDocumentRecord) => void;
  onSelectHeading: (heading: KnowledgeOutlineNode) => void;
};

const CATEGORY_KEY_SEPARATOR = '\u0000';

function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

function selectHeading(
  handler: (heading: KnowledgeOutlineNode) => void,
  heading: KnowledgeOutlineNode,
): () => void {
  return () => handler(heading);
}

function visibleTreeItems(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

function parentTreeItem(tree: HTMLElement, item: HTMLElement): HTMLElement | null {
  const parentDocumentId = item.dataset.parentDocumentId;
  if (parentDocumentId) {
    return (
      visibleTreeItems(tree).find(
        (candidate) =>
          candidate.dataset.nodeType === 'document' &&
          candidate.dataset.documentId === parentDocumentId,
      ) ?? null
    );
  }
  const category = item.dataset.category;
  return (
    visibleTreeItems(tree).find(
      (candidate) =>
        candidate.dataset.nodeType === 'category' && candidate.dataset.category === category,
    ) ?? null
  );
}

function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const tree = event.currentTarget;
  const items = visibleTreeItems(tree);
  const current = globalThis.document.activeElement as HTMLElement;
  const currentIndex = items.indexOf(current);
  if (currentIndex < 0) return;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (current.getAttribute('aria-expanded') === 'false') current.click();
    else items[currentIndex + 1]?.focus();
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (
      current.dataset.nodeType === 'category' &&
      current.getAttribute('aria-expanded') === 'true'
    ) {
      current.click();
    } else {
      parentTreeItem(tree, current)?.focus();
    }
    return;
  }

  let nextIndex = currentIndex;
  if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, currentIndex + 1);
  if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;
  event.preventDefault();
  items[nextIndex]?.focus();
}

export function KnowledgeTree({
  groups,
  selectedDocumentId,
  activeHeadingId,
  expandMatches = false,
  onSelectDocument,
  onSelectHeading,
}: Readonly<Props>) {
  const selectedCategory = groups.find((group) =>
    group.documents.some((document) => document.id === selectedDocumentId),
  )?.category;
  const initialCategory = selectedCategory ?? groups[0]?.category;
  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<string>>(
    () => new Set(initialCategory === undefined ? [] : [initialCategory]),
  );
  // A filtered sidebar reports matches across every category, so none of them may stay hidden.
  const matchedCategoryKey = expandMatches
    ? groups.map(({ category }) => category).join(CATEGORY_KEY_SEPARATOR)
    : '';

  useEffect(() => {
    if (!matchedCategoryKey) return;
    setExpandedCategories(new Set(matchedCategoryKey.split(CATEGORY_KEY_SEPARATOR)));
  }, [matchedCategoryKey]);

  useEffect(() => {
    if (selectedCategory && !expandMatches) setExpandedCategories(new Set([selectedCategory]));
  }, [expandMatches, selectedCategory]);

  return (
    <div
      className="knowledge-tree"
      role="tree"
      tabIndex={-1}
      aria-label="Knowledge categories and documents"
      onKeyDown={handleTreeKeyDown}
    >
      {groups.map((group) => {
        const isExpanded = expandedCategories.has(group.category);
        const isSelectedCategory = group.category === selectedCategory;
        return (
          <section className="knowledge-category" key={group.category} role="none">
            <button
              type="button"
              role="treeitem"
              aria-level={1}
              aria-selected={isSelectedCategory}
              className="knowledge-category__button"
              aria-expanded={isExpanded}
              aria-label={`${group.category}, ${itemCountLabel(group.documents.length)}`}
              data-node-type="category"
              data-category={group.category}
              onClick={() =>
                setExpandedCategories((current) => {
                  const next = new Set(current);
                  if (isExpanded) next.delete(group.category);
                  else next.add(group.category);
                  return next;
                })
              }
            >
              <span className="knowledge-category__chevron" aria-hidden="true">
                {isExpanded ? '−' : '+'}
              </span>
              <span>{group.category}</span>
              <span className="knowledge-category__count">{group.documents.length}</span>
            </button>
            {isExpanded && (
              <div className="knowledge-category__items" role="group">
                {group.documents.map((document) => {
                  const isSelected = document.id === selectedDocumentId;
                  return (
                    <div className="knowledge-document-node" key={document.id} role="none">
                      <button
                        type="button"
                        role="treeitem"
                        aria-label={document.title}
                        aria-level={2}
                        aria-selected={isSelected}
                        aria-current={isSelected ? 'page' : undefined}
                        aria-expanded={isSelected && document.outline.length > 0}
                        className="knowledge-document-node__button"
                        data-node-type="document"
                        data-document-id={document.id}
                        data-category={group.category}
                        onClick={() => onSelectDocument(document)}
                      >
                        <span className="knowledge-document-node__mark" aria-hidden="true" />
                        <span className="knowledge-document-node__title">{document.title}</span>
                        <span className="knowledge-document-node__pages">
                          {document.pageCount}p
                        </span>
                      </button>
                      {isSelected && document.outline.length > 0 && (
                        <div className="knowledge-outline" role="group">
                          {document.outline.map((heading) => (
                            <button
                              type="button"
                              role="treeitem"
                              aria-label={`${heading.label}, page ${heading.pageIndex + 1}`}
                              aria-level={heading.level + 2}
                              aria-selected={activeHeadingId === heading.id}
                              aria-current={activeHeadingId === heading.id ? 'location' : undefined}
                              className="knowledge-outline__button"
                              data-level={heading.level}
                              data-node-type="heading"
                              data-parent-document-id={document.id}
                              data-category={group.category}
                              key={heading.id}
                              onClick={selectHeading(onSelectHeading, heading)}
                            >
                              <span className="knowledge-outline__rule" aria-hidden="true" />
                              <span>{heading.label}</span>
                              <span className="knowledge-outline__page">
                                {heading.pageIndex + 1}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
