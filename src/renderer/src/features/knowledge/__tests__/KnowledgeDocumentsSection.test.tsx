import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeManagementDocumentView } from '@shared/knowledge';
import { KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS } from '@shared/privilegedCommands';
import { KnowledgeDocumentsSection } from '../management/KnowledgeDocumentsSection';

function documentView(id: string, title: string): KnowledgeManagementDocumentView {
  return {
    id,
    displayTitle: title,
    fileName: `${id}.pdf`,
    category: 'Network',
    categoryId: 'cat_network',
    documentType: 'sop',
    pageCount: 4,
    searchIndexState: 'ready',
    publishedByName: 'Ada',
    publishedAt: '2026-09-01T12:00:00.000Z',
    revision: 1,
  } as unknown as KnowledgeManagementDocumentView;
}

const first = documentView('doc_1', 'Router guide');
const second = documentView('doc_2', 'Switch guide');
const categories = [{ id: 'cat_storage', name: 'Storage', normalizedName: 'storage' }] as never;

describe('KnowledgeDocumentsSection', () => {
  it('drops the selection of documents that leave the list', () => {
    const assignDocumentCategories = vi.fn(async () => true);
    const management = {
      snapshot: { documents: { items: [], nextCursor: null } },
      busy: null,
      assignDocumentCategories,
    } as never;
    const props = {
      active: true,
      management,
      categories,
      query: '',
      setQuery: vi.fn(),
      sectionContentRef: createRef<HTMLDivElement>(),
      openUploads: vi.fn(),
    };
    const view = render(<KnowledgeDocumentsSection {...props} documents={[first, second]} />);

    fireEvent.change(screen.getByLabelText('Bulk category'), {
      target: { value: 'cat_storage' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Router guide' }));

    view.rerender(<KnowledgeDocumentsSection {...props} documents={[second]} />);
    expect(screen.getByRole('button', { name: /^Move/ })).toBeDisabled();

    view.rerender(<KnowledgeDocumentsSection {...props} documents={[first, second]} />);
    expect(screen.getByRole('checkbox', { name: 'Select Router guide' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Switch guide' }));
    fireEvent.click(screen.getByRole('button', { name: /^Move/ }));
    expect(assignDocumentCategories).toHaveBeenCalledWith('cat_storage', [
      { documentId: 'doc_2', expectedRevision: 1 },
    ]);
  });

  it('stops selecting at the bulk move limit the server accepts', () => {
    const assignDocumentCategories = vi.fn(
      async (_categoryId: string, _documents: readonly unknown[]) => true,
    );
    const documents = Array.from({ length: KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS + 1 }, (_, i) =>
      documentView(`doc_${i}`, `Guide ${i}`),
    );
    render(
      <KnowledgeDocumentsSection
        active
        management={
          {
            snapshot: { documents: { items: [], nextCursor: null } },
            busy: null,
            assignDocumentCategories,
          } as never
        }
        documents={documents}
        categories={categories}
        query=""
        setQuery={vi.fn()}
        sectionContentRef={createRef<HTMLDivElement>()}
        openUploads={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Bulk category'), {
      target: { value: 'cat_storage' },
    });
    const checkboxes = screen.getAllByLabelText(/^Select Guide /);
    for (const checkbox of checkboxes.slice(0, KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS)) {
      fireEvent.click(checkbox);
    }
    const overflow = checkboxes[KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS]!;
    expect(overflow).toHaveAttribute(
      'aria-label',
      `Select Guide ${KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS}`,
    );
    expect(overflow).toBeDisabled();
    fireEvent.click(overflow);
    expect(overflow).not.toBeChecked();
    expect(
      screen.getByText(`Up to ${KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS} documents per move`),
    ).toBeInTheDocument();

    // Role queries recompute accessible names for every row, so find the button by its label.
    fireEvent.click(
      screen.getByText(`Move ${KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS}`).closest('button')!,
    );
    expect(assignDocumentCategories).toHaveBeenCalledOnce();
    expect(assignDocumentCategories.mock.calls[0]?.[1]).toHaveLength(
      KNOWLEDGE_MAX_BULK_CATEGORY_ASSIGNMENTS,
    );
  }, 20_000);
});
