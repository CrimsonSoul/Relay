import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeCategoryRecord, KnowledgeManagementDocumentView } from '@shared/knowledge';
import { KnowledgeCategoryManager } from '../KnowledgeCategoryManager';

const categories: KnowledgeCategoryRecord[] = [
  {
    id: 'operations',
    name: 'Operations',
    normalizedName: 'operations',
    sortOrder: 100,
    systemKey: '',
    revision: 2,
    created: '2026-07-18T12:00:00.000Z',
    updated: '2026-07-18T12:00:00.000Z',
  },
  {
    id: 'uncategorized',
    name: 'Uncategorized',
    normalizedName: 'uncategorized',
    sortOrder: 200,
    systemKey: 'uncategorized',
    revision: 1,
    created: '2026-07-18T12:00:00.000Z',
    updated: '2026-07-18T12:00:00.000Z',
  },
];

describe('KnowledgeCategoryManager', () => {
  it('creates, renames, reorders, and safely deletes categories with reassignment', () => {
    const actions = {
      createCategory: vi.fn(),
      setCategoryName: vi.fn(),
      setCategoryOrder: vi.fn(),
      deleteCategory: vi.fn(),
    };
    const documents = [
      { id: 'document-1', categoryId: 'operations', revision: 3 },
    ] as KnowledgeManagementDocumentView[];
    render(
      <KnowledgeCategoryManager
        categories={categories}
        documents={documents}
        busy={null}
        {...actions}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'New category name' }), {
      target: { value: 'Network' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    expect(actions.createCategory).toHaveBeenCalledWith('Network', 'uncategorized');

    fireEvent.change(screen.getByRole('textbox', { name: 'Category name Operations' }), {
      target: { value: 'NOC Operations' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Operations' }));
    expect(actions.setCategoryName).toHaveBeenCalledWith('operations', 'NOC Operations', 2);

    fireEvent.click(screen.getByRole('button', { name: 'Move Uncategorized up' }));
    expect(actions.setCategoryOrder).toHaveBeenCalledWith([categories[1], categories[0]]);

    expect(screen.getByRole('button', { name: 'Delete Uncategorized' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Operations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Operations' }));
    expect(actions.deleteCategory).toHaveBeenCalledWith('operations', 'uncategorized', 2, {
      'document-1': 3,
    });
  });
});
