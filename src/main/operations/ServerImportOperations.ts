import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { dialog, BrowserWindow } from "electron";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { FileContext, SERVER_FILES } from "./FileContext";
import { cleanupServerContacts } from "./ServerCleanup";
import { loggers } from "../logger";
import { rateLimiters } from "../rateLimiter";

export { cleanupServerContacts };

/**
 * Show a file dialog and import servers from the selected CSV file.
 */
export async function importServersViaDialog(
  ctx: FileContext,
  browserWindow: BrowserWindow,
  title: string = 'Import Servers CSV'
): Promise<{ success: boolean; rateLimited?: boolean; message?: string }> {
  const rateLimitResult = rateLimiters.fileImport.tryConsume();
  if (!rateLimitResult.allowed) {
    return { success: false, rateLimited: true };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(browserWindow, {
    title,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile']
  });

  if (canceled || filePaths.length === 0) {
    return { success: false, message: 'Cancelled' };
  }

  return importServersWithMapping(ctx, filePaths[0]);
}

const STD_HEADERS = ["Name", "Business Area", "LOB", "Comment", "Owner", "IT Contact", "OS"];

export async function importServersWithMapping(ctx: FileContext, sourcePath: string): Promise<{ success: boolean; message?: string }> {
  try {
    const targetPath = join(ctx.rootDir, SERVER_FILES[0]);
    const sourceContent = await fs.readFile(sourcePath, "utf-8");
    const lines = sourceContent.split(/\r?\n/);
    if (lines.length === 0) return { success: false, message: "Empty source file" };

    if (await ctx.isDummyData(SERVER_FILES[0])) {
      loggers.fileManager.info("[ServerImport] Detected dummy servers. Clearing.");
      try { await fs.unlink(targetPath); } catch { /* File may not exist */ }
    }

    let headerLineIndex = -1;
    for (let i = 0; i < Math.min(lines.length, 20); i++) { if (lines[i].toLowerCase().includes("vm-m") || lines[i].toLowerCase().includes("server name") || lines[i].toLowerCase().includes("name")) { headerLineIndex = i; break; } }
    if (headerLineIndex === -1) return { success: false, message: 'Could not find header in first 20 lines.' };

    const cleanContents = lines.slice(headerLineIndex).join("\n");
    const sourceData = (await parseCsvAsync(cleanContents)).map((r) => r.map((c) => desanitizeField(c)));
    if (sourceData.length < 2) return { success: false, message: "File appears empty." };

    const sourceHeader = sourceData[0].map((h: unknown) => String(h).toLowerCase().trim());
    const sourceRows = sourceData.slice(1);

    const mapHeader = (candidates: readonly string[]) => { for (const c of candidates) { const idx = sourceHeader.indexOf(c); if (idx !== -1) return idx; } return -1; };
    const s_nameIdx = mapHeader(SERVER_COLUMN_ALIASES.name), s_baIdx = mapHeader(SERVER_COLUMN_ALIASES.businessArea), s_lobIdx = mapHeader(SERVER_COLUMN_ALIASES.lob);
    const s_commentIdx = mapHeader(SERVER_COLUMN_ALIASES.comment), s_ownerIdx = mapHeader(SERVER_COLUMN_ALIASES.owner), s_contactIdx = mapHeader(SERVER_COLUMN_ALIASES.contact), s_osTypeIdx = mapHeader(SERVER_COLUMN_ALIASES.os);
    if (s_nameIdx === -1) return { success: false, message: 'No "Name" column found.' };

    let targetData: string[][] = existsSync(targetPath) ? (await parseCsvAsync(await fs.readFile(targetPath, "utf-8"))).map((r) => r.map((c) => desanitizeField(c))) : [];
    if (targetData.length === 0) targetData.push(STD_HEADERS);
    const targetHeader = targetData[0].map((h) => String(h).toLowerCase());

    const ensureTargetCol = (name: string) => { let idx = targetHeader.findIndex((h) => h === name.toLowerCase()); if (idx === -1) { targetHeader.push(name.toLowerCase()); targetData[0].push(name); for (let i = 1; i < targetData.length; i++) targetData[i].push(""); idx = targetHeader.length - 1; } return idx; };
    const t_nameIdx = ensureTargetCol("Name"), t_baIdx = ensureTargetCol("Business Area"), t_lobIdx = ensureTargetCol("LOB"), t_commentIdx = ensureTargetCol("Comment"), t_ownerIdx = ensureTargetCol("Owner"), t_contactIdx = ensureTargetCol("IT Contact"), t_osIdx = ensureTargetCol("OS");

    const nameToRowIdx = new Map<string, number>(); for (let i = 1; i < targetData.length; i++) { const n = targetData[i][t_nameIdx]?.trim().toLowerCase(); if (n) nameToRowIdx.set(n, i); }

    for (const row of sourceRows) {
      const name = row[s_nameIdx]?.trim(); if (!name) continue;
      const getValue = (idx: number) => idx !== -1 && row[idx] ? row[idx].trim() : "";
      const matchRowIdx = nameToRowIdx.get(name.toLowerCase());
      if (matchRowIdx !== undefined) { const tRow = targetData[matchRowIdx]; if (s_baIdx !== -1) tRow[t_baIdx] = getValue(s_baIdx); if (s_lobIdx !== -1) tRow[t_lobIdx] = getValue(s_lobIdx); if (s_commentIdx !== -1) tRow[t_commentIdx] = getValue(s_commentIdx); if (s_ownerIdx !== -1) tRow[t_ownerIdx] = getValue(s_ownerIdx); if (s_contactIdx !== -1) tRow[t_contactIdx] = getValue(s_contactIdx); if (s_osTypeIdx !== -1) tRow[t_osIdx] = getValue(s_osTypeIdx); }
      else { const newRow = new Array(targetData[0].length).fill(""); newRow[t_nameIdx] = name; newRow[t_baIdx] = getValue(s_baIdx); newRow[t_lobIdx] = getValue(s_lobIdx); newRow[t_commentIdx] = getValue(s_commentIdx); newRow[t_ownerIdx] = getValue(s_ownerIdx); newRow[t_contactIdx] = getValue(s_contactIdx); newRow[t_osIdx] = getValue(s_osTypeIdx); targetData.push(newRow); nameToRowIdx.set(name.toLowerCase(), targetData.length - 1); }
    }

    await ctx.writeAndEmit(targetPath, ctx.safeStringify(targetData)); void ctx.performBackup("importServers");
    await cleanupServerContacts(ctx);
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    loggers.fileManager.error("[ServerImport] Error:", { error: e });
    return { success: false, message };
  }
}
