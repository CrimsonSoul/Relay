import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [newNameError, setNewNameError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const newNameRef = useRef<HTMLInputElement>(null);
  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  const counts = useMemo(
    () =>
      documents.reduce<Record<string, number>>((result, document) => {
        if (document.categoryId)
          result[document.categoryId] = (result[document.categoryId] ?? 0) + 1;
        return result;
      }, {}),
    [documents],
  );

  // Seed only categories without a draft. A refresh (including the two-second upload poll) must
  // never overwrite a rename the operator is still typing.
  useEffect(() => {
    setNames((current) =>
      Object.fromEntries(categories.map(({ id, name }) => [id, current[id] ?? name])),
    );
  }, [categories]);

  const move = async (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= categories.length) return;
    const ordered = [...categories];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await setCategoryOrder(ordered);
  };

  const beginDelete = (category: KnowledgeCategoryRecord) => {
    const replacement =
      categories.find(({ id, systemKey }) => id !== category.id && systemKey === 'uncategorized') ??
      categories.find(({ id }) => id !== category.id);
    if (!replacement) return;
    setDeletingId(category.id);
    setReplacementId(replacement.id);
  };

  const closeDelete = (categoryId: string) => {
    setDeletingId(null);
    setReplacementId('');
    queueMicrotask(() => {
      const trigger = [
        ...globalThis.document.querySelectorAll<HTMLButtonElement>('[data-category-delete-id]'),
      ].find((button) => button.dataset.categoryDeleteId === categoryId);
      trigger?.focus();
    });
  };

  const saveCategoryName = async (category: KnowledgeCategoryRecord, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameErrors((current) => ({ ...current, [category.id]: 'Enter a category name.' }));
      nameRefs.current.get(category.id)?.focus();
      return;
    }
    const result = await setCategoryName(category.id, trimmedName, category.revision);
    if (result !== false) {
      // The draft is settled, so hand the field back to the server value.
      setNames((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });
      setNameErrors((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });
    }
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
            const trimmedName = newName.trim();
            if (!trimmedName) {
              setNewNameError('Enter a category name.');
              newNameRef.current?.focus();
              return;
            }
            const result = await createCategory(trimmedName, categories.at(-1)?.id ?? null);
            if (result !== false) {
              setNewName('');
              setNewNameError(null);
            }
          }}
        >
          <label>
            <span>New category</span>
            <input
              className="tactile-input"
              ref={newNameRef}
              aria-label="New category name"
              aria-invalid={newNameError ? true : undefined}
              aria-describedby={newNameError ? 'knowledge-category-create-error' : undefined}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                if (newNameError && event.target.value.trim()) setNewNameError(null);
              }}
              placeholder="Category name"
            />
            {newNameError && (
              <span
                id="knowledge-category-create-error"
                className="knowledge-management-field-error"
                role="alert"
              >
                {newNameError}
              </span>
            )}
          </label>
          <TactileButton
            size="sm"
            variant="primary"
            type="submit"
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
                  className="tactile-input"
                  ref={(node) => {
                    if (node) nameRefs.current.set(category.id, node);
                    else nameRefs.current.delete(category.id);
                  }}
                  aria-label={`Category name ${category.name}`}
                  aria-invalid={nameErrors[category.id] ? true : undefined}
                  aria-describedby={
                    nameErrors[category.id]
                      ? `knowledge-category-name-error-${category.id}`
                      : undefined
                  }
                  value={name}
                  onChange={(event) => {
                    setNames((current) => ({ ...current, [category.id]: event.target.value }));
                    if (nameErrors[category.id] && event.target.value.trim()) {
                      setNameErrors((current) => {
                        const next = { ...current };
                        delete next[category.id];
                        return next;
                      });
                    }
                  }}
                />
                {nameErrors[category.id] && (
                  <span
                    id={`knowledge-category-name-error-${category.id}`}
                    className="knowledge-management-field-error"
                    role="alert"
                  >
                    {nameErrors[category.id]}
                  </span>
                )}
              </label>
              <span className="knowledge-category-manager__count">
                {counts[category.id] ?? 0} documents
              </span>
              <div className="knowledge-category-manager__actions">
                <TactileButton
                  size="sm"
                  disabled={name.trim() === category.name}
                  loading={busy === `category:name:${category.id}`}
                  aria-label={`Save ${category.name}`}
                  onClick={() => void saveCategoryName(category, name)}
                >
                  Save
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="danger"
                  className="knowledge-management__danger-outline"
                  aria-label={`Delete ${category.name}`}
                  data-category-delete-id={category.id}
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
                    Reassign documents to{' '}
                    <select
                      className="tactile-input"
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
                  <TactileButton size="sm" onClick={() => closeDelete(category.id)}>
                    Cancel
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    variant="danger"
                    aria-label={`Confirm delete ${category.name}`}
                    disabled={!replacementId}
                    loading={busy === `category:delete:${category.id}`}
                    onClick={async () => {
                      const result = await deleteCategory(
                        category.id,
                        replacementId,
                        category.revision,
                        documentRevisions,
                      );
                      if (result !== false) closeDelete(category.id);
                    }}
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
