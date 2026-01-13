/**
 * DataExportOperations - Export data to JSON or CSV format
 */

import { join } from "path";
import fs from "fs/promises";
import { dialog } from "electron";
import type {
  ContactRecord,
  ServerRecord,
  OnCallRecord,
  BridgeGroup,
  ExportOptions,
  DataCategory,
} from "@shared/ipc";
import { getContacts } from "./ContactJsonOperations";
import { getServers } from "./ServerJsonOperations";
import { getOnCall } from "./OnCallJsonOperations";
import { getGroups } from "./PresetOperations";
import { loggers } from "../logger";

/**
 * Convert contacts to CSV format
 */
function contactsToCsv(contacts: ContactRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ["ID", "Name", "Email", "Phone", "Title", "Created At", "Updated At"]
    : ["Name", "Email", "Phone", "Title"];

  const rows = contacts.map((c) =>
    includeMetadata
      ? [c.id, c.name, c.email, c.phone, c.title, new Date(c.createdAt).toISOString(), new Date(c.updatedAt).toISOString()]
      : [c.name, c.email, c.phone, c.title]
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
}

/**
 * Convert servers to CSV format
 */
function serversToCsv(servers: ServerRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ["ID", "Name", "Business Area", "LOB", "Comment", "Owner", "Contact", "OS", "Created At", "Updated At"]
    : ["Name", "Business Area", "LOB", "Comment", "Owner", "Contact", "OS"];

  const rows = servers.map((s) =>
    includeMetadata
      ? [s.id, s.name, s.businessArea, s.lob, s.comment, s.owner, s.contact, s.os, new Date(s.createdAt).toISOString(), new Date(s.updatedAt).toISOString()]
      : [s.name, s.businessArea, s.lob, s.comment, s.owner, s.contact, s.os]
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
}

/**
 * Convert on-call to CSV format
 */
function onCallToCsv(records: OnCallRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ["ID", "Team", "Role", "Name", "Contact", "Time Window", "Created At", "Updated At"]
    : ["Team", "Role", "Name", "Contact", "Time Window"];

  const rows = records.map((r) =>
    includeMetadata
      ? [r.id, r.team, r.role, r.name, r.contact, r.timeWindow || "", new Date(r.createdAt).toISOString(), new Date(r.updatedAt).toISOString()]
      : [r.team, r.role, r.name, r.contact, r.timeWindow || ""]
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
}

/**
 * Convert groups to CSV format
 */
function groupsToCsv(groups: BridgeGroup[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ["ID", "Name", "Contacts", "Created At", "Updated At"]
    : ["Name", "Contacts"];

  const rows = groups.map((g) =>
    includeMetadata
      ? [g.id, g.name, g.contacts.join(";"), new Date(g.createdAt).toISOString(), new Date(g.updatedAt).toISOString()]
      : [g.name, g.contacts.join(";")]
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
}

/**
 * Escape a CSV field and prevent formula injection.
 * Spreadsheet applications interpret cells starting with =, +, -, @ as formulas.
 * We prefix such values with a single quote to prevent execution.
 */
function escapeCSV(field: string | number | undefined): string {
  const str = String(field ?? "");
  // Prevent formula injection - prefix with single quote inside quotes
  if (/^[=+\-@]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Get file filters for save dialog
 */
function getFileFilters(format: "json" | "csv") {
  return format === "json"
    ? [{ name: "JSON Files", extensions: ["json"] }]
    : [{ name: "CSV Files", extensions: ["csv"] }];
}

/**
 * Get default filename for export
 */
function getDefaultFilename(category: DataCategory, format: "json" | "csv"): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  return `relay-${category}-${timestamp}.${format}`;
}

/**
 * Export data to a file
 */
export async function exportData(
  rootDir: string,
  options: ExportOptions
): Promise<boolean> {
  try {
    const { format, category, includeMetadata = false } = options;

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: `Export ${category} as ${format.toUpperCase()}`,
      defaultPath: getDefaultFilename(category, format),
      filters: getFileFilters(format),
    });

    if (result.canceled || !result.filePath) {
      return false;
    }

    let content: string;

    if (category === "all") {
      // Export all data as a single JSON file (or multiple CSVs in a folder)
      if (format === "json") {
        const [contacts, servers, onCall, groups] = await Promise.all([
          getContacts(rootDir),
          getServers(rootDir),
          getOnCall(rootDir),
          getGroups(rootDir),
        ]);

        const allData = includeMetadata
          ? { contacts, servers, onCall, groups, exportedAt: new Date().toISOString() }
          : {
              contacts: contacts.map(({ id, createdAt, updatedAt, ...rest }) => rest),
              servers: servers.map(({ id, createdAt, updatedAt, ...rest }) => rest),
              onCall: onCall.map(({ id, createdAt, updatedAt, ...rest }) => rest),
              groups: groups.map(({ id, createdAt, updatedAt, ...rest }) => rest),
              exportedAt: new Date().toISOString(),
            };

        content = JSON.stringify(allData, null, 2);
      } else {
        // For CSV, we'll create a combined file with sections
        const [contacts, servers, onCall, groups] = await Promise.all([
          getContacts(rootDir),
          getServers(rootDir),
          getOnCall(rootDir),
          getGroups(rootDir),
        ]);

        content = [
          "# CONTACTS",
          contactsToCsv(contacts, includeMetadata),
          "",
          "# SERVERS",
          serversToCsv(servers, includeMetadata),
          "",
          "# ONCALL",
          onCallToCsv(onCall, includeMetadata),
          "",
          "# GROUPS",
          groupsToCsv(groups, includeMetadata),
        ].join("\n");
      }
    } else {
      // Export single category
      switch (category) {
        case "contacts": {
          const contacts = await getContacts(rootDir);
          content = format === "json"
            ? JSON.stringify(includeMetadata ? contacts : contacts.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
            : contactsToCsv(contacts, includeMetadata);
          break;
        }
        case "servers": {
          const servers = await getServers(rootDir);
          content = format === "json"
            ? JSON.stringify(includeMetadata ? servers : servers.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
            : serversToCsv(servers, includeMetadata);
          break;
        }
        case "oncall": {
          const onCall = await getOnCall(rootDir);
          content = format === "json"
            ? JSON.stringify(includeMetadata ? onCall : onCall.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
            : onCallToCsv(onCall, includeMetadata);
          break;
        }
        case "groups": {
          const groups = await getGroups(rootDir);
          content = format === "json"
            ? JSON.stringify(includeMetadata ? groups : groups.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
            : groupsToCsv(groups, includeMetadata);
          break;
        }
        default:
          throw new Error(`Unknown category: ${category}`);
      }
    }

    // Add BOM for CSV files for Excel compatibility
    if (format === "csv") {
      content = "\uFEFF" + content;
    }

    await fs.writeFile(result.filePath, content, "utf-8");
    loggers.fileManager.info(`[DataExportOperations] Exported ${category} to ${result.filePath}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[DataExportOperations] exportData error:", { error: e });
    return false;
  }
}

/**
 * Export to a specific path (for programmatic use)
 */
export async function exportToPath(
  rootDir: string,
  destPath: string,
  options: ExportOptions
): Promise<boolean> {
  try {
    const { format, category, includeMetadata = false } = options;

    let content: string;

    switch (category) {
      case "contacts": {
        const contacts = await getContacts(rootDir);
        content = format === "json"
          ? JSON.stringify(includeMetadata ? contacts : contacts.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
          : contactsToCsv(contacts, includeMetadata);
        break;
      }
      case "servers": {
        const servers = await getServers(rootDir);
        content = format === "json"
          ? JSON.stringify(includeMetadata ? servers : servers.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
          : serversToCsv(servers, includeMetadata);
        break;
      }
      case "oncall": {
        const onCall = await getOnCall(rootDir);
        content = format === "json"
          ? JSON.stringify(includeMetadata ? onCall : onCall.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
          : onCallToCsv(onCall, includeMetadata);
        break;
      }
      case "groups": {
        const groups = await getGroups(rootDir);
        content = format === "json"
          ? JSON.stringify(includeMetadata ? groups : groups.map(({ id, createdAt, updatedAt, ...rest }) => rest), null, 2)
          : groupsToCsv(groups, includeMetadata);
        break;
      }
      case "all": {
        const [contacts, servers, onCall, groups] = await Promise.all([
          getContacts(rootDir),
          getServers(rootDir),
          getOnCall(rootDir),
          getGroups(rootDir),
        ]);
        content = JSON.stringify({ contacts, servers, onCall, groups, exportedAt: new Date().toISOString() }, null, 2);
        break;
      }
      default:
        throw new Error(`Unknown category: ${category}`);
    }

    if (format === "csv") {
      content = "\uFEFF" + content;
    }

    await fs.writeFile(destPath, content, "utf-8");
    return true;
  } catch (e) {
    loggers.fileManager.error("[DataExportOperations] exportToPath error:", { error: e });
    return false;
  }
}
