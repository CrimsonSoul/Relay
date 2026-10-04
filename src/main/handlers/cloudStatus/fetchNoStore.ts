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

/**
 * Reads a response body as text, rejecting once it exceeds `maxBytes` (advertised or
 * streamed) so an oversized status page cannot be buffered in full.
 */
export async function readBoundedText(
  response: Response,
  maxBytes: number,
  source: string,
): Promise<string> {
  const tooLarge = () => new Error(`${source} response exceeds ${maxBytes} bytes`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw tooLarge();
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  let overflowed = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      overflowed = true;
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  if (overflowed) {
    await reader.cancel();
    throw tooLarge();
  }
  return text + decoder.decode();
}
