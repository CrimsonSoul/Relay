import fs from "fs/promises";
import { join, resolve, relative, isAbsolute } from "path";
import { atomicWriteWithLock } from "./fileLock";
import { validatePath } from "./utils/pathSafety";
import { loggers } from "./logger";

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

  public async resolveExistingFile(fileNames: string[]): Promise<string | null> {
    for (const fileName of fileNames) {
      const isValid = await validatePath(fileName, this.rootDir);
      if (!isValid) {
        loggers.fileManager.warn(`Blocked potentially unsafe file resolution attempt: ${fileName}`);
        continue;
      }
      const path = join(this.rootDir, fileName);
      try {
        await fs.access(path);
        return path;
      } catch {
        // File doesn't exist, try next
      }
    }
    return null;
  }

  public async hasJsonData(): Promise<boolean> {
    const files = ["contacts.json", "servers.json", "oncall.json"];
    for (const file of files) {
      try {
        await fs.access(join(this.rootDir, file));
        return true;
      } catch {
        // File doesn't exist, try next
      }
    }
    return false;
  }

  public async isDummyData(fileName: string): Promise<boolean> {
    try {
      await this.assertSafePath(fileName, this.rootDir);
      await this.assertSafePath(fileName, this.bundledDataPath);

      const [current, bundled] = await Promise.all([
        fs.readFile(join(this.rootDir, fileName), "utf-8"),
        fs.readFile(join(this.bundledDataPath, fileName), "utf-8")
      ]);
      return current.replace(/\r\n/g, "\n").trim() === bundled.replace(/\r\n/g, "\n").trim();
    } catch (e) {
      loggers.fileManager.debug('isDummyData check failed', { fileName, error: e });
      return false;
    }
  }

  public async readFile(fileName: string): Promise<string | null> {
    await this.assertSafePath(fileName, this.rootDir);
    const path = join(this.rootDir, fileName);
    try {
      return await fs.readFile(path, "utf-8");
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  public async atomicWrite(fileName: string, content: string): Promise<void> {
    await this.assertSafePath(fileName, this.rootDir);
    const path = join(this.rootDir, fileName);
    const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
    await atomicWriteWithLock(path, contentWithBom);
  }

  /**
   * Write to an absolute path. The path MUST resolve inside rootDir.
   * This prevents callers from writing to arbitrary locations.
   */
  public async atomicWriteFullPath(fullPath: string, content: string): Promise<void> {
    // Validate that the full path is within rootDir
    const resolved = resolve(fullPath);
    const rel = relative(this.rootDir, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      loggers.security.error(`Blocked write to path outside data root: ${fullPath}`);
      throw new Error(`Path validation failed: "${fullPath}" is outside root "${this.rootDir}"`);
    }
    const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
    await atomicWriteWithLock(fullPath, contentWithBom);
  }
}
