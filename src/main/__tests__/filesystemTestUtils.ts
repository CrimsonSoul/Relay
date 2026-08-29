import { symlink } from 'node:fs/promises';

export const supportsUnprivilegedFileSymlinks = process.platform !== 'win32';

export function createDirectoryRedirect(target: string, path: string): Promise<void> {
  return symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}
