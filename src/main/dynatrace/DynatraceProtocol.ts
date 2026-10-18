// Wire details shared by the server's Dynatrace clients: quoted strings, Retry-After and bounded
// JSON bodies.

/**
 * A double-quoted string literal. DQL, classic API entity selectors and PocketBase filters share
 * these escapes: a backslash and a double quote are each escaped with a backslash.
 */
export function quotedString(value: string): string {
  const escaped = value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

/**
 * Retry-After as a delay in milliseconds, from delta-seconds or an HTTP date. A time already past
 * is zero; a missing or unreadable header is null.
 */
export function retryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Reads a JSON body of at most `maxBytes`, stopping as soon as `signal` aborts. `subject` names the
 * response in errors, for example "live response".
 */
export async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  subject: string,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Dynatrace returned an empty ${subject}.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Dynatrace ${subject} exceeded its size limit.`);
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error(`Dynatrace returned invalid JSON in a ${subject}.`);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
