import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { KNOWLEDGE_MAX_PDF_BYTES, KNOWLEDGE_UPLOAD_CHUNK_BYTES } from '@shared/knowledge';

export type KnowledgePdfCandidate = {
  canonicalPath: string;
  fileName: string;
  byteSize: number;
  modifiedMs: number;
  device: number;
  inode: number;
};

export type KnowledgePdfSourcePlan = KnowledgePdfCandidate & {
  checksum: string;
  chunkCount: number;
};

export type KnowledgeSourceErrorCode = 'invalid-file' | 'too-large' | 'source-required';

export class KnowledgeSourceError extends Error {
  constructor(readonly code: KnowledgeSourceErrorCode) {
    super(
      code === 'source-required' ? 'Reselect the unchanged source PDF.' : 'Invalid PDF source.',
    );
    this.name = 'KnowledgeSourceError';
  }
}

const OPEN_READ_NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

async function openSource(path: string): Promise<FileHandle> {
  try {
    return await open(path, OPEN_READ_NO_FOLLOW);
  } catch {
    throw new KnowledgeSourceError('source-required');
  }
}

function sameIdentity(
  candidate: KnowledgePdfCandidate,
  stats: Awaited<ReturnType<FileHandle['stat']>>,
): boolean {
  return (
    stats.isFile() &&
    stats.size === candidate.byteSize &&
    stats.mtimeMs === candidate.modifiedMs &&
    Number(stats.dev) === candidate.device &&
    Number(stats.ino) === candidate.inode
  );
}

async function readExactly(
  handle: FileHandle,
  target: Uint8Array,
  position: number,
): Promise<number> {
  let offset = 0;
  while (offset < target.byteLength) {
    const result = await handle.read(target, offset, target.byteLength - offset, position + offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return offset;
}

export async function inspectKnowledgePdfCandidate(path: string): Promise<KnowledgePdfCandidate> {
  let sourceStatus: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceStatus = await lstat(path);
  } catch {
    throw new KnowledgeSourceError('invalid-file');
  }
  if (
    sourceStatus.isSymbolicLink() ||
    !sourceStatus.isFile() ||
    extname(path).toLocaleLowerCase('en') !== '.pdf'
  ) {
    throw new KnowledgeSourceError('invalid-file');
  }
  if (sourceStatus.size < 5) throw new KnowledgeSourceError('invalid-file');
  if (sourceStatus.size > KNOWLEDGE_MAX_PDF_BYTES) throw new KnowledgeSourceError('too-large');

  const canonicalPath = await realpath(path);
  const handle = await openSource(canonicalPath);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== sourceStatus.size) {
      throw new KnowledgeSourceError('invalid-file');
    }
    const signature = new Uint8Array(5);
    if (
      (await readExactly(handle, signature, 0)) !== signature.byteLength ||
      Buffer.from(signature).toString('ascii') !== '%PDF-'
    ) {
      throw new KnowledgeSourceError('invalid-file');
    }
    return {
      canonicalPath,
      fileName: basename(canonicalPath),
      byteSize: stats.size,
      modifiedMs: stats.mtimeMs,
      device: Number(stats.dev),
      inode: Number(stats.ino),
    };
  } finally {
    await handle.close();
  }
}

export async function planKnowledgePdfSource(
  candidate: KnowledgePdfCandidate,
): Promise<KnowledgePdfSourcePlan> {
  const handle = await openSource(candidate.canonicalPath);
  try {
    const before = await handle.stat();
    if (!sameIdentity(candidate, before)) throw new KnowledgeSourceError('source-required');
    const hash = createHash('sha256');
    const buffer = new Uint8Array(KNOWLEDGE_UPLOAD_CHUNK_BYTES);
    let position = 0;
    while (position < candidate.byteSize) {
      const wanted = Math.min(buffer.byteLength, candidate.byteSize - position);
      const bytesRead = await readExactly(handle, buffer.subarray(0, wanted), position);
      if (bytesRead !== wanted) throw new KnowledgeSourceError('source-required');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameIdentity(candidate, after)) throw new KnowledgeSourceError('source-required');
    return {
      ...candidate,
      checksum: hash.digest('hex'),
      chunkCount: Math.ceil(candidate.byteSize / KNOWLEDGE_UPLOAD_CHUNK_BYTES),
    };
  } finally {
    await handle.close();
  }
}

export async function revalidateKnowledgePdfSource(plan: KnowledgePdfSourcePlan): Promise<boolean> {
  try {
    const candidate = await inspectKnowledgePdfCandidate(plan.canonicalPath);
    if (!sameCandidate(plan, candidate)) return false;
    const current = await planKnowledgePdfSource(candidate);
    return current.checksum === plan.checksum;
  } catch {
    return false;
  }
}

function sameCandidate(left: KnowledgePdfCandidate, right: KnowledgePdfCandidate): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.fileName === right.fileName &&
    left.byteSize === right.byteSize &&
    left.modifiedMs === right.modifiedMs &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

export async function readKnowledgePdfChunk(
  plan: KnowledgePdfSourcePlan,
  index: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(index) || index < 0 || index >= plan.chunkCount) {
    throw new KnowledgeSourceError('invalid-file');
  }
  const handle = await openSource(plan.canonicalPath);
  try {
    const stats = await handle.stat();
    if (!sameIdentity(plan, stats)) throw new KnowledgeSourceError('source-required');
    const position = index * KNOWLEDGE_UPLOAD_CHUNK_BYTES;
    const byteLength = Math.min(KNOWLEDGE_UPLOAD_CHUNK_BYTES, plan.byteSize - position);
    const bytes = new Uint8Array(byteLength);
    if ((await readExactly(handle, bytes, position)) !== byteLength) {
      throw new KnowledgeSourceError('source-required');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
