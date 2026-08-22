import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgePdfDestination } from './KnowledgeLinkLayer';

export type KnowledgeViewerTarget = {
  pageIndex: number;
  top: number | null;
};

export function clampKnowledgePdfPageIndex(pageIndex: number, pageCount: number): number {
  const boundedPageCount = Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
  if (boundedPageCount === 0) return 0;
  const integerPageIndex = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
  return Math.min(Math.max(0, integerPageIndex), boundedPageCount - 1);
}

function destinationType(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (!Array.isArray(value) && typeof value === 'object' && 'name' in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function isPdfReference(value: unknown): value is { num: number; gen: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('num' in value) || !('gen' in value)) return false;
  const { num, gen } = value;
  return (
    typeof num === 'number' &&
    Number.isInteger(num) &&
    num >= 0 &&
    typeof gen === 'number' &&
    Number.isInteger(gen) &&
    gen >= 0
  );
}

export async function resolveKnowledgePdfDestination(
  pdf: Pick<PDFDocumentProxy, 'numPages' | 'getDestination' | 'getPageIndex'>,
  destination: KnowledgePdfDestination,
): Promise<KnowledgeViewerTarget | null> {
  try {
    const resolved =
      typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
    if (!Array.isArray(resolved) || resolved.length < 2) return null;

    const reference = resolved[0];
    let pageIndex: number;
    if (Number.isInteger(reference)) pageIndex = reference as number;
    else if (isPdfReference(reference)) {
      pageIndex = await pdf.getPageIndex(reference);
    } else return null;

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) return null;

    const type = destinationType(resolved[1]);
    if (type === null) return null;
    let topCandidate: unknown = null;
    if (type === 'XYZ') topCandidate = resolved[3];
    else if (type === 'FitH' || type === 'FitBH') topCandidate = resolved[2];

    const top =
      typeof topCandidate === 'number' && Number.isFinite(topCandidate) && topCandidate >= 0
        ? topCandidate
        : null;
    return { pageIndex, top };
  } catch {
    return null;
  }
}
