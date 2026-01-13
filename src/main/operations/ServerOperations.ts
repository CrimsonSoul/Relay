/**
 * ServerOperations - Server CRUD operations. Parsing is in ServerParser.ts.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { Server } from "@shared/ipc";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { HeaderMatcher } from "../HeaderMatcher";
import { STD_SERVER_HEADERS, SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { FileContext, SERVER_FILES } from "./FileContext";
import { loggers } from "../logger";

export { parseServers } from "./ServerParser";

export async function addServer(ctx: FileContext, server: Partial<Server>): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, SERVER_FILES[0]);
    let contents = existsSync(path) ? await fs.readFile(path, "utf-8") : "";
    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((cell) => desanitizeField(cell)));
    if (workingData.length === 0) workingData.push([...STD_SERVER_HEADERS]);

    const workingHeader = workingData[0];
    const matcher = new HeaderMatcher(workingHeader);

    const nameIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.name, STD_SERVER_HEADERS[0], workingData);
    const baIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.businessArea, STD_SERVER_HEADERS[1], workingData);
    const lobIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.lob, STD_SERVER_HEADERS[2], workingData);
    const comIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.comment, STD_SERVER_HEADERS[3], workingData);
    const ownerIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.owner, STD_SERVER_HEADERS[4], workingData);
    const conIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.contact, STD_SERVER_HEADERS[5], workingData);
    const osIdx = matcher.ensureColumn(SERVER_COLUMN_ALIASES.os, STD_SERVER_HEADERS[6], workingData);

    let rowIndex = -1;
    if (server.name) {
      const lowerName = server.name.toLowerCase();
      rowIndex = workingData.findIndex((row, idx) => idx > 0 && row[nameIdx]?.trim().toLowerCase() === lowerName);
    }

    const setVal = (row: string[], idx: number, val?: string) => { if (idx !== -1 && val !== undefined) row[idx] = val; };

    if (rowIndex !== -1) {
      const row = workingData[rowIndex];
      setVal(row, nameIdx, server.name); setVal(row, baIdx, server.businessArea); setVal(row, lobIdx, server.lob);
      setVal(row, comIdx, server.comment); setVal(row, ownerIdx, server.owner); setVal(row, conIdx, server.contact); setVal(row, osIdx, server.os);
    } else {
      const newRow = new Array(workingHeader.length).fill("");
      setVal(newRow, nameIdx, server.name); setVal(newRow, baIdx, server.businessArea); setVal(newRow, lobIdx, server.lob);
      setVal(newRow, comIdx, server.comment); setVal(newRow, ownerIdx, server.owner); setVal(newRow, conIdx, server.contact); setVal(newRow, osIdx, server.os);
      workingData.push(newRow);
    }

    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    void ctx.performBackup("addServer");
    return true;
  } catch (e) { loggers.fileManager.error("[ServerOperations] addServer error:", { error: e }); return false; }
}

export async function removeServer(ctx: FileContext, name: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, SERVER_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((c) => desanitizeField(c)));
    if (workingData.length < 2) return false;
    const header = workingData[0].map((h) => String(h).toLowerCase());
    const nameIdx = header.findIndex((h) => ["name", "server name", "vm-m"].includes(h));
    if (nameIdx === -1) return false;

    const newData = [workingData[0]]; let removed = false;
    for (let i = 1; i < workingData.length; i++) {
      if (workingData[i][nameIdx]?.trim().toLowerCase() === name.toLowerCase()) removed = true;
      else newData.push(workingData[i]);
    }
    if (removed) { await ctx.writeAndEmit(path, ctx.safeStringify(newData)); void ctx.performBackup("removeServer"); return true; }
    return false;
  } catch (e) { loggers.fileManager.error("[ServerOperations] removeServer error:", { error: e }); return false; }
}
