import type { KnowledgeViewerTarget } from './knowledgePdfDestination';

export type KnowledgePdfSingleTopRequest = {
  documentId: string;
  checksum: string;
  target: KnowledgeViewerTarget;
};

export type KnowledgePdfNavigationState = {
  pageIndex: number;
  navigationTarget: KnowledgeViewerTarget | null;
  singleTopRequest: KnowledgePdfSingleTopRequest | null;
};

export type KnowledgePdfNavigationAction =
  | { type: 'document-reset'; preservePage: boolean }
  | { type: 'page'; pageIndex: number }
  | { type: 'target'; target: KnowledgeViewerTarget | null }
  | { type: 'single-top'; request: KnowledgePdfSingleTopRequest | null }
  | { type: 'consume-single-top'; request: KnowledgePdfSingleTopRequest };

export function createKnowledgePdfNavigationState(
  target: KnowledgeViewerTarget | null,
): KnowledgePdfNavigationState {
  return {
    pageIndex: 0,
    navigationTarget: target,
    singleTopRequest: null,
  };
}

export function knowledgePdfNavigationReducer(
  state: KnowledgePdfNavigationState,
  action: KnowledgePdfNavigationAction,
): KnowledgePdfNavigationState {
  switch (action.type) {
    case 'document-reset':
      return {
        pageIndex: action.preservePage ? state.pageIndex : 0,
        navigationTarget: null,
        singleTopRequest: null,
      };
    case 'page':
      return state.pageIndex === action.pageIndex
        ? state
        : { ...state, pageIndex: action.pageIndex };
    case 'target':
      return { ...state, navigationTarget: action.target };
    case 'single-top':
      return { ...state, singleTopRequest: action.request };
    case 'consume-single-top':
      return state.singleTopRequest === action.request
        ? { ...state, singleTopRequest: null }
        : state;
  }
}
