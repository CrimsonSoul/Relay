import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { KnowledgeSopCard } from '../KnowledgeSopCard';

const document: KnowledgeDocumentRecord = {
  id: 'oracle',
  sourceKey: 'Operations/Oracle SOP Manual.pdf',
  category: 'Operations',
  categoryId: 'category-operations',
  documentType: 'sop',
  title: 'Oracle SOP Manual',
  displayTitle: 'Oracle SOP Manual',
  fileName: 'Oracle SOP Manual.pdf',
  pdf: 'oracle.pdf',
  cover: 'oracle.png',
  checksum: 'a'.repeat(64),
  byteSize: 100,
  pageCount: 23,
  outline: [],
  outlineSource: 'none',
  sourceModifiedAt: '2026-07-18T12:00:00.000Z',
  indexedAt: '2026-07-18T12:00:00.000Z',
  searchIndexState: 'ready',
  searchIndexChecksum: 'a'.repeat(64),
  searchIndexVersion: 1,
  searchIndexedAt: '2026-07-18T12:00:00.000Z',
  searchIndexError: null,
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

describe('KnowledgeSopCard', () => {
  beforeEach(() => {
    globalThis.api = {
      getKnowledgeCover: vi.fn(async () => ({
        ok: true,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        checksum: document.checksum,
        source: 'cache',
      })),
    } as never;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:oracle-cover');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete globalThis.api;
    vi.restoreAllMocks();
  });

  it('fits the card shell to the loaded cover without changing open behavior', async () => {
    const onOpen = vi.fn();
    const { container } = render(<KnowledgeSopCard document={document} onOpen={onOpen} />);
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    const image = container.querySelector('img') as HTMLImageElement;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 612 },
      naturalHeight: { configurable: true, value: 792 },
    });

    fireEvent.load(image);

    const cover = container.querySelector<HTMLElement>('.knowledge-sop-card__cover');
    expect(cover).toHaveStyle({ aspectRatio: '612 / 792' });
    expect(cover?.querySelector('.knowledge-sop-card__cover-sheet')).toContainElement(image);
    await waitFor(() => expect(cover).toHaveAttribute('data-state', 'ready'));

    fireEvent.click(screen.getByRole('button', { name: 'Open Oracle SOP Manual' }));
    expect(onOpen).toHaveBeenCalledWith('oracle');
  });
});
