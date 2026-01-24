import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { dialog, BrowserWindow } from "electron";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { cleanAndFormatPhoneNumber } from '../../shared/phoneUtils';
import { CONTACT_COLUMN_ALIASES } from "@shared/csvTypes";
import { FileContext, CONTACT_FILES } from "./FileContext";
import { loggers } from "../logger";
import { rateLimiters } from "../rateLimiter";

/**
 * Show a file dialog and import contacts from the selected CSV file.
 */
export async function importContactsViaDialog(
  ctx: FileContext,
  browserWindow: BrowserWindow,
  title: string = 'Import Contacts CSV'
): Promise<{ success: boolean; rateLimited?: boolean; error?: string }> {
  const rateLimitResult = rateLimiters.fileImport.tryConsume();
  if (!rateLimitResult.allowed) {
    loggers.ipc.warn(`Import blocked, retry after ${rateLimitResult.retryAfterMs}ms`);
    return { success: false, rateLimited: true };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, {
    title,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }

  const success = await importContactsWithMapping(ctx, filePaths[0]);
  return { success };
}

/**
 * Import contacts from an external CSV file, merging with existing data
 */
export async function importContactsWithMapping(
  ctx: FileContext,
  sourcePath: string
): Promise<boolean> {
  try {
    const targetPath = join(ctx.rootDir, CONTACT_FILES[0]);

    // Read source first
    const sourceContent = await fs.readFile(sourcePath, "utf-8");
    const sourceDataRaw = await parseCsvAsync(sourceContent);
    const sourceData = sourceDataRaw.map((r) =>
      r.map((c) => desanitizeField(c))
    );
    if (sourceData.length < 2) return false;

    // Check if current contacts are dummy data
    if (await ctx.isDummyData(CONTACT_FILES[0])) {
      loggers.fileManager.info(
        "[ContactImportOperations] Detected dummy contacts. Clearing before import."
      );
      try {
        await fs.unlink(targetPath);
      } catch (e) {
        loggers.fileManager.error(
          "[ContactImportOperations] Failed to delete dummy contacts file:",
          { error: e }
        );
      }
    }

    const sourceHeader = sourceData[0].map((h: unknown) =>
      String(h).toLowerCase().trim()
    );
    const sourceRows = sourceData.slice(1);

    const mapHeader = (candidates: string[]) => {
      for (const candidate of candidates) {
        const idx = sourceHeader.indexOf(candidate);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const srcNameIdx = mapHeader(CONTACT_COLUMN_ALIASES.name);
    const srcEmailIdx = mapHeader(CONTACT_COLUMN_ALIASES.email);
    const srcPhoneIdx = mapHeader(CONTACT_COLUMN_ALIASES.phone);
    const srcTitleIdx = mapHeader(CONTACT_COLUMN_ALIASES.title);

    if (srcEmailIdx === -1) {
      loggers.fileManager.error(
        "[ContactImportOperations] Import failed: No email column found."
      );
      return false;
    }

    let targetData: string[][] = [];
    if (existsSync(targetPath)) {
      const existingContent = await fs.readFile(targetPath, "utf-8");
      const rawTarget = await parseCsvAsync(existingContent);
      targetData = rawTarget.map((r) => r.map((c) => desanitizeField(c)));
    }

    if (targetData.length === 0) {
      targetData.push(["Name", "Email", "Phone", "Title"]);
    }

    const targetHeader = targetData[0].map((h: unknown) => String(h).toLowerCase());

    const getTargetIdx = (name: string) => {
      let idx = targetHeader.findIndex((h: string) => h === name.toLowerCase());
      if (idx === -1) {
        targetHeader.push(name.toLowerCase());
        targetData[0].push(name);
        for (let i = 1; i < targetData.length; i++) targetData[i].push("");
        idx = targetHeader.length - 1;
      }
      return idx;
    };

    const tgtNameIdx = getTargetIdx("Name");
    const tgtEmailIdx = getTargetIdx("Email");
    const tgtPhoneIdx = getTargetIdx("Phone");
    const tgtTitleIdx = getTargetIdx("Title");

    const emailToRowIdx = new Map<string, number>();
    for (let i = 1; i < targetData.length; i++) {
      const existingEmail = targetData[i][tgtEmailIdx]?.trim().toLowerCase();
      if (existingEmail) {
        emailToRowIdx.set(existingEmail, i);
      }
    }

    for (const srcRow of sourceRows) {
      const email = srcRow[srcEmailIdx]?.trim();
      if (!email) continue;

      const name = srcNameIdx !== -1 ? srcRow[srcNameIdx] : "";
      const title = srcTitleIdx !== -1 ? srcRow[srcTitleIdx] : "";
      let phone = srcPhoneIdx !== -1 ? srcRow[srcPhoneIdx] : "";

      if (phone) phone = cleanAndFormatPhoneNumber(String(phone));

      const matchRowIdx = emailToRowIdx.get(email.toLowerCase());

      if (matchRowIdx !== undefined) {
        if (name) targetData[matchRowIdx][tgtNameIdx] = name;
        if (phone) targetData[matchRowIdx][tgtPhoneIdx] = phone;
        if (title) targetData[matchRowIdx][tgtTitleIdx] = title;
      } else {
        const newRow = new Array(targetData[0].length).fill("");
        newRow[tgtEmailIdx] = email;
        newRow[tgtNameIdx] = name;
        newRow[tgtPhoneIdx] = phone;
        newRow[tgtTitleIdx] = title;
        targetData.push(newRow);
        emailToRowIdx.set(email.toLowerCase(), targetData.length - 1);
      }
    }

    const csvOutput = ctx.safeStringify(targetData);
    await ctx.writeAndEmit(targetPath, csvOutput);
    void ctx.performBackup("importContacts");
    return true;
  } catch (e) {
    loggers.fileManager.error("[ContactImportOperations] importContactsWithMapping error:", { error: e });
    return false;
  }
}
