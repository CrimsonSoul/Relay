import { join } from "path";
import fs from "fs/promises";
import { loggers } from "../logger";
import {
  GROUP_FILES,
  CONTACT_FILES,
  SERVER_FILES,
  ONCALL_FILES,
} from "./FileContext";

/**
 * Perform a backup of all data files
 */
export async function performBackup(rootDir: string, reason: string = "auto") {
  try {
    const backupDir = join(rootDir, "backups");
    // Ensure backup root exists
    await fs.mkdir(backupDir, { recursive: true });

    // Use higher resolution timestamp for "on change" backups
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localTime = new Date(now.getTime() - offset);
    const datePart = localTime.toISOString().slice(0, 10);
    const timePart = localTime.toISOString().slice(11, 19).replace(/:/g, "-");
    const backupFolderName = `${datePart}_${timePart}`;

    const backupPath = join(backupDir, backupFolderName);

    // Create folder and copy files
    await fs.mkdir(backupPath, { recursive: true });

    const filesToBackup = [
      ...GROUP_FILES,
      ...CONTACT_FILES,
      ...SERVER_FILES,
      ...ONCALL_FILES,
    ];
    for (const file of filesToBackup) {
      const sourcePath = join(rootDir, file);
      const destPath = join(backupPath, file);
      try {
        await fs.copyFile(sourcePath, destPath);
      } catch (err: any) {
        // Ignore if file doesn't exist (might be fresh install)
        if (err.code !== "ENOENT") {
          loggers.fileManager.error(`Failed to backup ${file}`, { error: err });
        }
      }
    }

    // Retention Policy: Keep last 30 DAYS worth of data
    const backups = await fs.readdir(backupDir);
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();

    for (const dirName of backups) {
      // Match YYYY-MM-DD_...
      const match = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const folderDate = new Date(match[1]);
        // Simple cleanup: if older than 30 days, delete
        if (nowMs - folderDate.getTime() > THIRTY_DAYS_MS) {
          const dirPath = join(backupDir, dirName);
          await fs.rm(dirPath, { recursive: true, force: true });
          loggers.fileManager.debug(`Pruned old backup: ${dirName}`);
        }
      }
    }
  } catch (error) {
    loggers.fileManager.error("Backup failed", { error });
  }
}
