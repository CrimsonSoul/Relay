import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeDocumentType } from '@shared/knowledge';
import {
  boundedSearchLimit,
  isKnowledgeSearchQueryEligible,
  isKnowledgeSearchQueryWithinCodePointLimit,
  KNOWLEDGE_SEARCH_DOCUMENT_LIMIT,
  KNOWLEDGE_SEARCH_GLOBAL_LIMIT,
  normalizeKnowledgeSearchQuery,
  normalizeKnowledgeSearchResponse,
  type KnowledgeSearchResponse,
  type KnowledgeSearchScope,
} from '@shared/knowledgeSearch';

const SEARCH_DEBOUNCE_MS = 150;
let fallbackRequestSequence = 0;

type SuccessfulKnowledgeSearchResponse = Extract<KnowledgeSearchResponse, { ok: true }>;
type KnowledgeSearchError = Extract<KnowledgeSearchResponse, { ok: false }>['error'];

export type KnowledgePassageSearchModel = {
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
  generationKey: string;
  response: SuccessfulKnowledgeSearchResponse | null;
  error: KnowledgeSearchError | null;
};

type KnowledgePassageSearchInput = {
  query: string;
  scope: KnowledgeSearchScope;
  categoryId?: string | null;
  documentType?: KnowledgeDocumentType | null;
  limit?: number;
  enabled?: boolean;
};

const IDLE_MODEL: KnowledgePassageSearchModel = {
  state: 'idle',
  generationKey: '',
  response: null,
  error: null,
};

function createRequestId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Fall through to a renderer-local monotonic identifier.
  }
  fallbackRequestSequence += 1;
  return `knowledge-search-${Date.now()}-${fallbackRequestSequence}`;
}

function unavailableModel(generationKey: string): KnowledgePassageSearchModel {
  return {
    state: 'unavailable',
    generationKey,
    response: null,
    error: 'unavailable',
  };
}

export function useKnowledgePassageSearch(
  input: KnowledgePassageSearchInput,
): KnowledgePassageSearchModel {
  const normalizedQuery = useMemo(() => normalizeKnowledgeSearchQuery(input.query), [input.query]);
  const scopeKind = input.scope.kind;
  const scopeDocumentId = input.scope.kind === 'document' ? input.scope.documentId.trim() : '';
  const categoryId = input.categoryId?.trim() || null;
  const documentType = input.documentType ?? null;
  const defaultLimit =
    scopeKind === 'all' ? KNOWLEDGE_SEARCH_GLOBAL_LIMIT : KNOWLEDGE_SEARCH_DOCUMENT_LIMIT;
  const limit = boundedSearchLimit(
    scopeKind === 'all' ? { kind: 'all' } : { kind: 'document', documentId: scopeDocumentId },
    input.limit ?? defaultLimit,
  );
  const enabled = input.enabled ?? true;
  const eligible =
    enabled &&
    (scopeKind === 'all' || scopeDocumentId.length > 0) &&
    isKnowledgeSearchQueryWithinCodePointLimit(input.query) &&
    isKnowledgeSearchQueryWithinCodePointLimit(normalizedQuery) &&
    isKnowledgeSearchQueryEligible(normalizedQuery);
  const [model, setModel] = useState<KnowledgePassageSearchModel>(IDLE_MODEL);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!eligible) {
      setModel(IDLE_MODEL);
      return;
    }

    const requestId = createRequestId();
    let invoked = false;
    let active = true;
    setModel({ state: 'loading', generationKey: requestId, response: null, error: null });

    const timer = globalThis.setTimeout(() => {
      if (!active || generationRef.current !== generation) return;
      const api = globalThis.api;
      if (typeof api?.searchKnowledge !== 'function') {
        setModel(unavailableModel(requestId));
        return;
      }

      invoked = true;
      const scope: KnowledgeSearchScope =
        scopeKind === 'all' ? { kind: 'all' } : { kind: 'document', documentId: scopeDocumentId };
      Promise.resolve()
        .then(() =>
          api.searchKnowledge({
            requestId,
            query: normalizedQuery,
            scope,
            categoryId,
            documentType,
            limit,
          }),
        )
        .then((rawResponse) => {
          if (!active || generationRef.current !== generation) return;
          invoked = false;
          const response = normalizeKnowledgeSearchResponse(rawResponse);
          if (response === null || response.requestId !== requestId) {
            setModel(unavailableModel(requestId));
            return;
          }
          if (response.ok) {
            setModel({
              state: 'ready',
              generationKey: requestId,
              response,
              error: null,
            });
            return;
          }
          setModel({
            state:
              response.error === 'invalid-query' || response.error === 'cancelled'
                ? 'idle'
                : 'unavailable',
            generationKey: requestId,
            response: null,
            error: response.error,
          });
        })
        .catch(() => {
          if (!active || generationRef.current !== generation) return;
          invoked = false;
          setModel(unavailableModel(requestId));
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      active = false;
      globalThis.clearTimeout(timer);
      if (invoked) {
        try {
          globalThis.api?.cancelKnowledgeSearch?.(requestId);
        } catch {
          // Cancellation is best effort and must not escape the optional search surface.
        }
      }
    };
  }, [categoryId, documentType, eligible, limit, normalizedQuery, scopeDocumentId, scopeKind]);

  return model;
}
