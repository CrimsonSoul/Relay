/**
 * Only credential rejections should trigger destructive auth recovery paths
 * (e.g. delete+recreate of the app user). Network failures (PocketBase SDK
 * uses status 0) and server errors are transient — destroying state over them
 * would invalidate every connected client's token for nothing.
 */
export function isCredentialRejection(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}
