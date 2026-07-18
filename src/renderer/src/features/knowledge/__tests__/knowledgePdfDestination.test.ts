import { describe, expect, it, vi } from 'vitest';
import {
  clampKnowledgePdfPageIndex,
  resolveKnowledgePdfDestination,
} from '../knowledgePdfDestination';

function pdf(options?: { numPages?: number; destination?: unknown[] | null; pageIndex?: number }) {
  return {
    numPages: options?.numPages ?? 4,
    getDestination: vi.fn(async () => options?.destination ?? null),
    getPageIndex: vi.fn(async () => options?.pageIndex ?? 0),
  };
}

describe('resolveKnowledgePdfDestination', () => {
  it.each([
    ['negative', -2, 5, 0],
    ['fractional', 2.8, 5, 2],
    ['past the end', 8, 5, 4],
    ['empty document', 3, 0, 0],
  ])('clamps a %s current-page request', (_label, pageIndex, pageCount, expected) => {
    expect(clampKnowledgePdfPageIndex(pageIndex, pageCount)).toBe(expected);
  });

  it('resolves a named destination before reading its page and XYZ top coordinate', async () => {
    const document = pdf({ destination: [2, { name: 'XYZ' }, 0, 640] });

    await expect(resolveKnowledgePdfDestination(document, 'recovery')).resolves.toEqual({
      pageIndex: 2,
      top: 640,
    });
    expect(document.getDestination).toHaveBeenCalledWith('recovery');
    expect(document.getPageIndex).not.toHaveBeenCalled();
  });

  it('accepts a direct destination array with an integer page reference', async () => {
    const document = pdf();

    await expect(resolveKnowledgePdfDestination(document, [1, { name: 'Fit' }])).resolves.toEqual({
      pageIndex: 1,
      top: null,
    });
    expect(document.getDestination).not.toHaveBeenCalled();
    expect(document.getPageIndex).not.toHaveBeenCalled();
  });

  it('resolves an object page reference with getPageIndex', async () => {
    const reference = { num: 17, gen: 0 };
    const document = pdf({ pageIndex: 3 });

    await expect(
      resolveKnowledgePdfDestination(document, [reference, { name: 'Fit' }]),
    ).resolves.toEqual({ pageIndex: 3, top: null });
    expect(document.getPageIndex).toHaveBeenCalledWith(reference);
  });

  it.each([
    ['FitH', [0, { name: 'FitH' }, 510], 510],
    ['FitBH', [0, { name: 'FitBH' }, 490], 490],
  ])('reads the %s top coordinate from array element 2', async (_type, destination, top) => {
    await expect(resolveKnowledgePdfDestination(pdf(), destination)).resolves.toEqual({
      pageIndex: 0,
      top,
    });
  });

  it.each([
    ['null', [0, null]],
    ['unknown', [0, { name: 'FitV' }, 200]],
  ])('returns a null top for a %s destination type', async (_type, destination) => {
    await expect(resolveKnowledgePdfDestination(pdf(), destination)).resolves.toEqual({
      pageIndex: 0,
      top: null,
    });
  });

  it('returns null when a named destination is missing', async () => {
    await expect(resolveKnowledgePdfDestination(pdf(), 'missing')).resolves.toBeNull();
  });

  it.each(['getDestination', 'getPageIndex'] as const)(
    'returns null when %s throws',
    async (method) => {
      const document = pdf({ destination: [{ num: 5, gen: 0 }, { name: 'Fit' }] });
      document[method].mockRejectedValueOnce(new Error('PDF lookup failed'));

      await expect(resolveKnowledgePdfDestination(document, 'section')).resolves.toBeNull();
    },
  );

  it.each([
    ['negative', -1],
    ['past the document', 4],
  ])('rejects a %s page index', async (_label, pageIndex) => {
    await expect(
      resolveKnowledgePdfDestination(pdf(), [pageIndex, { name: 'Fit' }]),
    ).resolves.toBeNull();
  });
});
