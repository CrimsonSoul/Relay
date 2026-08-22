import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  getDocument: vi.fn(),
  getOutline: vi.fn(),
  getPage: vi.fn(),
  getPageIndex: vi.fn(),
  renderCover: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mocks.getDocument,
}));

vi.mock('./knowledgeCover', () => ({
  renderKnowledgeDocumentCover: mocks.renderCover,
}));

import { extractKnowledgePdf } from './knowledgeExtractor';

describe('extractKnowledgePdf destination boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPage.mockResolvedValue({
      getTextContent: vi.fn(async () => ({ items: [] })),
      getViewport: vi.fn(() => ({ height: 792 })),
      cleanup: vi.fn(),
    });
    mocks.getOutline.mockResolvedValue([
      {
        title: 'Overview',
        dest: [0, ['XYZ'], 0, 700],
        items: [],
      },
    ]);
    mocks.getPageIndex.mockResolvedValue(0);
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: vi.fn(async () => ({ info: {} })),
        getOutline: mocks.getOutline,
        getPage: mocks.getPage,
        getPageIndex: mocks.getPageIndex,
        getDestination: vi.fn(),
      }),
      destroy: mocks.destroy,
    });
  });

  it('rejects a string-coercible destination type array from PDF.js', async () => {
    await expect(extractKnowledgePdf(new Uint8Array([1]))).resolves.toMatchObject({
      outline: [],
      outlineSource: 'none',
    });
    expect(mocks.getPage).toHaveBeenCalledWith(1);
  });

  it.each([
    ['array', []],
    ['missing generation', { num: 17 }],
    ['fractional generation', { num: 17, gen: 0.5 }],
  ])('rejects a malformed %s page reference before PDF.js lookup', async (_label, reference) => {
    mocks.getOutline.mockResolvedValueOnce([
      {
        title: 'Overview',
        dest: [reference, { name: 'XYZ' }, 0, 700],
        items: [],
      },
    ]);

    await expect(extractKnowledgePdf(new Uint8Array([1]))).resolves.toMatchObject({
      outline: [],
      outlineSource: 'none',
    });
    expect(mocks.getPageIndex).not.toHaveBeenCalled();
    expect(mocks.getPage).toHaveBeenCalledWith(1);
  });

  it('resolves an integer num/gen page reference through PDF.js', async () => {
    const reference = { num: 17, gen: 0 };
    mocks.getOutline.mockResolvedValueOnce([
      {
        title: 'Overview',
        dest: [reference, { name: 'XYZ' }, 0, 700],
        items: [],
      },
    ]);

    await expect(extractKnowledgePdf(new Uint8Array([1]))).resolves.toMatchObject({
      outline: [expect.objectContaining({ label: 'Overview', pageIndex: 0, top: 700 })],
      outlineSource: 'native',
    });
    expect(mocks.getPageIndex).toHaveBeenCalledWith(reference);
    expect(mocks.getPage).not.toHaveBeenCalled();
  });
});
