import { join } from "path";
import fs from "fs/promises";
import { loggers } from "../logger";
import {
  GROUP_FILES,
  CONTACT_FILES,
  SERVER_FILES,
  ONCALL_FILES,
  JSON_DATA_FILES,
} from "./FileContext";

/**
 * Format a date component with leading zero padding
 */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format local date as YYYY-MM-DD
 */
function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Format local time as HH-MM-SS
 */
function formatLocalTime(date: Date): string {
  return `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/**
 * Perform a backup of all data files.
 * Returns the backup path on success, or null on failure.
 */
export async function performBackup(rootDir: string, reason: string = "auto"): Promise<string | null> {
  try {
    const backupDir = join(rootDir, "backups");
    // Ensure backup root exists
    await fs.mkdir(backupDir, { recursive: true });

    // Use local time for backup folder naming to avoid timezone confusion
    const now = new Date();
    const datePart = formatLocalDate(now);
    const timePart = formatLocalTime(now);
    const backupFolderName = `${datePart}_${timePart}`;

    const backupPath = join(backupDir, backupFolderName);

    // Create folder and copy files
    await fs.mkdir(backupPath, { recursive: true });

    const filesToBackup = [
      ...GROUP_FILES,
      ...CONTACT_FILES,
      ...SERVER_FILES,
      ...ONCALL_FILES,
      ...JSON_DATA_FILES,
      // Additional JSON files
      "bridgeHistory.json",
      "notes.json",
      "savedLocations.json",
    ];
    for (const file of filesToBackup) {
      const sourcePath = join(rootDir, file);
      const destPath = join(backupPath, file);
      try {
        await fs.copyFile(sourcePath, destPath);
      } catch (err: unknown) {
        // Ignore if file doesn't exist (might be fresh install)
        const error = err as NodeJS.ErrnoException;
        if (error.code !== "ENOENT") {
          loggers.fileManager.error(`Failed to backup ${file}`, { error: err });
        }
      }
    }

    // Retention Policy: Keep last 30 DAYS worth of data
    const backups = await fs.readdir(backupDir);
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    for (const dirName of backups) {
      // Match YYYY-MM-DD_...
      const match = dirName.match(/^(\d{4}-\d{2}-\d{2})/);
      if (match) {
        // Parse folder date as local midnight for consistent comparison
        const [year, month, day] = match[1].split("-").map(Number);
        const folderDateMs = new Date(year, month - 1, day).getTime();
        // Delete if older than 30 days from start of today
        if (todayStart - folderDateMs > THIRTY_DAYS_MS) {
          const dirPath = join(backupDir, dirName);
          await fs.rm(dirPath, { recursive: true, force: true });
          loggers.fileManager.debug(`Pruned old backup: ${dirName}`);
        }
      }
    }

    loggers.fileManager.info(`Backup created: ${backupFolderName} (${reason})`);
    return backupPath;
  } catch (error) {
    loggers.fileManager.error("Backup failed", { error });
    return null;
  }
}
