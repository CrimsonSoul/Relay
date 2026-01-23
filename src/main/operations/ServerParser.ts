/**
 * ServerParser - Parsing logic for servers.csv
 */
import fs from "fs/promises";
import type { Server } from "@shared/ipc";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { HeaderMatcher } from "../HeaderMatcher";
import { validateServers } from "../csvValidation";
import { STD_SERVER_HEADERS, SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { FileContext, SERVER_FILES } from "./FileContext";
import { loggers } from "../logger";

export async function parseServers(ctx: FileContext): Promise<Server[]> {
  const path = await ctx.resolveExistingFile(SERVER_FILES);
  if (!path) return [];

  try {
    const contents = await fs.readFile(path, "utf-8");
    const lines = contents.split(/\r?\n/);
    let headerLineIndex = 0;
    const possibleHeaders = ["VM-M", "Server Name", "Name"];
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].toLowerCase();
      if (possibleHeaders.some((h) => line.includes(h.toLowerCase()))) { headerLineIndex = i; break; }
    }

    const cleanContents = lines.slice(headerLineIndex).join("\n");
    const data = await parseCsvAsync(cleanContents);
    if (data.length < 2) return [];

    const header = data[0].map((h: unknown) => desanitizeField(String(h).trim().toLowerCase()));
    const rows = data.slice(1);
    const matcher = new HeaderMatcher(header);

    const nameIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.name);
    const baIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.businessArea);
    const lobIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.lob);
    const commentIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.comment);
    const ownerIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.owner);
    const contactIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.contact);
    const osIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.os);

    if (nameIdx === -1) {
      ctx.emitError({ type: "parse", message: "No Name column found in servers.csv", file: "servers.csv" });
      return [];
    }

    let needsRewrite = headerLineIndex > 0;
    const currentHeaderStr = data[0].map((h: string) => String(h).trim()).join(",");
    const stdHeaderStr = [...STD_SERVER_HEADERS].join(",");
    if (currentHeaderStr !== stdHeaderStr) needsRewrite = true;

    const results: Server[] = [];
    const cleanDataForRewrite: string[][] = [[...STD_SERVER_HEADERS]];

    for (const rowValues of rows) {
      const getVal = (idx: number) => (idx === -1 || idx >= rowValues.length) ? "" : desanitizeField(rowValues[idx]);
      const name = getVal(nameIdx);
      if (!name) continue;

      const businessArea = getVal(baIdx), lob = getVal(lobIdx), comment = getVal(commentIdx);
      const owner = getVal(ownerIdx), contact = getVal(contactIdx), os = getVal(osIdx);

      results.push({
        name, businessArea, lob, comment, owner, contact, os,
        _searchString: `${name} ${businessArea} ${lob} ${owner} ${contact} ${os} ${comment}`.toLowerCase(),
        raw: { name, "business area": businessArea, lob, comment, owner, "it contact": contact, os },
      });
      cleanDataForRewrite.push([name, businessArea, lob, comment, owner, contact, os]);
    }

    const validation = validateServers(results);
    if (validation.warnings.length > 0) {
      ctx.emitError({ type: "validation", message: `Found ${validation.warnings.length} validation warnings in servers.csv`, file: "servers.csv", details: validation.warnings });
    }

    if (needsRewrite) {
      loggers.fileManager.info("[ServerParser] servers.csv has old headers or is dirty. Rewriting...");
      void ctx.rewriteFileDetached(path, ctx.safeStringify(cleanDataForRewrite));
    }

    return results;
  } catch (e) {
    ctx.emitError({ type: "parse", message: "Error parsing servers.csv", file: "servers.csv", details: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
