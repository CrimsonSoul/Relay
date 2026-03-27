/** Check whether an error is a PocketBase 404 (record not found). */
export function isPbNotFoundError(err: unknown): boolean {
  return err instanceof Error && 'status' in err && (err as { status: number }).status === 404;
}
