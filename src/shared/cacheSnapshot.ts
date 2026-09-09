/** Desktop transfer ceilings. Byte counts are serialized UTF-8 record bytes. */
export const CACHE_SNAPSHOT_LIMITS = {
  records: 100_000,
  bytes: 256 * 1024 * 1024,
  recordBytes: 256 * 1024,
  chunkRecords: 512,
  chunkBytes: 2 * 1024 * 1024,
} as const;
export interface CacheSnapshotManifest {
  count: number;
  bytes: number;
  signature: string;
}
export type CacheWriteAck =
  | { ok: true; persisted: true }
  | { ok: false; persisted: false; error: string; unsupported?: boolean };
export type CacheSnapshotBeginAck =
  | { ok: true; generation: string }
  | { ok: false; persisted: false; error: string; unsupported?: boolean };
export interface CacheSnapshotStatus {
  complete: boolean;
  supported?: boolean;
}
export function collectionRevisionSignature(
  records: readonly { id: string; updated?: string; queuedAt?: string }[],
): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const record of records) {
    const revision = `${record.id}\u0000${record.updated ?? ''}\u0000${record.queuedAt ?? ''}\u0000`;
    for (let index = 0; index < revision.length; index += 1) {
      hash ^= BigInt(revision.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
  }
  return `${records.length}:${hash.toString(16).padStart(16, '0')}`;
}
