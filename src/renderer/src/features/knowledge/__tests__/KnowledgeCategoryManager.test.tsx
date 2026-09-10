import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('announces validation and returns focus after cancelling a destructive editor', async () => {
    render(
      <KnowledgeCategoryManager
        categories={categories}
        documents={
          [
            { id: 'document-1', categoryId: 'operations', revision: 3 },
          ] as KnowledgeManagementDocumentView[]
        }
        busy={null}
        createCategory={vi.fn()}
        setCategoryName={vi.fn()}
        setCategoryOrder={vi.fn()}
        deleteCategory={vi.fn()}
      />,
    );

    const newCategory = screen.getByRole('textbox', { name: 'New category name' });
    fireEvent.change(newCategory, { target: { value: '   ' } });
    fireEvent.submit(newCategory.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a category name.');
    expect(newCategory).toHaveAttribute('aria-invalid', 'true');
    expect(newCategory).toHaveFocus();

    const deleteOperations = screen.getByRole('button', { name: 'Delete Operations' });
    fireEvent.click(deleteOperations);
    expect(screen.getByRole('combobox', { name: 'Reassign documents to' })).toHaveValue(
      'uncategorized',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Operations' })).toHaveFocus(),
    );
  });

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

it('lets pristine names follow refreshes and preserves dirty drafts base revisions', () => {
  const actions = {
    createCategory: vi.fn(),
    setCategoryName: vi.fn(),
    setCategoryOrder: vi.fn(),
    deleteCategory: vi.fn(),
  };
  const { rerender } = render(
    <KnowledgeCategoryManager categories={categories} documents={[]} busy={null} {...actions} />,
  );
  const next = categories.map((category) =>
    category.id === 'operations' ? { ...category, name: 'NOC', revision: 3 } : category,
  );
  rerender(<KnowledgeCategoryManager categories={next} documents={[]} busy={null} {...actions} />);
  expect(screen.getByRole('textbox', { name: 'Category name NOC' })).toHaveValue('NOC');
  fireEvent.change(screen.getByRole('textbox', { name: 'Category name NOC' }), {
    target: { value: 'My draft' },
  });
  const latest = next.map((category) =>
    category.id === 'operations' ? { ...category, name: 'New NOC', revision: 4 } : category,
  );
  rerender(
    <KnowledgeCategoryManager categories={latest} documents={[]} busy={null} {...actions} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save New NOC' }));
  expect(actions.setCategoryName).toHaveBeenCalledWith('operations', 'My draft', 3);
});

it('loads complete affected revisions before showing the delete confirmation', async () => {
  const documents = [
    { id: 'active', categoryId: 'operations', revision: 3 },
  ] as KnowledgeManagementDocumentView[];
  const affected = [
    ...documents,
    { ...documents[0]!, id: 'trashed', revision: 5, lifecycleState: 'trashed' as const },
  ];
  const actions = {
    createCategory: vi.fn(),
    setCategoryName: vi.fn(),
    setCategoryOrder: vi.fn(),
    deleteCategory: vi.fn(),
  };
  let resolveDocuments!: (value: KnowledgeManagementDocumentView[]) => void;
  const readCategoryDocuments = vi.fn(
    () =>
      new Promise<KnowledgeManagementDocumentView[]>((resolve) => {
        resolveDocuments = resolve;
      }),
  );
  render(
    <KnowledgeCategoryManager
      categories={categories}
      documents={documents}
      busy={null}
      readCategoryDocuments={readCategoryDocuments}
      {...actions}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete Operations' }));
  expect(screen.queryByRole('button', { name: 'Confirm delete Operations' })).toBeNull();
  resolveDocuments(affected);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm delete Operations' })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Operations' }));
  expect(actions.deleteCategory).toHaveBeenCalledWith('operations', 'uncategorized', 2, {
    active: 3,
    trashed: 5,
  });
});
