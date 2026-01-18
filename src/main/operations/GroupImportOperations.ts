import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { FileContext, GROUP_FILES } from "./FileContext";
import { loggers } from "../logger";

/**
 * Import groups from an external CSV file, merging with existing data
 */
export async function importGroupsWithMapping(ctx: FileContext, sourcePath: string): Promise<boolean> {
  try {
    const targetPath = join(ctx.rootDir, GROUP_FILES[0]);
    const sourceContent = await fs.readFile(sourcePath, "utf-8");
    const sourceDataRaw = await parseCsvAsync(sourceContent);
    const sourceData = sourceDataRaw.map((r) => r.map((c) => desanitizeField(c)));
    if (sourceData.length === 0) return false;

    if (await ctx.isDummyData(GROUP_FILES[0])) {
      loggers.fileManager.info("[GroupImport] Detected dummy groups. Clearing before import.");
      try { await fs.unlink(targetPath); } catch (e) { loggers.fileManager.error("[GroupImport] Failed to delete dummy groups file:", { error: e }); }
    }

    const sourceHeader = sourceData[0].map((h: unknown) => String(h).trim());
    const sourceRows = sourceData.slice(1);

    let targetData: string[][] = [];
    if (existsSync(targetPath)) {
      const existingContent = await fs.readFile(targetPath, "utf-8");
      const rawTarget = await parseCsvAsync(existingContent);
      targetData = rawTarget.map((r) => r.map((c) => desanitizeField(c)));
    }
    if (targetData.length === 0) targetData.push([]);

    const targetHeader = targetData[0];
    const getTargetGroupIdx = (groupName: string) => {
      let idx = targetHeader.findIndex((h: string) => h === groupName);
      if (idx === -1) {
        targetHeader.push(groupName);
        for (let i = 1; i < targetData.length; i++) targetData[i].push("");
        idx = targetHeader.length - 1;
      }
      return idx;
    };

    for (let col = 0; col < sourceHeader.length; col++) {
      const groupName = sourceHeader[col];
      if (!groupName) continue;

      const targetColIdx = getTargetGroupIdx(groupName);
      const sourceEmails = new Set<string>();
      for (const row of sourceRows) {
        const email = row[col];
        if (email && String(email).trim()) sourceEmails.add(String(email).trim());
      }

      const existingEmails = new Set<string>();
      const emptySlots: number[] = [];
      for (let i = 1; i < targetData.length; i++) {
        const email = targetData[i][targetColIdx];
        if (email && String(email).trim()) existingEmails.add(String(email).trim());
        else emptySlots.push(i);
      }

      let slotIndex = 0;
      for (const email of sourceEmails) {
        if (!existingEmails.has(email)) {
          if (slotIndex < emptySlots.length) {
            targetData[emptySlots[slotIndex]][targetColIdx] = email;
            slotIndex++;
          } else {
            const newRow = new Array(targetHeader.length).fill("");
            newRow[targetColIdx] = email;
            targetData.push(newRow);
          }
        }
      }
    }

    const csvOutput = ctx.safeStringify(targetData);
    await ctx.writeAndEmit(targetPath, csvOutput);
    void ctx.performBackup("importGroups");
    return true;
  } catch (e) {
    loggers.fileManager.error("[GroupImportOperations] importGroupsWithMapping error:", { error: e });
    return false;
  }
}
