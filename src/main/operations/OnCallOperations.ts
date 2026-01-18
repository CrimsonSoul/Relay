/**
 * OnCallOperations - On-call CRUD operations. Parsing is in OnCallParser.ts.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { OnCallRow } from "@shared/ipc";
import { ONCALL_COLUMNS } from "@shared/csvTypes";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { FileContext, ONCALL_FILES } from "./FileContext";
import { logger } from "../logger";
import { saveAllOnCall } from "./OnCallIO";

import { parseOnCall } from "./OnCallParser";
export { parseOnCall };

export async function updateOnCallTeam(ctx: FileContext, team: string, rows: OnCallRow[]): Promise<boolean> {
  try {

    const allRows = await parseOnCall(ctx);
    const existingTeams = Array.from(new Set(allRows.map((r) => r.team)));
    if (!existingTeams.includes(team)) return await saveAllOnCall(ctx, [...allRows, ...rows]);
    const merged: OnCallRow[] = [];
    existingTeams.forEach((t) => { if (t === team) merged.push(...rows); else merged.push(...allRows.filter((r) => r.team === t)); });
    return await saveAllOnCall(ctx, merged);
  } catch (e) { logger.error("OnCallOperations", "updateOnCallTeam error", { error: e }); return false; }
}

export async function removeOnCallTeam(ctx: FileContext, team: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, ONCALL_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((cell) => desanitizeField(cell)));
    if (workingData.length < 2) return false;
    const header = workingData[0].map((h) => String(h).toLowerCase());
    const teamIdx = header.indexOf(ONCALL_COLUMNS.TEAM.toLowerCase());
    if (teamIdx === -1) return false;
    const newData = [workingData[0]]; let removed = false;
    for (let i = 1; i < workingData.length; i++) { if (workingData[i][teamIdx] !== team) newData.push(workingData[i]); else removed = true; }
    if (removed) { const csvOutput = ctx.safeStringify(newData); await ctx.writeAndEmit(path, csvOutput); void ctx.performBackup("removeOnCallTeam"); return true; }
    return false;
  } catch (e) { logger.error("OnCallOperations", "removeOnCallTeam error", { error: e }); return false; }
}

export async function renameOnCallTeam(ctx: FileContext, oldName: string, newName: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, ONCALL_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((cell) => desanitizeField(cell)));
    if (workingData.length < 2) return false;
    const header = workingData[0].map((h) => String(h).toLowerCase());
    const teamIdx = header.indexOf(ONCALL_COLUMNS.TEAM.toLowerCase());
    if (teamIdx === -1) return false;
    let renamed = false;
    for (let i = 1; i < workingData.length; i++) { if (workingData[i][teamIdx] === oldName) { workingData[i][teamIdx] = newName; renamed = true; } }
    if (renamed) { const csvOutput = ctx.safeStringify(workingData); await ctx.writeAndEmit(path, csvOutput); void ctx.performBackup("renameOnCallTeam"); return true; }
    return false;
  } catch (e) { logger.error("OnCallOperations", "renameOnCallTeam error", { error: e }); return false; }
}

export async function reorderOnCallTeams(ctx: FileContext, teamOrder: string[]): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, ONCALL_FILES[0]);
    if (!existsSync(path)) return false;
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((cell) => desanitizeField(cell)));

    if (workingData.length < 2) return false;
    const header = workingData[0];
    const headerLower = header.map((h) => String(h).toLowerCase());
    const teamIdx = headerLower.indexOf(ONCALL_COLUMNS.TEAM.toLowerCase());

    if (teamIdx === -1) return false;

    const rows = workingData.slice(1);
    const teamMap = new Map<string, string[][]>();

    rows.forEach(row => {
      const team = row[teamIdx];
      const list = teamMap.get(team) || [];
      list.push(row);
      teamMap.set(team, list);
    });

    const newData = [header];
    const processedTeams = new Set<string>();

    for (const team of teamOrder) {
      if (teamMap.has(team)) {
        newData.push(...teamMap.get(team)!);
        processedTeams.add(team);
      }
    }

    for (const [team, teamRows] of teamMap.entries()) {
      if (!processedTeams.has(team)) {
        newData.push(...teamRows);
      }
    }

    const csvOutput = ctx.safeStringify(newData);
    await ctx.writeAndEmit(path, csvOutput);
    void ctx.performBackup("reorderOnCallTeams");
    return true;
  } catch (e) {
    logger.error("OnCallOperations", "reorderOnCallTeams error", { error: e });
    return false;
  }
}

