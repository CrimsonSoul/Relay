import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  KNOWLEDGE_MAX_CATEGORY_LENGTH,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_MAX_SOURCE_KEY_LENGTH,
  compareKnowledgeCategories,
} from '@shared/knowledge';

const PDF_EXTENSION_PATTERN = /\.pdf$/i;

export type KnowledgeSourceIssueCode =
  | 'nested-directory'
  | 'symbolic-link'
  | 'outside-root'
  | 'control-character'
  | 'invalid-name'
  | 'empty-file'
  | 'oversized-file'
  | 'invalid-signature'
  | 'unreadable-file';

export type KnowledgeSourceIssue = {
  code: KnowledgeSourceIssueCode;
  sourceKey: string;
};

export type KnowledgeSourceCandidate = {
  canonicalPath: string;
  sourceKey: string;
  category: string;
  fileName: string;
  byteSize: number;
  sourceModifiedAt: string;
};

export type KnowledgeSourceScan = {
  healthy: boolean;
  candidates: KnowledgeSourceCandidate[];
  issues: KnowledgeSourceIssue[];
  error?: string;
};

export async function ensureKnowledgeRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
}

function portableSourceKey(value: string): string {
  return value.split(sep).join('/');
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== '' && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`);
}

async function hasPdfSignature(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(5);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return bytesRead === signature.length && signature.toString('ascii') === '%PDF-';
  } finally {
    await handle.close();
  }
}

async function inspectPdf(
  canonicalRoot: string,
  path: string,
  sourceKey: string,
  category: string,
): Promise<KnowledgeSourceCandidate | KnowledgeSourceIssue | null> {
  const fileName = sourceKey.split('/').at(-1) ?? '';
  if (!PDF_EXTENSION_PATTERN.test(fileName)) return null;
  if (hasControlCharacter(sourceKey) || hasControlCharacter(category)) {
    return { code: 'control-character', sourceKey };
  }
  if (
    !fileName.trim() ||
    fileName.length > 240 ||
    !category.trim() ||
    category.length > KNOWLEDGE_MAX_CATEGORY_LENGTH ||
    sourceKey.length > KNOWLEDGE_MAX_SOURCE_KEY_LENGTH
  ) {
    return { code: 'invalid-name', sourceKey };
  }

  try {
    const sourceStats = await lstat(path);
    if (sourceStats.isSymbolicLink()) return { code: 'symbolic-link', sourceKey };
    if (!sourceStats.isFile()) return null;
    if (sourceStats.size === 0) return { code: 'empty-file', sourceKey };
    if (sourceStats.size > KNOWLEDGE_MAX_PDF_BYTES) {
      return { code: 'oversized-file', sourceKey };
    }

    const canonicalPath = await realpath(path);
    if (!isContained(canonicalRoot, canonicalPath)) return { code: 'outside-root', sourceKey };
    if (!(await hasPdfSignature(canonicalPath))) return { code: 'invalid-signature', sourceKey };

    return {
      canonicalPath,
      sourceKey,
      category,
      fileName,
      byteSize: sourceStats.size,
      sourceModifiedAt: sourceStats.mtime.toISOString(),
    };
  } catch {
    return { code: 'unreadable-file', sourceKey };
  }
}

async function collectPdfInspection(
  canonicalRoot: string,
  path: string,
  sourceKey: string,
  category: string,
  candidates: KnowledgeSourceCandidate[],
  issues: KnowledgeSourceIssue[],
): Promise<void> {
  const result = await inspectPdf(canonicalRoot, path, portableSourceKey(sourceKey), category);
  if (!result) return;
  if ('canonicalPath' in result) candidates.push(result);
  else issues.push(result);
}

async function scanCategory(
  canonicalRoot: string,
  categoryEntry: Dirent,
  candidates: KnowledgeSourceCandidate[],
  issues: KnowledgeSourceIssue[],
): Promise<void> {
  const category = categoryEntry.name;
  if (hasControlCharacter(category)) {
    issues.push({ code: 'control-character', sourceKey: category });
    return;
  }
  if (!category.trim() || category.length > KNOWLEDGE_MAX_CATEGORY_LENGTH) {
    issues.push({ code: 'invalid-name', sourceKey: category });
    return;
  }

  const categoryPath = resolve(canonicalRoot, category);
  let entries: Dirent[];
  try {
    entries = await readdir(categoryPath, { withFileTypes: true });
  } catch {
    issues.push({ code: 'unreadable-file', sourceKey: category });
    return;
  }

  for (const child of entries) {
    const sourceKey = portableSourceKey(`${category}${sep}${child.name}`);
    if (child.isDirectory()) {
      issues.push({ code: 'nested-directory', sourceKey });
    } else if (child.isSymbolicLink()) {
      if (PDF_EXTENSION_PATTERN.test(child.name)) {
        issues.push({ code: 'symbolic-link', sourceKey });
      }
    } else if (child.isFile()) {
      await collectPdfInspection(
        canonicalRoot,
        resolve(categoryPath, child.name),
        sourceKey,
        category,
        candidates,
        issues,
      );
    }
  }
}

async function scanRootEntry(
  canonicalRoot: string,
  entry: Dirent,
  candidates: KnowledgeSourceCandidate[],
  issues: KnowledgeSourceIssue[],
): Promise<void> {
  if (entry.isSymbolicLink()) {
    if (PDF_EXTENSION_PATTERN.test(entry.name)) {
      issues.push({ code: 'symbolic-link', sourceKey: entry.name });
    }
    return;
  }
  if (entry.isFile()) {
    await collectPdfInspection(
      canonicalRoot,
      resolve(canonicalRoot, entry.name),
      entry.name,
      'General',
      candidates,
      issues,
    );
    return;
  }
  if (entry.isDirectory()) {
    await scanCategory(canonicalRoot, entry, candidates, issues);
  }
}

export async function scanKnowledgeRoot(root: string): Promise<KnowledgeSourceScan> {
  const candidates: KnowledgeSourceCandidate[] = [];
  const issues: KnowledgeSourceIssue[] = [];
  let canonicalRoot: string;
  let rootEntries: Dirent[];

  try {
    canonicalRoot = await realpath(resolve(root));
    rootEntries = await readdir(canonicalRoot, { withFileTypes: true });
  } catch (error) {
    return {
      healthy: false,
      candidates,
      issues,
      error: error instanceof Error ? error.message : 'Knowledge source is unavailable',
    };
  }

  for (const entry of rootEntries) {
    await scanRootEntry(canonicalRoot, entry, candidates, issues);
  }

  candidates.sort(
    (left, right) =>
      compareKnowledgeCategories(left.category, right.category) ||
      left.fileName.localeCompare(right.fileName, 'en', { sensitivity: 'base', numeric: true }),
  );
  return { healthy: true, candidates, issues };
}
