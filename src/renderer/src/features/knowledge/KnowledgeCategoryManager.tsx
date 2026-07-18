import { useEffect, useMemo, useState } from 'react';
import type { KnowledgeCategoryRecord, KnowledgeManagementDocumentView } from '@shared/knowledge';
import { TactileButton } from '../../components/TactileButton';

type Result = boolean | void | Promise<boolean | void>;

export function KnowledgeCategoryManager({
  categories,
  documents,
  busy,
  createCategory,
  setCategoryName,
  setCategoryOrder,
  deleteCategory,
}: Readonly<{
  categories: KnowledgeCategoryRecord[];
  documents: KnowledgeManagementDocumentView[];
  busy: string | null;
  createCategory: (name: string, afterCategoryId: string | null) => Result;
  setCategoryName: (categoryId: string, name: string, expectedRevision: number) => Result;
  setCategoryOrder: (categories: KnowledgeCategoryRecord[]) => Result;
  deleteCategory: (
    categoryId: string,
    replacementCategoryId: string,
    expectedRevision: number,
    expectedDocumentRevisions: Record<string, number>,
  ) => Result;
}>) {
  const [newName, setNewName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const counts = useMemo(
    () =>
      documents.reduce<Record<string, number>>((result, document) => {
        if (document.categoryId)
          result[document.categoryId] = (result[document.categoryId] ?? 0) + 1;
        return result;
      }, {}),
    [documents],
  );

  useEffect(() => {
    setNames(Object.fromEntries(categories.map(({ id, name }) => [id, name])));
  }, [categories]);

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= categories.length) return;
    const ordered = [...categories];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await setCategoryOrder(ordered);
  };

  const beginDelete = (category: KnowledgeCategoryRecord) => {
    const replacement = categories.find(({ id }) => id !== category.id);
    if (!replacement) return;
    setDeletingId(category.id);
    setReplacementId(replacement.id);
  };

  return (
    <section className="knowledge-category-manager" aria-labelledby="knowledge-categories-title">
      <div className="knowledge-management-section-heading">
        <div>
          <h2 id="knowledge-categories-title">Categories</h2>
          <p>
            Control the catalog order and where documents live. Uncategorized always remains
            available.
          </p>
        </div>
        <form
          className="knowledge-category-manager__create"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!newName.trim()) return;
            await createCategory(newName, categories.at(-1)?.id ?? null);
            setNewName('');
          }}
        >
          <label>
            <span>New category</span>
            <input
              aria-label="New category name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Category name"
            />
          </label>
          <TactileButton
            size="sm"
            variant="primary"
            type="submit"
            disabled={!newName.trim()}
            loading={busy === 'category:create'}
          >
            Add category
          </TactileButton>
        </form>
      </div>

      <div className="knowledge-category-manager__list">
        {categories.map((category, index) => {
          const isDeleting = deletingId === category.id;
          const name = names[category.id] ?? category.name;
          const documentRevisions = Object.fromEntries(
            documents
              .filter(({ categoryId }) => categoryId === category.id)
              .map(({ id, revision }) => [id, revision]),
          );
          return (
            <article className="knowledge-category-manager__row" key={category.id}>
              <div className="knowledge-category-manager__order">
                <button
                  type="button"
                  aria-label={`Move ${category.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${category.name} down`}
                  disabled={index === categories.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
              <label className="knowledge-category-manager__name">
                <span>
                  {category.systemKey === 'uncategorized' ? 'Fallback category' : 'Category'}
                </span>
                <input
                  aria-label={`Category name ${category.name}`}
                  value={name}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [category.id]: event.target.value }))
                  }
                />
              </label>
              <span className="knowledge-category-manager__count">
                {counts[category.id] ?? 0} documents
              </span>
              <div className="knowledge-category-manager__actions">
                <TactileButton
                  size="sm"
                  disabled={!name.trim() || name.trim() === category.name}
                  loading={busy === `category:name:${category.id}`}
                  aria-label={`Save ${category.name}`}
                  onClick={async () => setCategoryName(category.id, name, category.revision)}
                >
                  Save
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="danger"
                  className="knowledge-management__danger-outline"
                  aria-label={`Delete ${category.name}`}
                  disabled={category.systemKey === 'uncategorized' || categories.length < 2}
                  onClick={() => beginDelete(category)}
                >
                  Delete
                </TactileButton>
              </div>
              {isDeleting && (
                <div
                  className="knowledge-category-manager__delete"
                  role="group"
                  aria-label={`Delete ${category.name}`}
                >
                  <label>
                    Reassign documents to
                    <select
                      value={replacementId}
                      onChange={(event) => setReplacementId(event.target.value)}
                    >
                      {categories
                        .filter(({ id }) => id !== category.id)
                        .map((replacement) => (
                          <option key={replacement.id} value={replacement.id}>
                            {replacement.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <TactileButton size="sm" onClick={() => setDeletingId(null)}>
                    Cancel
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    variant="danger"
                    aria-label={`Confirm delete ${category.name}`}
                    disabled={!replacementId}
                    loading={busy === `category:delete:${category.id}`}
                    onClick={async () =>
                      deleteCategory(
                        category.id,
                        replacementId,
                        category.revision,
                        documentRevisions,
                      )
                    }
                  >
                    Reassign and delete
                  </TactileButton>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
