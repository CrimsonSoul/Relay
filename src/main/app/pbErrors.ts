/**
 * Only definitive credential rejections should trigger destructive auth
 * recovery paths (e.g. delete+recreate of the app user). Network failures
 * (PocketBase SDK uses status 0), rate limits, and server errors are transient
 * — destroying state over them would invalidate every connected client's token
 * for nothing.
 */
export function isCredentialRejection(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 400 || status === 401 || status === 403;
}

export type SafePocketBaseAuthFailure = Readonly<{
  category:
    'aborted' | 'credential-rejected' | 'rate-limited' | 'server-error' | 'unavailable' | 'unknown';
  status?: number;
}>;

/**
 * Return only bounded, non-message metadata for credential-bearing failures.
 * PocketBase response messages are server-controlled and may reflect submitted
 * credentials, so callers must not serialize the original Error into logs.
 */
export function safePocketBaseAuthFailure(err: unknown): SafePocketBaseAuthFailure {
  const rawStatus = (err as { status?: unknown } | null)?.status;
  const status =
    typeof rawStatus === 'number' &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 0 &&
    rawStatus <= 599
      ? rawStatus
      : undefined;
  let category: SafePocketBaseAuthFailure['category'] = 'unknown';
  if ((err as { name?: unknown } | null)?.name === 'AbortError') {
    category = 'aborted';
  } else if (isCredentialRejection(err)) {
    category = 'credential-rejected';
  } else if (status === 429) {
    category = 'rate-limited';
  } else if (status === 0) {
    category = 'unavailable';
  } else if (status !== undefined && status >= 500) {
    category = 'server-error';
  }
  return status === undefined ? { category } : { category, status };
}
