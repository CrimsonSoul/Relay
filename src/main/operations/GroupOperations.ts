/**
 * GroupOperations - Group CRUD operations
 * Import operations are in GroupImportOperations.ts.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { GroupMap } from "@shared/ipc";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { FileContext, GROUP_FILES } from "./FileContext";

export async function parseGroups(ctx: FileContext): Promise<GroupMap> {
  const path = ctx.resolveExistingFile(GROUP_FILES);
  if (!path) return {};
  try {
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);
    if (!data || data.length === 0) return {};
    const groups: GroupMap = {};
    const maxCols = data[0].length;
    for (let col = 0; col < maxCols; col++) {
      const groupName = desanitizeField(data[0][col]);
      if (!groupName) continue;
      const emails: string[] = [];
      for (let row = 1; row < data.length; row++) {
        const email = desanitizeField(data[row][col]);
        if (email) emails.push(String(email).trim());
      }
      groups[String(groupName).trim()] = emails;
    }
    return groups;
  } catch (e) { console.error("Error parsing groups:", e); return {}; }
}

export async function addGroup(ctx: FileContext, groupName: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, GROUP_FILES[0]);
    let contents = existsSync(path) ? await fs.readFile(path, "utf-8") : "";
    const data = (await parseCsvAsync(contents)) as string[][];
    const workingData = data.map((row: string[]) => row.map((c: string) => desanitizeField(c)));
    if (workingData.length === 0) { workingData.push([groupName]); }
    else {
      if (workingData[0].includes(groupName)) return true;
      workingData[0].push(groupName);
      for (let i = 1; i < workingData.length; i++) workingData[i].push("");
    }
    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    ctx.performBackup("addGroup");
    return true;
  } catch (e) { console.error("[GroupOperations] addGroup error:", e); return false; }
}

export async function updateGroupMembership(ctx: FileContext, groupName: string, email: string, remove: boolean): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, GROUP_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = (await parseCsvAsync(contents)) as string[][];
    const workingData = data.map((row: string[]) => row.map((c: string) => desanitizeField(c)));
    if (workingData.length === 0) return false;
    const groupIdx = workingData[0].indexOf(groupName);
    if (groupIdx === -1) return false;
    let rowIndex = -1;
    for (let i = 1; i < workingData.length; i++) { if (workingData[i][groupIdx] === email) { rowIndex = i; break; } }
    if (remove) {
      if (rowIndex !== -1) {
        workingData[rowIndex][groupIdx] = "";
        for (let i = rowIndex; i < workingData.length - 1; i++) workingData[i][groupIdx] = workingData[i + 1][groupIdx];
        workingData[workingData.length - 1][groupIdx] = "";
      }
    } else {
      if (rowIndex !== -1) return true;
      let added = false;
      for (let i = 1; i < workingData.length; i++) { if (!workingData[i][groupIdx]) { workingData[i][groupIdx] = email; added = true; break; } }
      if (!added) { const newRow = new Array(workingData[0].length).fill(""); newRow[groupIdx] = email; workingData.push(newRow); }
    }
    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    ctx.performBackup("updateGroupMembership");
    return true;
  } catch (e) { console.error("[GroupOperations] updateGroupMembership error:", e); return false; }
}

export async function removeGroup(ctx: FileContext, groupName: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, GROUP_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = (await parseCsvAsync(contents)) as string[][];
    const workingData = data.map((row: string[]) => row.map((c: string) => desanitizeField(c)));
    if (workingData.length === 0) return false;
    const groupIdx = workingData[0].indexOf(groupName);
    if (groupIdx === -1) return false;
    for (let i = 0; i < workingData.length; i++) workingData[i].splice(groupIdx, 1);
    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    ctx.performBackup("removeGroup");
    return true;
  } catch (e) { console.error("[GroupOperations] removeGroup error:", e); return false; }
}

export async function renameGroup(ctx: FileContext, oldName: string, newName: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, GROUP_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = (await parseCsvAsync(contents)) as string[][];
    const workingData = data.map((row: string[]) => row.map((c: string) => desanitizeField(c)));
    if (workingData.length === 0) return false;
    const groupIdx = workingData[0].indexOf(oldName);
    if (groupIdx === -1) return false;
    if (workingData[0].includes(newName)) {
      const targetIdx = workingData[0].indexOf(newName);
      for (let i = 1; i < workingData.length; i++) { const email = workingData[i][groupIdx]; if (email && !workingData[i][targetIdx]) workingData[i][targetIdx] = email; }
      for (let i = 0; i < workingData.length; i++) workingData[i].splice(groupIdx, 1);
    } else { workingData[0][groupIdx] = newName; }
    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    ctx.performBackup("renameGroup");
    return true;
  } catch (e) { console.error("[GroupOperations] renameGroup error:", e); return false; }
}
