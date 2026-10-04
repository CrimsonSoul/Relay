import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeManagementDocumentView } from '@shared/knowledge';
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
});
