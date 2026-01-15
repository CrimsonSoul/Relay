/**
 * FileManager - Core file management class (refactored)
 * Delegates to FileWatcher, FileEmitter, and operation modules.
 */
import chokidar from "chokidar";
import { join } from "path";
import { BrowserWindow } from "electron";
import { type Contact, type Server, type OnCallRow, type DataError, type ImportProgress } from "@shared/ipc";
import fs from "fs/promises";
import { existsSync } from "fs";
import { generateDummyDataAsync } from "./dataUtils";
import { stringifyCsv } from "./csvUtils";
import { loggers } from "./logger";
import { createFileWatcher, FileType } from "./FileWatcher";
import { FileEmitter, CachedData } from "./FileEmitter";
import { FileContext, parseGroups, parseContacts, parseServers, parseOnCall, addContact as addContactOp, removeContact as removeContactOp, addGroup as addGroupOp, updateGroupMembership as updateGroupMembershipOp, removeGroup as removeGroupOp, renameGroup as renameGroupOp, importGroupsWithMapping as importGroupsWithMappingOp, importContactsWithMapping as importContactsWithMappingOp, addServer as addServerOp, removeServer as removeServerOp, importServersWithMapping as importServersWithMappingOp, cleanupServerContacts as cleanupServerContactsOp, updateOnCallTeam as updateOnCallTeamOp, removeOnCallTeam as removeOnCallTeamOp, renameOnCallTeam as renameOnCallTeamOp, saveAllOnCall as saveAllOnCallOp, performBackup as performBackupOp, GROUP_FILES, CONTACT_FILES, SERVER_FILES, ONCALL_FILES } from "./operations";

export class FileManager implements FileContext {
  private watcher: chokidar.FSWatcher | null = null;
  public readonly rootDir: string;
  public readonly bundledDataPath: string;
  private emitter: FileEmitter;
  private internalWriteCount = 0;
  private cachedData: CachedData = { groups: {}, contacts: [], servers: [], onCall: [] };

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

  private async readAndEmitIncremental(filesToUpdate: Set<FileType>) {
    if (filesToUpdate.size === 0) { await this.readAndEmit(); return; }
    this.emitter.emitReloadStarted();
    try {
      const [g, c, s, o] = await Promise.all([filesToUpdate.has("groups") ? parseGroups(this) : null, filesToUpdate.has("contacts") ? parseContacts(this) : null, filesToUpdate.has("servers") ? parseServers(this) : null, filesToUpdate.has("oncall") ? parseOnCall(this) : null]);
      if (g) this.cachedData.groups = g; if (c) this.cachedData.contacts = c; if (s) this.cachedData.servers = s; if (o) this.cachedData.onCall = o;
      this.emitter.sendPayload(this.cachedData); this.emitter.emitReloadCompleted(true);
    } catch (error) { loggers.fileManager.error("Error in incremental update", { error }); this.emitter.emitReloadCompleted(false); }
  }

  public async readAndEmit() {
    this.emitter.emitReloadStarted();
    try {
      const [groups, contacts, servers, onCall] = await Promise.all([parseGroups(this), parseContacts(this), parseServers(this), parseOnCall(this)]);
      this.cachedData = { groups, contacts, servers, onCall }; this.emitter.sendPayload(this.cachedData); this.emitter.emitReloadCompleted(true);
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

        const fileName = path.split(/[/\\]/).pop() || "";
        const filesToUpdate = new Set<FileType>();

        if (GROUP_FILES.includes(fileName)) filesToUpdate.add("groups");
        else if (CONTACT_FILES.includes(fileName)) filesToUpdate.add("contacts");
        else if (SERVER_FILES.includes(fileName)) filesToUpdate.add("servers");
        else if (ONCALL_FILES.includes(fileName)) filesToUpdate.add("oncall");

        if (filesToUpdate.size > 0) {
          await this.readAndEmitIncremental(filesToUpdate);
        } else {
          await this.readAndEmit();
        }
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
  public safeStringify(data: any[][]): string { return stringifyCsv(data); }
  public emitError(error: DataError) { this.emitter.emitError(error); }
  public emitProgress(progress: ImportProgress) { this.emitter.emitProgress(progress); }

  // Delegated Operations
  public async removeContact(email: string) { return removeContactOp(this, email); }
  public async addContact(contact: Partial<Contact>) { return addContactOp(this, contact); }
  public async addGroup(name: string) { return addGroupOp(this, name); }
  public async updateGroupMembership(name: string, email: string, remove: boolean) { return updateGroupMembershipOp(this, name, email, remove); }
  public async removeGroup(name: string) { return removeGroupOp(this, name); }
  public async renameGroup(oldName: string, newName: string) { return renameGroupOp(this, oldName, newName); }
  public async importGroupsWithMapping(path: string) { return importGroupsWithMappingOp(this, path); }
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
