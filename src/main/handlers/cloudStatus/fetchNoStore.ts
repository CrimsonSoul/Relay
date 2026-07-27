// `RequestInit`/`Response` are derived from `fetch` itself rather than named directly:
// the main-process lint environment does not declare those globals.
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

/**
 * `@types/node` ships undici's `RequestInit`, which still omits the standard `cache`
 * member even though Node 22 — and therefore Electron's main process — honours it.
 * Widening the init type keeps `cache: 'no-store'` on the wire without a cast.
 */
type NoStoreFetchInit = FetchInit & { cache: 'no-store' };

/** `fetch` with HTTP caching disabled — status feeds must never be served from cache. */
export function fetchNoStore(url: string, init: FetchInit = {}): ReturnType<typeof fetch> {
  const request: NoStoreFetchInit = { ...init, cache: 'no-store' };
  return fetch(url, request);
}
