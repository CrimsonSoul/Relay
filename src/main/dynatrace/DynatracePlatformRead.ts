import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';
import { dynatraceAuthentication } from './DynatraceAuthentication';

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
    const retry = response.headers.get('retry-after');
    const seconds = retry === null ? Number.NaN : Number(retry);
    const retryAfter = Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Math.max(0, Date.parse(retry ?? '') - Date.now());
    await response.body?.cancel();
    const delay = Number.isFinite(retryAfter) ? retryAfter : 60_000;
    throw new Error(
      `Dynatrace live read failed (HTTP ${response.status}). Check the OAuth scopes (${permission}) and the subject user's environment access.`,
      { cause: response.status === 429 ? delay : null },
    );
  }
  return readBoundedJson(response, signal);
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Dynatrace returned an empty live response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new Error('Dynatrace live response exceeded its size limit.');
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('Dynatrace returned invalid JSON in a live response.');
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
