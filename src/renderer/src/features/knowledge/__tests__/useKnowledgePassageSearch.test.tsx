import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '@shared/knowledgeSearch';
import { useKnowledgePassageSearch } from '../useKnowledgePassageSearch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function success(requestId: string, normalizedQuery: string): KnowledgeSearchResponse {
  return {
    ok: true,
    requestId,
    availability: 'ready',
    normalizedQuery,
    results: [],
  };
}

const searchKnowledge = vi.fn<BridgeAPI['searchKnowledge']>();
const cancelKnowledgeSearch = vi.fn<BridgeAPI['cancelKnowledgeSearch']>();
let requestSequence = 0;

/**
 * `globalThis.api` is typed as the complete preload bridge; this hook only calls the two
 * knowledge-search members. `vi.stubGlobal` installs the partial without a cast, while
 * `Partial<BridgeAPI>` still checks each stub against the real contract.
 */
function stubBridgeApi(): void {
  const bridge: Partial<BridgeAPI> = { searchKnowledge, cancelKnowledgeSearch };
  vi.stubGlobal('api', bridge);
}

/** The request the hook passed on its nth `searchKnowledge` invocation. */
function requestAt(index: number): KnowledgeSearchRequest {
  const call = searchKnowledge.mock.calls[index];
  expect(call).toBeDefined();
  return call![0];
}

