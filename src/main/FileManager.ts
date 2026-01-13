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
import { createFileWatcher, FileType } from "./FileWatcher";
import { FileEmitter, CachedData } from "./FileEmitter";
import { FileContext, parseContacts, parseServers, parseOnCall, addContact as addContactOp, removeContact as removeContactOp, importContactsWithMapping as importContactsWithMappingOp, addServer as addServerOp, removeServer as removeServerOp, importServersWithMapping as importServersWithMappingOp, cleanupServerContacts as cleanupServerContactsOp, updateOnCallTeam as updateOnCallTeamOp, removeOnCallTeam as removeOnCallTeamOp, renameOnCallTeam as renameOnCallTeamOp, saveAllOnCall as saveAllOnCallOp, performBackup as performBackupOp, getGroups, getContacts as getContactsJson, getServers as getServersJson, getOnCall as getOnCallJson } from "./operations";

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

  constructor(window: BrowserWindow, rootDir: string, bundledPath: string) {
    this.rootDir = rootDir;
    this.bundledDataPath = bundledPath;
    this.emitter = new FileEmitter(window);
    loggers.fileManager.info(`Initialized. Root: ${this.rootDir}`);
  }

  public init() { this.startWatching(); this.readAndEmit(); this.performBackup("init"); }

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
    // Basic Mutex: Ensure one write per file at a time
    const existingLock = this.fileLocks.get(path) || Promise.resolve();
    
    const newLock = existingLock.then(async () => {
      this.internalWriteCount++;
      try {
        // Add UTF-8 BOM for Excel compatibility
        const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
        
        await fs.writeFile(`${path}.tmp`, contentWithBom, "utf-8");
        await fs.rename(`${path}.tmp`, path);
        await this.readAndEmit();
      } finally {
        setTimeout(() => {
          this.internalWriteCount--;
        }, 500);
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
        const contentWithBom = content.startsWith('\uFEFF') ? content : '\uFEFF' + content;
        await fs.writeFile(`${path}.tmp`, contentWithBom, "utf-8");
        await fs.rename(`${path}.tmp`, path);
      } finally {
        setTimeout(() => this.internalWriteCount--, 1000);
      }
    });

    this.fileLocks.set(path, newLock);
    return newLock;
  }
  public safeStringify(data: string[][]): string { return stringifyCsv(data); }
  public emitError(error: DataError) { this.emitter.emitError(error); }
  public emitProgress(progress: ImportProgress) { this.emitter.emitProgress(progress); }

  // Delegated Operations
  public async removeContact(email: string) { return removeContactOp(this, email); }
  public async addContact(contact: Partial<Contact>) { return addContactOp(this, contact); }
  public async importContactsWithMapping(path: string) { return importContactsWithMappingOp(this, path); }
  public async addServer(server: Partial<Server>) { return addServerOp(this, server); }
  public async removeServer(name: string) { return removeServerOp(this, name); }
  public async importServersWithMapping(path: string) { return importServersWithMappingOp(this, path); }
  public async cleanupServerContacts() { return cleanupServerContactsOp(this); }
  public async updateOnCallTeam(team: string, rows: OnCallRow[]) { return updateOnCallTeamOp(this, team, rows); }
  public async removeOnCallTeam(team: string) { return removeOnCallTeamOp(this, team); }
  public async renameOnCallTeam(oldName: string, newName: string) { return renameOnCallTeamOp(this, oldName, newName); }
  public async saveAllOnCall(rows: OnCallRow[]) { return saveAllOnCallOp(this, rows); }
  public async generateDummyData() { const success = await generateDummyDataAsync(this.rootDir); if (success) await this.readAndEmit(); return success; }
  public async performBackup(reason = "auto") { return performBackupOp(this.rootDir, reason); }
  public destroy() { if (this.watcher) { this.watcher.close(); this.watcher = null; } }
}
