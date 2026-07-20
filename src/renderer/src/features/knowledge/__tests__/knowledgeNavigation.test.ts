import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
  requestKnowledgeDocumentOpen,
} from '../knowledgeNavigation';

describe('knowledgeNavigation', () => {
  afterEach(() => {
    acknowledgeKnowledgeDocumentOpen('guide-1');
    acknowledgeKnowledgeDocumentOpen('legacy-guide');
    vi.restoreAllMocks();
  });

  it('trims and preserves page highlight ranges through cloned event and pending handoff', () => {
    const received: unknown[] = [];
    const onOpen = (event: Event) => received.push((event as CustomEvent).detail);
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, onOpen);

    requestKnowledgeDocumentOpen({
      documentId: ' guide-1 ',
      headingId: ' recovery ',
      pageIndex: 0,
      highlightText: ' failover lane ',
      normalizedStart: 0,
      normalizedEnd: 13,
    });
    globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, onOpen);

    expect(received).toEqual([
      {
        documentId: 'guide-1',
        headingId: 'recovery',
        pageIndex: 0,
        highlightText: 'failover lane',
        normalizedStart: 0,
        normalizedEnd: 13,
      },
    ]);
    const eventDetail = received[0] as { pageIndex: number };
    eventDetail.pageIndex = 99;
    const firstPending = getPendingKnowledgeDocumentOpen();
    expect(firstPending?.pageIndex).toBe(0);
    if (firstPending) firstPending.highlightText = 'mutated';
    expect(getPendingKnowledgeDocumentOpen()?.highlightText).toBe('failover lane');
  });

  it('keeps the legacy document and heading overload compatible', () => {
    requestKnowledgeDocumentOpen(' legacy-guide ', ' overview ');

    expect(getPendingKnowledgeDocumentOpen()).toEqual({
      documentId: 'legacy-guide',
      headingId: 'overview',
    });
  });

  it.each([
    { pageIndex: -1 },
    { pageIndex: 1.5 },
    { normalizedStart: -1 },
    { normalizedStart: 1.5 },
    { normalizedEnd: -1 },
    { normalizedEnd: 1.5 },
  ])('rejects unsafe page or range offsets: %o', (unsafeOffset) => {
    const dispatch = vi.spyOn(globalThis, 'dispatchEvent');

    requestKnowledgeDocumentOpen({ documentId: 'guide-1', ...unsafeOffset });

    expect(dispatch).not.toHaveBeenCalled();
    expect(getPendingKnowledgeDocumentOpen()).toBeNull();
  });

  it('rejects blank document identifiers and omits blank optional text', () => {
    const dispatch = vi.spyOn(globalThis, 'dispatchEvent');
    requestKnowledgeDocumentOpen({ documentId: '   ', pageIndex: 0 });
    expect(dispatch).not.toHaveBeenCalled();

    requestKnowledgeDocumentOpen({
      documentId: 'guide-1',
      headingId: '   ',
      highlightText: '   ',
    });
    expect(getPendingKnowledgeDocumentOpen()).toEqual({ documentId: 'guide-1' });
  });
});
