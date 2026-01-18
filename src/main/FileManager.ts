/**
 * FileManager - Core file management class (refactored)
 * Delegates to FileWatcher, FileEmitter, and operation modules.
 */
import chokidar from "chokidar";
import { join } from "path";
import { BrowserWindow } from "electron";
import { type Contact, type Server, type OnCallRow, type DataError, type ImportProgress, type ContactRecord, type ServerRecord, type OnCallRecord } from "@shared/ipc";
import fs from "fs/promises";
import { existsSync } from "fs";
import { generateDummyDataAsync } from "./dataUtils";
import { stringifyCsv } from "./csvUtils";
import { loggers } from "./logger";
import { withFileLock, atomicWriteWithLock } from "./fileLock";

import { createFileWatcher, FileType } from "./FileWatcher";
import { FileEmitter, CachedData } from "./FileEmitter";
import { FileContext, parseContacts, parseServers, parseOnCall, addContact as addContactOp, removeContact as removeContactOp, importContactsWithMapping as importContactsWithMappingOp, addServer as addServerOp, removeServer as removeServerOp, importServersWithMapping as importServersWithMappingOp, cleanupServerContacts as cleanupServerContactsOp, updateOnCallTeam as updateOnCallTeamOp, removeOnCallTeam as removeOnCallTeamOp, renameOnCallTeam as renameOnCallTeamOp, reorderOnCallTeams as reorderOnCallTeamsOp, saveAllOnCall as saveAllOnCallOp, performBackup as performBackupOp, getGroups, getContacts as getContactsJson, getServers as getServersJson, getOnCall as getOnCallJson, updateOnCallTeamJson, deleteOnCallByTeam, renameOnCallTeamJson, reorderOnCallTeamsJson, saveAllOnCallJson, addContactRecord, deleteContactRecord, bulkUpsertContacts, findContactByEmail, addServerRecord, deleteServerRecord, bulkUpsertServers, findServerByName } from "./operations";
import { parseCsvAsync, desanitizeField } from "./csvUtils";
import { CONTACT_COLUMN_ALIASES, SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { cleanAndFormatPhoneNumber } from "@shared/phoneUtils";

// File write coordination constants
const WRITE_GUARD_DELAY_MS = 500; // Delay after write before allowing file watcher to react
const DETACHED_WRITE_GUARD_DELAY_MS = 1000; // Longer delay for detached writes

// Transform JSON records to legacy types for backward compatibility
function contactRecordToContact(record: ContactRecord): Contact {
  return {
    name: record.name,
    email: record.email,
    phone: record.phone,
    title: record.title,
    _searchString: `${record.name} ${record.email} ${record.phone} ${record.title}`.toLowerCase(),
    raw: { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt }
  };
}

function serverRecordToServer(record: ServerRecord): Server {
  return {
    name: record.name,
    businessArea: record.businessArea,
    lob: record.lob,
    comment: record.comment,
    owner: record.owner,
    contact: record.contact,
    os: record.os,
    _searchString: `${record.name} ${record.businessArea} ${record.lob} ${record.comment} ${record.owner} ${record.contact} ${record.os}`.toLowerCase(),
    raw: { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt }
  };
}

function onCallRecordToOnCallRow(record: OnCallRecord): OnCallRow {
  return {
    id: record.id,
    team: record.team,
    role: record.role,
    name: record.name,
    contact: record.contact,
    timeWindow: record.timeWindow
  };
}

export class FileManager implements FileContext {
  private watcher: chokidar.FSWatcher | null = null;
  public readonly rootDir: string;
  public readonly bundledDataPath: string;
  private emitter: FileEmitter;
  private internalWriteCount = 0;
  private cachedData: CachedData = { groups: [], contacts: [], servers: [], onCall: [] };

  constructor(rootDir: string, bundledPath: string) {
    this.rootDir = rootDir;
    this.bundledDataPath = bundledPath;
    this.emitter = new FileEmitter();
    loggers.fileManager.info(`Initialized. Root: ${this.rootDir}`);
  }

  /**
   * Initialize the FileManager by starting file watching, loading data, and performing backup.
   * Intentionally fires async operations without awaiting for non-blocking startup.
   * The operations complete in the background and emit events when ready.
   */
  public init(): void {
    this.startWatching();
    void this.readAndEmit();
    void this.performBackup("init");
  }

  private startWatching() {
    this.watcher = createFileWatcher(this.rootDir, {
      onFileChange: (types) => this.readAndEmitIncremental(types),
      shouldIgnore: () => this.internalWriteCount > 0
    });
  }

  public resolveExistingFile(fileNames: string[]): string | null {
    for (const fileName of fileNames) { const path = join(this.rootDir, fileName); if (existsSync(path)) return path; }
    return null;
  }

  // Check if JSON data files exist (migration completed)
  private hasJsonData(): boolean {
    return existsSync(join(this.rootDir, "contacts.json")) ||
           existsSync(join(this.rootDir, "servers.json")) ||
           existsSync(join(this.rootDir, "oncall.json"));
  }

  // Load contacts - prefer JSON if available, fallback to CSV
  private async loadContacts(): Promise<Contact[]> {
    if (existsSync(join(this.rootDir, "contacts.json"))) {
      const records = await getContactsJson(this.rootDir);
      return records.map(contactRecordToContact);
    }
    return parseContacts(this);
  }

  // Load servers - prefer JSON if available, fallback to CSV
  private async loadServers(): Promise<Server[]> {
    if (existsSync(join(this.rootDir, "servers.json"))) {
      const records = await getServersJson(this.rootDir);
      return records.map(serverRecordToServer);
    }
    return parseServers(this);
  }

  // Load on-call - prefer JSON if available, fallback to CSV
  private async loadOnCall(): Promise<OnCallRow[]> {
    if (existsSync(join(this.rootDir, "oncall.json"))) {
      const records = await getOnCallJson(this.rootDir);
      return records.map(onCallRecordToOnCallRow);
    }
    return parseOnCall(this);
  }

  private async readAndEmitIncremental(filesToUpdate: Set<FileType>) {
    if (filesToUpdate.size === 0) { await this.readAndEmit(); return; }
    this.emitter.emitReloadStarted();
    try {
      const [g, c, s, o] = await Promise.all([
        filesToUpdate.has("groups") ? getGroups(this.rootDir) : null,
        filesToUpdate.has("contacts") ? this.loadContacts() : null,
        filesToUpdate.has("servers") ? this.loadServers() : null,
        filesToUpdate.has("oncall") ? this.loadOnCall() : null
      ]);
      if (g) this.cachedData.groups = g; if (c) this.cachedData.contacts = c; if (s) this.cachedData.servers = s; if (o) this.cachedData.onCall = o;
      this.emitter.sendPayload(this.cachedData); this.emitter.emitReloadCompleted(true);
    } catch (error) { loggers.fileManager.error("Error in incremental update", { error }); this.emitter.emitReloadCompleted(false); }
  }

  public async readAndEmit() {
    this.emitter.emitReloadStarted();
    try {
      const [groups, contacts, servers, onCall] = await Promise.all([
        getGroups(this.rootDir),
        this.loadContacts(),
        this.loadServers(),
        this.loadOnCall()
      ]);
      this.cachedData = { groups, contacts, servers, onCall };
      this.emitter.sendPayload(this.cachedData);
      this.emitter.emitReloadCompleted(true);
    } catch (error) { loggers.fileManager.error("Error reading files", { error }); this.emitter.emitReloadCompleted(false); }
  }

  public async isDummyData(fileName: string): Promise<boolean> {
    try { const [current, bundled] = await Promise.all([fs.readFile(join(this.rootDir, fileName), "utf-8"), fs.readFile(join(this.bundledDataPath, fileName), "utf-8")]); return current.replace(/\r\n/g, "\n").trim() === bundled.replace(/\r\n/g, "\n").trim(); } catch { return false; }
  }

  private fileLocks: Map<string, Promise<void>> = new Map();

  public async writeAndEmit(path: string, content: string) {
    // In-process mutex: Ensure one write per file at a time within this instance
    const existingLock = this.fileLocks.get(path) || Promise.resolve();
    
    const newLock = existingLock.then(async () => {
      this.internalWriteCount++;
      try {
        // Cross-process lock: Ensure only one process writes at a time
        const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
        await atomicWriteWithLock(path, contentWithBom);
        await this.readAndEmit();
      } finally {
        setTimeout(() => {
          this.internalWriteCount--;
        }, WRITE_GUARD_DELAY_MS);
      }
    });

    this.fileLocks.set(path, newLock);
    return newLock;
  }

  public async rewriteFileDetached(path: string, content: string) {
    const existingLock = this.fileLocks.get(path) || Promise.resolve();
    
    const newLock = existingLock.then(async () => {
      this.internalWriteCount++;
      try {
        // Cross-process lock for detached writes
        const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
        await atomicWriteWithLock(path, contentWithBom);
      } finally {
        setTimeout(() => this.internalWriteCount--, DETACHED_WRITE_GUARD_DELAY_MS);
      }
    });

    this.fileLocks.set(path, newLock);
    return newLock;
  }
  public safeStringify(data: any): string {
    // Auto-detect: if data is not a 2D array (CSV format), use JSON
    if (typeof data === 'object' && !Array.isArray(data?.[0])) {
      return JSON.stringify(data, null, 2);
    }
    return stringifyCsv(data);
  }
  public emitError(error: DataError) { this.emitter.emitError(error); }
  public emitProgress(progress: ImportProgress) { this.emitter.emitProgress(progress); }

  // Delegated Operations
  public async removeContact(email: string) {
    if (this.hasJsonData()) {
      const contact = await findContactByEmail(this.rootDir, email);
      if (contact) {
        const success = await deleteContactRecord(this.rootDir, contact.id);
        if (success) await this.readAndEmit();
        return success;
      }
      return false;
    }
    return removeContactOp(this, email);
  }

  public async addContact(contact: Partial<Contact>) {
    if (this.hasJsonData()) {
      const record = {
        name: contact.name || "",
        email: contact.email || "",
        phone: contact.phone || "",
        title: contact.title || "",
      };
      const result = await addContactRecord(this.rootDir, record);
      if (result) await this.readAndEmit();
      return !!result;
    }
    return addContactOp(this, contact);
  }
  public async importContactsWithMapping(path: string) {
    if (this.hasJsonData()) {
      try {
        const content = await fs.readFile(path, "utf-8");
        const data = await parseCsvAsync(content);
        if (data.length < 2) return false;

        const header = data[0].map((h: unknown) => String(h).toLowerCase().trim());
        const rows = data.slice(1);

        const mapHeader = (candidates: string[]) => {
          for (const candidate of candidates) {
            const idx = header.indexOf(candidate.toLowerCase());
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const nameIdx = mapHeader(CONTACT_COLUMN_ALIASES.name);
        const emailIdx = mapHeader(CONTACT_COLUMN_ALIASES.email);
        const phoneIdx = mapHeader(CONTACT_COLUMN_ALIASES.phone);
        const titleIdx = mapHeader(CONTACT_COLUMN_ALIASES.title);

        if (emailIdx === -1) return false;

        const recordsToUpsert = rows.map((row) => {
          let phone = phoneIdx !== -1 ? row[phoneIdx] : "";
          if (phone) phone = cleanAndFormatPhoneNumber(String(phone));

          return {
            name: nameIdx !== -1 ? row[nameIdx] : "",
            email: row[emailIdx],
            phone: phone,
            title: titleIdx !== -1 ? row[titleIdx] : "",
          };
        }).filter(r => r.email);

        const result = await bulkUpsertContacts(this.rootDir, recordsToUpsert);
        await this.readAndEmit();
        return result.errors.length === 0;
      } catch (e) {
        loggers.fileManager.error("[FileManager] importContactsWithMapping JSON error:", { error: e });
        return false;
      }
    }
    return importContactsWithMappingOp(this, path);
  }
  public async addServer(server: Partial<Server>) {
    if (this.hasJsonData()) {
      const record = {
        name: server.name || "",
        businessArea: server.businessArea || "",
        lob: server.lob || "",
        comment: server.comment || "",
        owner: server.owner || "",
        contact: server.contact || "",
        os: server.os || "",
      };
      const result = await addServerRecord(this.rootDir, record);
      if (result) await this.readAndEmit();
      return !!result;
    }
    return addServerOp(this, server);
  }

  public async removeServer(name: string) {
    if (this.hasJsonData()) {
      const server = await findServerByName(this.rootDir, name);
      if (server) {
        const success = await deleteServerRecord(this.rootDir, server.id);
        if (success) await this.readAndEmit();
        return success;
      }
      return false;
    }
    return removeServerOp(this, name);
  }
  public async importServersWithMapping(path: string) {
    if (this.hasJsonData()) {
      try {
        const content = await fs.readFile(path, "utf-8");
        const lines = content.split(/\r?\n/);
        if (lines.length === 0) return { success: false, message: "Empty source file" };

        let headerLineIndex = -1;
        for (let i = 0; i < Math.min(lines.length, 20); i++) {
          const lowerLine = lines[i].toLowerCase();
          if (lowerLine.includes("vm-m") || lowerLine.includes("server name") || lowerLine.includes("name")) {
            headerLineIndex = i;
            break;
          }
        }
        if (headerLineIndex === -1) return { success: false, message: "Could not find header" };

        const cleanContents = lines.slice(headerLineIndex).join("\n");
        const data = await parseCsvAsync(cleanContents);
        if (data.length < 2) return { success: false, message: "File appears empty" };

        const header = data[0].map((h: unknown) => String(h).toLowerCase().trim());
        const rows = data.slice(1);

        const mapHeader = (candidates: readonly string[]) => {
          for (const c of candidates) {
            const idx = header.indexOf(c.toLowerCase());
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const s_nameIdx = mapHeader(SERVER_COLUMN_ALIASES.name);
        const s_baIdx = mapHeader(SERVER_COLUMN_ALIASES.businessArea);
        const s_lobIdx = mapHeader(SERVER_COLUMN_ALIASES.lob);
        const s_commentIdx = mapHeader(SERVER_COLUMN_ALIASES.comment);
        const s_ownerIdx = mapHeader(SERVER_COLUMN_ALIASES.owner);
        const s_contactIdx = mapHeader(SERVER_COLUMN_ALIASES.contact);
        const s_osTypeIdx = mapHeader(SERVER_COLUMN_ALIASES.os);

        if (s_nameIdx === -1) return { success: false, message: "No Name column found" };

        const recordsToUpsert = rows.map((row) => {
          const getValue = (idx: number) => (idx !== -1 && row[idx] ? row[idx].trim() : "");
          return {
            name: row[s_nameIdx].trim(),
            businessArea: getValue(s_baIdx),
            lob: getValue(s_lobIdx),
            comment: getValue(s_commentIdx),
            owner: getValue(s_ownerIdx),
            contact: getValue(s_contactIdx),
            os: getValue(s_osTypeIdx),
          };
        }).filter(r => r.name);

        const result = await bulkUpsertServers(this.rootDir, recordsToUpsert);
        await this.readAndEmit();
        return { success: result.errors.length === 0 };
      } catch (e) {
        loggers.fileManager.error("[FileManager] importServersWithMapping JSON error:", { error: e });
        return { success: false, message: String(e) };
      }
    }
    return importServersWithMappingOp(this, path);
  }
  public async cleanupServerContacts() {
    if (this.hasJsonData()) return; // Skip in JSON mode
    return cleanupServerContactsOp(this);
  }
  public async updateOnCallTeam(team: string, rows: OnCallRow[]) {
    // OPTIMISTIC UPDATE
    const normalizedTeam = team.trim().toLowerCase();
    // Maintain existing team order if possible
    const currentOrder = Array.from(new Set(this.cachedData.onCall.map(r => r.team)));
    const newFlatList: OnCallRow[] = [];
    
    if (currentOrder.some(t => t.toLowerCase() === normalizedTeam)) {
      currentOrder.forEach(t => {
        if (t.toLowerCase() === normalizedTeam) newFlatList.push(...rows);
        else newFlatList.push(...this.cachedData.onCall.filter(r => r.team === t));
      });
    } else {
      newFlatList.push(...this.cachedData.onCall, ...rows);
    }
    
    this.cachedData.onCall = newFlatList;
    this.emitter.sendPayload(this.cachedData);

    if (this.hasJsonData()) {
      const records = rows.map((r) => ({
        id: r.id, // Pass the ID
        team: r.team,
        role: r.role,
        name: r.name,
        contact: r.contact,
        timeWindow: r.timeWindow,
      }));
      const success = await updateOnCallTeamJson(this.rootDir, team, records);
      if (success) await this.readAndEmit();
      return success;
    }
    return updateOnCallTeamOp(this, team, rows);
  }

  public async removeOnCallTeam(team: string) {
    // OPTIMISTIC UPDATE
    this.cachedData.onCall = this.cachedData.onCall.filter(r => r.team !== team);
    this.emitter.sendPayload(this.cachedData);

    if (this.hasJsonData()) {
      const success = await deleteOnCallByTeam(this.rootDir, team);
      if (success) await this.readAndEmit();
      return success;
    }
    return removeOnCallTeamOp(this, team);
  }

  public async renameOnCallTeam(oldName: string, newName: string) {
    // OPTIMISTIC UPDATE
    this.cachedData.onCall = this.cachedData.onCall.map(r => 
      r.team === oldName ? { ...r, team: newName } : r
    );
    this.emitter.sendPayload(this.cachedData);

    if (this.hasJsonData()) {
      const success = await renameOnCallTeamJson(this.rootDir, oldName, newName);
      if (success) await this.readAndEmit();
      return success;
    }
    return renameOnCallTeamOp(this, oldName, newName);
  }

  public async reorderOnCallTeams(teamOrder: string[]) {
    // OPTIMISTIC UPDATE: Update memory cache and broadcast to all windows immediately
    const teamMap = new Map<string, OnCallRow[]>();
    this.cachedData.onCall.forEach(r => {
      const list = teamMap.get(r.team) || [];
      list.push(r);
      teamMap.set(r.team, list);
    });

    const orderedRows: OnCallRow[] = [];
    const processedTeams = new Set<string>();
    for (const team of teamOrder) {
      if (teamMap.has(team)) {
        orderedRows.push(...teamMap.get(team)!);
        processedTeams.add(team);
      }
    }
    for (const [team, rows] of teamMap.entries()) {
      if (!processedTeams.has(team)) orderedRows.push(...rows);
    }

    this.cachedData.onCall = orderedRows;
    this.emitter.sendPayload(this.cachedData);

    // BACKGROUND PERSISTENCE
    if (this.hasJsonData()) {
      const success = await reorderOnCallTeamsJson(this.rootDir, teamOrder);
      // Final sync to ensure disk and memory are perfectly aligned
      if (success) await this.readAndEmit();
      return success;
    }
    return reorderOnCallTeamsOp(this, teamOrder);
  }

  public async saveAllOnCall(rows: OnCallRow[]) {
    // OPTIMISTIC UPDATE
    this.cachedData.onCall = rows;
    this.emitter.sendPayload(this.cachedData);

    if (this.hasJsonData()) {
      const records = rows.map((r) => ({
        id: r.id, // Pass ID
        team: r.team,
        role: r.role,
        name: r.name,
        contact: r.contact,
        timeWindow: r.timeWindow,
      }));
      const success = await saveAllOnCallJson(this.rootDir, records);
      if (success) await this.readAndEmit();
      return success;
    }
    return saveAllOnCallOp(this, rows);
  }
  public async generateDummyData() { const success = await generateDummyDataAsync(this.rootDir); if (success) { await this.readAndEmit(); } return success; }
  public async performBackup(reason = "auto") { return performBackupOp(this.rootDir, reason); }
  public destroy() { if (this.watcher) { void this.watcher.close(); this.watcher = null; } }
}
