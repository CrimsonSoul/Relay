import { describe, expect, it } from 'vitest';
import {
  createKnowledgePdfNavigationState,
  knowledgePdfNavigationReducer,
} from '../knowledgePdfNavigationState';

describe('knowledgePdfNavigationReducer', () => {
  it('moves explicit targets and pages through one navigation state machine', () => {
    const initial = createKnowledgePdfNavigationState({ pageIndex: 1, top: null });
    const targeted = knowledgePdfNavigationReducer(initial, {
      type: 'target',
      target: { pageIndex: 2, top: 640 },
    });
    const paged = knowledgePdfNavigationReducer(targeted, { type: 'page', pageIndex: 2 });
    const settled = knowledgePdfNavigationReducer(paged, { type: 'target', target: null });

    expect(targeted.navigationTarget).toEqual({ pageIndex: 2, top: 640 });
    expect(paged.pageIndex).toBe(2);
    expect(settled).toMatchObject({ pageIndex: 2, navigationTarget: null });
  });

  it('resets document navigation while preserving a same-document retry page', () => {
    const current = {
      ...createKnowledgePdfNavigationState(null),
      pageIndex: 2,
      navigationTarget: { pageIndex: 2, top: 300 },
      singleTopRequest: {
        documentId: 'doc-1',
        checksum: 'a'.repeat(64),
        target: { pageIndex: 2, top: 300 },
      },
    };

    expect(
      knowledgePdfNavigationReducer(current, { type: 'document-reset', preservePage: true }),
    ).toEqual({ pageIndex: 2, navigationTarget: null, singleTopRequest: null });
    expect(
      knowledgePdfNavigationReducer(current, { type: 'document-reset', preservePage: false }),
    ).toEqual({ pageIndex: 0, navigationTarget: null, singleTopRequest: null });
  });
});
