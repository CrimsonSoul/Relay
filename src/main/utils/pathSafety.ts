import { normalize, resolve, relative, isAbsolute } from 'node:path';
import fsPromises from 'node:fs/promises';
import { loggers } from '../logger';

/**
 * Check if a path is a Windows UNC path (\\server\share)
 */
export function isUncPath(path: string): boolean {
  return /^[/\\]{2}[^/\\]+[/\\]+[^/\\]+/.test(path);
}

/**
 * Safely resolve a path to its real location, following symlinks
 * Returns null if the path doesn't exist or can't be resolved
 */
export async function safeRealPath(path: string): Promise<string | null> {
  try {
    return await fsPromises.realpath(path);
  } catch {
    return null;
  }
}

/**
 * Protects against: symlink attacks, path traversal, UNC path escapes
 */
export async function validatePath(requestedPath: string, root: string): Promise<boolean> {
  if (!requestedPath || !root) return false;

  if (isUncPath(requestedPath)) {
    loggers.security.warn(`Blocked UNC path: ${requestedPath}`);
    return false;
  }

  const normalizedPath = normalize(requestedPath);
  if (isUncPath(normalizedPath)) {
    loggers.security.warn(`Blocked normalized UNC path: ${normalizedPath}`);
    return false;
  }

  const absPath = resolve(root, normalizedPath);
  const rel = relative(root, absPath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return false;
  }

  const realRoot = await safeRealPath(root);
  if (!realRoot) {
    loggers.security.warn(`Could not resolve real path for root: ${root}`);
    return false;
  }

  const realPath = await safeRealPath(absPath);
  if (realPath) {
    const realRel = relative(realRoot, realPath);
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      loggers.security.warn(`Path escapes root via symlink: ${requestedPath} -> ${realPath}`);
      return false;
    }
  }

  return true;
}
