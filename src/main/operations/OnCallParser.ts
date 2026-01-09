import { join } from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import type { OnCallRow } from "@shared/ipc";
import { STD_ONCALL_HEADERS } from "@shared/csvTypes";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { FileContext, ONCALL_FILES } from "./FileContext";
import { logger } from "../logger";
import { saveAllOnCall } from "./OnCallIO";

/** Migration from legacy format (Primary/Backup columns) to new format */
async function migrateLegacyOnCall(ctx: FileContext, header: string[], rows: string[][]): Promise<OnCallRow[]> {
  logger.info("OnCallParser", "Detected legacy on-call format. Migrating...");
  const teamIdx = header.indexOf("team"), primaryIdx = header.indexOf("primary"), backupIdx = header.indexOf("backup"), labelIdx = header.indexOf("label");
  if (teamIdx === -1) return [];

  const migratedRows: OnCallRow[] = [];
  for (const row of rows) {
    const team = desanitizeField(row[teamIdx]), primary = primaryIdx !== -1 ? desanitizeField(row[primaryIdx]) : "", backup = backupIdx !== -1 ? desanitizeField(row[backupIdx]) : "", label = labelIdx !== -1 ? desanitizeField(row[labelIdx]) : "BACKUP";
    if (team) {
      if (primary) migratedRows.push({ id: randomUUID(), team, role: "Primary", name: "", contact: primary });
      if (backup) migratedRows.push({ id: randomUUID(), team, role: label || "Backup", name: "", contact: backup });
    }
  }
  
  // Import saveAllOnCall to complete migration
  await saveAllOnCall(ctx, migratedRows);
  return migratedRows;
}

/** Parse modern format oncall.csv */
function parseModernFormat(header: string[], rows: string[][]): OnCallRow[] {
  const teamIdx = header.indexOf("team"), roleIdx = header.indexOf("role"), nameIdx = header.indexOf("name");
  const contactIdx = header.findIndex((h) => h === "contact" || h === "email" || h === "phone");
  const timeWindowIdx = header.findIndex((h) => h === "time window" || h === "timewindow" || h === "shift" || h === "hours");

  return rows.map((row: string[]) => ({
    id: randomUUID(), team: desanitizeField(row[teamIdx] || ""), role: roleIdx !== -1 ? desanitizeField(row[roleIdx] || "") : "",
    name: nameIdx !== -1 ? desanitizeField(row[nameIdx] || "") : "", contact: contactIdx !== -1 ? desanitizeField(row[contactIdx] || "") : "",
    timeWindow: timeWindowIdx !== -1 ? desanitizeField(row[timeWindowIdx] || "") : "",
  })).filter((r) => r.team);
}

/** Parse oncall.csv into an array of OnCallRow objects */
export async function parseOnCall(ctx: FileContext): Promise<OnCallRow[]> {
  let path = ctx.resolveExistingFile(ONCALL_FILES);
  if (!path) {
    logger.debug("OnCallParser", "oncall.csv not found. Creating default...");
    path = join(ctx.rootDir, ONCALL_FILES[0]);
    try { await fs.writeFile(path, STD_ONCALL_HEADERS.join(",") + "\n", "utf-8"); logger.debug("OnCallParser", `Created ${path}`); }
    catch (e) { logger.error("OnCallParser", "Failed to create oncall.csv", { error: e }); return []; }
  }

  try {
    const contents = await fs.readFile(path, "utf-8");
    const data = (await parseCsvAsync(contents)) as string[][];
    if (data.length < 2) return [];

    const header = data[0].map((h: string) => desanitizeField(h.trim().toLowerCase()));
    const rows = data.slice(1);

    // Check for legacy format
    if (header.includes("primary") && header.includes("backup")) {
      return migrateLegacyOnCall(ctx, header, rows);
    }
    return parseModernFormat(header, rows);
  } catch (e) {
    logger.error("OnCallParser", "Error parsing oncall", { error: e });
    return [];
  }
}
