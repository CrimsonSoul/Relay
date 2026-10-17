import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { KnowledgeTree } from '../KnowledgeTree';
import type { KnowledgeCategoryGroup } from '../knowledgeModel';

function document(id: string, title: string, category: string): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `${category}/${title}.pdf`,
    category,
    categoryId: `category-${category.toLowerCase()}`,
    documentType: 'sop',
    title,
    displayTitle: title,
    fileName: `${title}.pdf`,
    pdf: `${title}.pdf`,
    cover: null,
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 3,
    outline: [
      { id: `${id}-h1`, label: 'First procedure', level: 1, pageIndex: 0, top: 700 },
      { id: `${id}-h2`, label: 'Verify recovery', level: 2, pageIndex: 1, top: 500 },
    ],
    outlineSource: 'native',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexState: 'ready',
    searchIndexChecksum: 'a'.repeat(64),
    searchIndexVersion: 1,
    searchIndexedAt: '2026-07-14T12:00:00.000Z',
    searchIndexError: null,
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'publisher',
    publishedByName: 'Paris',
    publishedAt: '2026-07-14T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

const groups: KnowledgeCategoryGroup[] = [
  { category: 'General', documents: [document('guide', 'Operator guide', 'General')] },
  { category: 'Systems', documents: [document('lane', 'Lane recovery', 'Systems')] },
];

describe('KnowledgeTree', () => {
  it('shows the selected document headings and routes document and heading selections', () => {
    const onSelectDocument = vi.fn();
    const onSelectHeading = vi.fn();
    render(
      <KnowledgeTree
        groups={groups}
        selectedDocumentId="guide"
        activeHeadingId="guide-h1"
        onSelectDocument={onSelectDocument}
        onSelectHeading={onSelectHeading}
      />,
    );

    expect(screen.getByRole('treeitem', { name: 'Operator guide' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('treeitem', { name: 'First procedure, page 1' })).toHaveAttribute(
      'aria-current',
      'location',
    );

    fireEvent.click(screen.getByRole('treeitem', { name: 'Verify recovery, page 2' }));
    expect(onSelectHeading).toHaveBeenCalledWith(groups[0]?.documents[0]?.outline[1]);

    fireEvent.click(screen.getByRole('treeitem', { name: 'Systems, 1 document' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Lane recovery' }));
    expect(onSelectDocument).toHaveBeenCalledWith(groups[1]?.documents[0]);
  });

  it('supports arrow-key focus movement across visible tree items', () => {
    render(
      <KnowledgeTree
        groups={groups}
        selectedDocumentId="guide"
        activeHeadingId={null}
        onSelectDocument={vi.fn()}
        onSelectHeading={vi.fn()}
      />,
    );

    const guide = screen.getByRole('treeitem', { name: 'Operator guide' });
    guide.focus();
    fireEvent.keyDown(guide, { key: 'ArrowDown' });
    expect(screen.getByRole('treeitem', { name: 'First procedure, page 1' })).toHaveFocus();
  });

  it('uses left and right arrows to expand, enter, and leave categories', () => {
    render(
      <KnowledgeTree
        groups={groups}
        selectedDocumentId="guide"
        activeHeadingId={null}
        onSelectDocument={vi.fn()}
        onSelectHeading={vi.fn()}
      />,
    );

    const systems = screen.getByRole('treeitem', { name: 'Systems, 1 document' });
    systems.focus();
    fireEvent.keyDown(systems, { key: 'ArrowRight' });
    expect(systems).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(systems, { key: 'ArrowRight' });
    expect(screen.getByRole('treeitem', { name: 'Lane recovery' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'Lane recovery' }), {
      key: 'ArrowLeft',
    });
    expect(systems).toHaveFocus();
  });

  it('never opens a document from the arrow keys and marks outline-less documents as leaves', () => {
    const onSelectDocument = vi.fn();
    const leaf = { ...document('leaf', 'Leaf note', 'Systems'), outline: [] };
    render(
      <KnowledgeTree
        groups={[groups[0]!, { category: 'Systems', documents: [groups[1]!.documents[0]!, leaf] }]}
        selectedDocumentId="guide"
        activeHeadingId={null}
        onSelectDocument={onSelectDocument}
        onSelectHeading={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('treeitem', { name: 'Systems, 2 documents' }));
    const lane = screen.getByRole('treeitem', { name: 'Lane recovery' });
    expect(lane).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('treeitem', { name: 'Leaf note' })).not.toHaveAttribute(
      'aria-expanded',
    );
    lane.focus();
    fireEvent.keyDown(lane, { key: 'ArrowRight' });

    expect(onSelectDocument).not.toHaveBeenCalled();
    expect(lane).toHaveFocus();
  });

  it('keeps a single tab stop that follows focus', () => {
    render(
      <KnowledgeTree
        groups={groups}
        selectedDocumentId="guide"
        activeHeadingId={null}
        onSelectDocument={vi.fn()}
        onSelectHeading={vi.fn()}
      />,
    );

    const tabStops = () =>
      screen.getAllByRole('treeitem').filter((item) => item.getAttribute('tabindex') === '0');
    const guide = screen.getByRole('treeitem', { name: 'Operator guide' });
    expect(tabStops()).toEqual([guide]);

    const systems = screen.getByRole('treeitem', { name: 'Systems, 1 document' });
    act(() => systems.focus());
    expect(tabStops()).toEqual([systems]);
  });
});
