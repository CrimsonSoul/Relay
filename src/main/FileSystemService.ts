import fs from 'fs/promises';
import { join } from 'path';
import { atomicWriteWithLock } from './fileLock';
import { validatePath } from './utils/pathSafety';

/**
 * FileSystemService - Handles low-level file system operations,
 * path validation, and atomic writes.
 *
 * All public methods that accept a file name or path validate it
 * against the root directory to prevent path-traversal attacks.
 */
export class FileSystemService {
  public readonly rootDir: string;
  public readonly bundledDataPath: string;

  constructor(rootDir: string, bundledPath: string) {
    this.rootDir = rootDir;
    this.bundledDataPath = bundledPath;
  }

  /**
   * Validates that `fileName` resolves to a path inside the given root.
   * Rejects traversal patterns, absolute paths, and UNC paths.
   */
  private async assertSafePath(fileName: string, root: string): Promise<void> {
    const isValid = await validatePath(fileName, root);
    if (!isValid) {
      throw new Error(`Path validation failed: "${fileName}" escapes root "${root}"`);
    }
  }

  public async readFile(fileName: string): Promise<string | null> {
    await this.assertSafePath(fileName, this.rootDir);
    const path = join(this.rootDir, fileName);
    try {
      return await fs.readFile(path, 'utf-8');
    } catch (e: unknown) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as NodeJS.ErrnoException).code === 'ENOENT'
      )
        return null;
      throw e;
    }
  }

  public async atomicWrite(fileName: string, content: string): Promise<void> {
    await this.assertSafePath(fileName, this.rootDir);
    const path = join(this.rootDir, fileName);
    const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
    await retryFileOperation(
      () => atomicWriteWithLock(path, contentWithBom),
      `atomicWrite(${fileName})`
    );
  }
}
