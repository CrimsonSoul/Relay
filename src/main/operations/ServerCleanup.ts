import { join } from "path";
import fs from "fs/promises";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { FileContext, SERVER_FILES } from "./FileContext";
import { parseContacts } from "./ContactOperations";
import { parseServers } from "./ServerParser";
import { loggers } from "../logger";

/** Replace email addresses in server Owner/Contact fields with names from contacts.csv */
export async function cleanupServerContacts(ctx: FileContext): Promise<void> {
  loggers.fileManager.info("[ServerCleanup] Starting Server Contact Cleanup...");
  try {
    const servers = await parseServers(ctx), contacts = await parseContacts(ctx);
    const path = join(ctx.rootDir, SERVER_FILES[0]);
    if (servers.length === 0 || contacts.length === 0) return;

    const emailToName = new Map<string, string>();
    for (const c of contacts) { if (c.email && c.name) emailToName.set(c.email.toLowerCase(), c.name); }

    let changed = false;
    const content = await fs.readFile(path, "utf-8");
    const data = (await parseCsvAsync(content)).map((r) => r.map((c) => desanitizeField(c)));
    if (data.length < 2) return;

    const header = data[0].map((h: any) => String(h).toLowerCase().trim());
    const ownerIdx = header.findIndex((h) => h === "owner" || h === "lob owner");
    const contactIdx = header.findIndex((h) => h === "it contact" || h === "it tech support contact");
    if (ownerIdx === -1 && contactIdx === -1) return;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const tryReplace = (idx: number) => {
        if (idx !== -1 && row[idx]) { const val = String(row[idx]).trim();
          if (val.includes("@")) { const match = emailToName.get(val.toLowerCase()); if (match && match !== val) { row[idx] = match; changed = true; } } }
      };
      tryReplace(ownerIdx); tryReplace(contactIdx);
    }

    if (changed) { 
      await ctx.writeAndEmit(path, ctx.safeStringify(data)); 
      ctx.performBackup("cleanupServerContacts"); 
      loggers.fileManager.info("[ServerCleanup] Completed. Updated file."); 
    } else { 
      loggers.fileManager.info("[ServerCleanup] No contacts needed cleanup."); 
    }
  } catch (e) { 
    loggers.fileManager.error("[ServerCleanup] Error:", { error: e }); 
  }
}
