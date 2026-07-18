import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeCategoryRecord, KnowledgeDocumentRecord } from '@shared/knowledge';
import { KnowledgeLibrary } from '../KnowledgeLibrary';

const category: KnowledgeCategoryRecord = {
  id: 'category-operations',
  name: 'Operations',
  normalizedName: 'operations',
  sortOrder: 100,
  systemKey: '',
  revision: 1,
  created: '2026-07-18T12:00:00.000Z',
  updated: '2026-07-18T12:00:00.000Z',
};

function document(id: string, type: 'sop' | 'cheatsheet'): KnowledgeDocumentRecord {
  return {
    id,
    sourceKey: `Operations/${id}.pdf`,
    category: 'Operations',
    categoryId: category.id,
    documentType: type,
    title: id,
    displayTitle: id === 'oracle' ? 'Oracle SOP Manual' : 'Oracle quick reference',
    fileName: `${id}.pdf`,
    pdf: `${id}.pdf`,
    cover: `${id}.png`,
    checksum: 'a'.repeat(64),
    byteSize: 100,
    pageCount: 12,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-18T12:00:00.000Z',
    indexedAt: '2026-07-18T12:00:00.000Z',
    lifecycleState: 'active',
    revision: 1,
    publishedByAccountId: 'owner',
    publishedByName: 'Ryan',
    publishedAt: '2026-07-18T12:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    created: '2026-07-18T12:00:00.000Z',
    updated: '2026-07-18T12:00:00.000Z',
  };
}

describe('KnowledgeLibrary', () => {
  it('spotlights SOP covers, keeps cheatsheets compact, and opens the selected document', () => {
    const onOpenDocument = vi.fn();
    render(
      <KnowledgeLibrary
        documents={[document('oracle', 'sop'), document('quick', 'cheatsheet')]}
        categories={[category]}
        canManage={false}
        onManage={vi.fn()}
        onOpenDocument={onOpenDocument}
      />,
    );

    expect(screen.getByRole('heading', { name: 'SOP guides' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cheatsheets' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Open Oracle SOP Manual/ }).at(-1)!);
    expect(onOpenDocument).toHaveBeenCalledWith('oracle');
  });
});
