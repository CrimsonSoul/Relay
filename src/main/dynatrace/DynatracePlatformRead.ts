import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';
import { dynatraceAuthentication } from './DynatraceAuthentication';
import { readBoundedJson, retryAfterMs } from './DynatraceProtocol';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Bounded, same-environment reads. Never follow server-provided URLs with an OAuth access token. */
export async function readDynatracePlatform(
  fetchImpl: typeof fetch,
  config: DynatraceProblemsConfig,
  path: string,
  parameters: URLSearchParams,
  signal: AbortSignal,
  permission: string,
): Promise<unknown> {
  const url = new URL(path, config.environmentUrl);
  url.search = parameters.toString();
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${await dynatraceAuthentication(fetchImpl).token(config, signal)}`,
    },
    redirect: 'error',
    signal,
  });
  signal.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401 && config.oauth) dynatraceAuthentication(fetchImpl).clear();
    // A body that already failed must not replace the HTTP error and its Retry-After.
    await response.body?.cancel().catch(() => undefined);
    const delay = retryAfterMs(response.headers) ?? 60_000;
    throw new Error(
      `Dynatrace live read failed (HTTP ${response.status}). Check the OAuth scopes (${permission}) and the subject user's environment access.`,
      { cause: response.status === 429 ? delay : null },
    );
  }
  return readBoundedJson(response, signal, MAX_RESPONSE_BYTES, 'live response');
}
