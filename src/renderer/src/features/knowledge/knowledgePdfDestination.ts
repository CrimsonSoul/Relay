import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgePdfDestination } from './KnowledgeLinkLayer';

export type KnowledgeViewerTarget = {
  pageIndex: number;
  top: number | null;
};

function destinationType(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value) {
    return String((value as { name: unknown }).name);
  }
  return String(value ?? '');
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
    else if (reference && typeof reference === 'object') {
      pageIndex = await pdf.getPageIndex(reference);
    } else return null;

    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) return null;

    const type = destinationType(resolved[1]);
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
