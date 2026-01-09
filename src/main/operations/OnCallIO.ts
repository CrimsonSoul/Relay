import { join } from "path";
import type { OnCallRow } from "@shared/ipc";
import { STD_ONCALL_HEADERS } from "@shared/csvTypes";
import { FileContext, ONCALL_FILES } from "./FileContext";
import { logger } from "../logger";

export async function saveAllOnCall(ctx: FileContext, rows: OnCallRow[]): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, ONCALL_FILES[0]);
    const csvData = [[...STD_ONCALL_HEADERS, "Time Window"], ...rows.map((r) => [r.team, r.role, r.name, r.contact, r.timeWindow || ""])];
    const csvOutput = ctx.safeStringify(csvData);
    await ctx.writeAndEmit(path, csvOutput);
    ctx.performBackup("saveAllOnCall");
    return true;
  } catch (e) { logger.error("OnCallOperations", "saveAllOnCall error", { error: e }); return false; }
}
