import fs from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { atomicWriteWithLock } from "./fileLock";
import { validatePath } from "./utils/pathSafety";
import { loggers } from "./logger";
import { retryFileOperation } from "./retryUtils";

/**
 * FileSystemService - Handles low-level file system operations,
 * path validation, and atomic writes.
 */
export class FileSystemService {
  public readonly rootDir: string;
  public readonly bundledDataPath: string;

  constructor(rootDir: string, bundledPath: string) {
    this.rootDir = rootDir;
    this.bundledDataPath = bundledPath;
  }

  public async resolveExistingFile(fileNames: string[]): Promise<string | null> {
    for (const fileName of fileNames) {
      const isValid = await validatePath(fileName, this.rootDir);
      if (!isValid) {
        loggers.fileManager.warn(`Blocked potentially unsafe file resolution attempt: ${fileName}`);
        continue;
      }
      const path = join(this.rootDir, fileName);
      if (existsSync(path)) return path;
    }
    return null;
  }

  public hasJsonData(): boolean {
    return existsSync(join(this.rootDir, "contacts.json")) ||
           existsSync(join(this.rootDir, "servers.json")) ||
           existsSync(join(this.rootDir, "oncall.json"));
  }

  public async isDummyData(fileName: string): Promise<boolean> {
    try {
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
    const path = join(this.rootDir, fileName);
    if (!existsSync(path)) return null;
    return retryFileOperation(
      () => fs.readFile(path, "utf-8"),
      `readFile(${fileName})`
    );
  }

  public async atomicWrite(fileName: string, content: string): Promise<void> {
    const path = join(this.rootDir, fileName);
    const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
    await retryFileOperation(
      () => atomicWriteWithLock(path, contentWithBom),
      `atomicWrite(${fileName})`
    );
  }

  public async atomicWriteFullPath(fullPath: string, content: string): Promise<void> {
    const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
    await retryFileOperation(
      () => atomicWriteWithLock(fullPath, contentWithBom),
      `atomicWriteFullPath(${fullPath})`
    );
  }
}