describe('useKnowledgePassageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    requestSequence = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, '0')}`,
    );
    stubBridgeApi();
  });

  afterEach(() => {
    globalThis.api = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces an eligible normalized query for exactly 150 milliseconds', async () => {
    searchKnowledge.mockImplementation(async (request) =>
      success(request.requestId, request.query),
    );
    const { result } = renderHook(() =>
      useKnowledgePassageSearch({ query: '  Failover   Plan  ', scope: { kind: 'all' } }),
    );

    await act(() => vi.advanceTimersByTimeAsync(149));
    expect(searchKnowledge).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(searchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'failover plan', scope: { kind: 'all' }, limit: 20 }),
    );
    expect(result.current.state).toBe('ready');
    expect(result.current.response?.normalizedQuery).toBe('failover plan');
  });

  it('does not schedule disabled, empty, function-word-only, or overlong queries', async () => {
    const { result, rerender } = renderHook(
      ({ query, enabled }) => useKnowledgePassageSearch({ query, enabled, scope: { kind: 'all' } }),
      { initialProps: { query: 'failover', enabled: false } },
    );

    await act(() => vi.advanceTimersByTimeAsync(150));
    rerender({ query: ' the and ', enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(150));
    rerender({ query: 'x'.repeat(121), enabled: true });
    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(searchKnowledge).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      state: 'idle',
      generationKey: '',
      response: null,
      error: null,
    });
  });

  it('cancels the previous request and ignores a stale completion', async () => {
    const first = deferred<KnowledgeSearchResponse>();
    const second = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ query }) => useKnowledgePassageSearch({ query, scope: { kind: 'all' } }),
      { initialProps: { query: 'failvoer' } },
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    const firstRequestId = requestAt(0).requestId;

    rerender({ query: 'failover' });
    expect(cancelKnowledgeSearch).toHaveBeenCalledWith(firstRequestId);
    await act(() => vi.advanceTimersByTimeAsync(150));
    const secondRequestId = requestAt(1).requestId;

    await act(async () => {
      second.resolve(success(secondRequestId, 'failover'));
      await second.promise;
    });
    await act(async () => {
      first.resolve(success(firstRequestId, 'failvoer'));
      await first.promise;
    });

    expect(result.current.response?.normalizedQuery).toBe('failover');
    expect(result.current.generationKey).toBe(secondRequestId);
  });

  it('cancels and replaces a request when search options change', async () => {
    const first = deferred<KnowledgeSearchResponse>();
    const second = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = renderHook(
      ({ categoryId }) =>
        useKnowledgePassageSearch({
          query: 'failover',
          scope: { kind: 'all' },
          categoryId,
          documentType: 'sop',
          limit: 8,
        }),
      { initialProps: { categoryId: ' first ' } },
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    const firstRequestId = requestAt(0).requestId;

    rerender({ categoryId: 'second' });
    expect(cancelKnowledgeSearch).toHaveBeenCalledWith(firstRequestId);
    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(searchKnowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: 'second', documentType: 'sop', limit: 8 }),
    );
  });

  it('does not restart for equivalent scope and trimmed options', async () => {
    const pending = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValue(pending.promise);
    const { rerender } = renderHook(
      ({ categoryId }) =>
        useKnowledgePassageSearch({
          query: 'failover',
          scope: { kind: 'document', documentId: 'guide-1' },
          categoryId,
        }),
      { initialProps: { categoryId: 'ops' } },
    );
    await act(() => vi.advanceTimersByTimeAsync(150));

    rerender({ categoryId: ' ops ' });
    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(searchKnowledge).toHaveBeenCalledOnce();
    expect(cancelKnowledgeSearch).not.toHaveBeenCalled();
  });

  it('ignores duplicate and mismatched completions for the active generation', async () => {
    const pending = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValue(pending.promise);
    const { result } = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );
    await act(() => vi.advanceTimersByTimeAsync(150));

    await act(async () => {
      pending.resolve(success('different-request', 'stale'));
      await pending.promise;
    });

    expect(result.current.state).toBe('unavailable');
    expect(result.current.response).toBeNull();
    expect(result.current.error).toBe('unavailable');
  });

  it('uses the generation guard when duplicate request ids complete out of order', async () => {
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValue('00000000-0000-4000-8000-000000000001');
    const first = deferred<KnowledgeSearchResponse>();
    const second = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(
      ({ query }) => useKnowledgePassageSearch({ query, scope: { kind: 'all' } }),
      { initialProps: { query: 'first query' } },
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    rerender({ query: 'second query' });
    await act(() => vi.advanceTimersByTimeAsync(150));

    await act(async () => {
      second.resolve(success('00000000-0000-4000-8000-000000000001', 'second query'));
      await second.promise;
    });
    await act(async () => {
      first.resolve(success('00000000-0000-4000-8000-000000000001', 'first query'));
      await first.promise;
    });

    expect(result.current.response?.normalizedQuery).toBe('second query');
  });

  it.each([
    ['timeout', 'unavailable'],
    ['unavailable', 'unavailable'],
    ['invalid-query', 'idle'],
    ['cancelled', 'idle'],
  ] as const)('maps a %s response to a non-throwing %s state', async (error, expectedState) => {
    searchKnowledge.mockImplementation(async (request) => ({
      ok: false,
      requestId: request.requestId,
      error,
    }));
    const { result } = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );

    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(result.current).toMatchObject({ state: expectedState, response: null, error });
  });

  it('uses unavailable for a missing API, rejected invoke, or invalid response', async () => {
    globalThis.api = undefined;
    const missing = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(missing.result.current).toMatchObject({ state: 'unavailable', error: 'unavailable' });
    missing.unmount();

    stubBridgeApi();
    searchKnowledge.mockRejectedValueOnce(new Error('ipc detail must not escape'));
    const rejected = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(rejected.result.current).toMatchObject({ state: 'unavailable', error: 'unavailable' });
    rejected.unmount();

    searchKnowledge.mockResolvedValueOnce({ bad: 'response' } as never);
    const invalid = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(invalid.result.current).toMatchObject({ state: 'unavailable', error: 'unavailable' });
  });

  it('contains a synchronous invoke failure as unavailable', async () => {
    searchKnowledge.mockImplementationOnce(() => {
      throw new Error('synchronous IPC failure');
    });
    const { result } = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );

    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(result.current).toMatchObject({ state: 'unavailable', error: 'unavailable' });
  });

  it('cancels on unmount and never publishes a late state update', async () => {
    const pending = deferred<KnowledgeSearchResponse>();
    searchKnowledge.mockReturnValue(pending.promise);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount } = renderHook(() =>
      useKnowledgePassageSearch({ query: 'failover', scope: { kind: 'all' } }),
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    const requestId = requestAt(0).requestId;

    unmount();
    expect(cancelKnowledgeSearch).toHaveBeenCalledWith(requestId);
    await act(async () => {
      pending.resolve(success(requestId, 'late'));
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('uses a monotonic fallback request id when randomUUID is unavailable and recovers later', async () => {
    vi.mocked(globalThis.crypto.randomUUID).mockImplementation(() => {
      throw new Error('random unavailable');
    });
    searchKnowledge.mockImplementation(async (request) =>
      success(request.requestId, request.query),
    );
    const { result, rerender } = renderHook(
      ({ query }) => useKnowledgePassageSearch({ query, scope: { kind: 'all' } }),
      { initialProps: { query: 'first query' } },
    );
    await act(() => vi.advanceTimersByTimeAsync(150));
    const firstKey = result.current.generationKey;

    rerender({ query: 'second query' });
    await act(() => vi.advanceTimersByTimeAsync(150));

    expect(firstKey).toMatch(/^knowledge-search-\d+-1$/u);
    expect(result.current.generationKey).toMatch(/^knowledge-search-\d+-2$/u);
    expect(result.current.generationKey).not.toBe(firstKey);
    expect(result.current.state).toBe('ready');
  });
});
