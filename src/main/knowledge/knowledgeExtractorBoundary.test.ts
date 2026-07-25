import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  getDocument: vi.fn(),
  getPage: vi.fn(),
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
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getMetadata: vi.fn(async () => ({ info: {} })),
        getOutline: vi.fn(async () => [
          {
            title: 'Overview',
            dest: [0, ['XYZ'], 0, 700],
            items: [],
          },
        ]),
        getPage: mocks.getPage,
        getPageIndex: vi.fn(),
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
});
