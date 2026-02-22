/**
 * FileManager - Core file management class
 * Delegates to FileWatcher, FileEmitter, and operation modules.
 * All data is stored as JSON.
 */
import { type FSWatcher } from 'chokidar';
import {
  type Contact,
  type Server,
  type OnCallRow,
  type DataError,
  type ContactRecord,
  type ServerRecord,
  type OnCallRecord,
  type TeamLayout,
} from '@shared/ipc';

import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';
import { createFileWatcher, FileType } from './FileWatcher';
import {
  performBackup as performBackupOp,
  getGroups,
  getContacts as getContactsJson,
  getServers as getServersJson,
  getOnCall as getOnCallJson,
  updateOnCallTeamJson,
  deleteOnCallByTeam,
  renameOnCallTeamJson,
  reorderOnCallTeamsJson,
  saveAllOnCallJson,
  addContactRecord,
  deleteContactRecord,
  findContactByEmail,
  addServerRecord,
  deleteServerRecord,
  findServerByName,
} from './operations';
import { TeamLayoutSchema } from '@shared/ipcValidation';

import { FileSystemService } from './FileSystemService';
import { DataCacheManager } from './DataCacheManager';

// File write coordination constants
const WRITE_GUARD_DELAY_MS = 500; // Delay after write before allowing file watcher to react

// Transform JSON records to legacy types for backward compatibility
function contactRecordToContact(record: ContactRecord): Contact {
  return {
    name: record.name,
    email: record.email,
    phone: record.phone,
    title: record.title,
    _searchString: `${record.name} ${record.email} ${record.phone} ${record.title}`.toLowerCase(),
    raw: { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt },
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
    _searchString:
      `${record.name} ${record.businessArea} ${record.lob} ${record.comment} ${record.owner} ${record.contact} ${record.os}`.toLowerCase(),
    raw: { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt },
  };
}

function onCallRecordToOnCallRow(record: OnCallRecord): OnCallRow {
  return {
    id: record.id,
    team: record.team,
    role: record.role,
    name: record.name,
    contact: record.contact,
    timeWindow: record.timeWindow,
  };
}

export class FileManager {
  private watcher: FSWatcher | null = null;
  private internalWriteCount = 0;

  private readonly fsService: FileSystemService;
  private readonly cache: DataCacheManager;

  public get rootDir(): string {
    return this.fsService.rootDir;
  }
  public get bundledDataPath(): string {
    return this.fsService.bundledDataPath;
  }

  constructor(rootDir: string, bundledPath: string) {
    this.fsService = new FileSystemService(rootDir, bundledPath);
    this.cache = new DataCacheManager();
    loggers.fileManager.info(`Initialized. Root: ${this.rootDir}`);
  }

  public init(): void {
    this.startWatching();
    this.readAndEmit().catch((e) =>
      loggers.fileManager.error('Init readAndEmit failed', { error: e }),
    );
    this.performBackup('init').catch((e) =>
      loggers.fileManager.error('Init backup failed', { error: e }),
    );
  }

  private startWatching() {
    this.watcher = createFileWatcher(this.rootDir, {
      onFileChange: (types) => {
        this.readAndEmitIncremental(types).catch((e) =>
          loggers.fileManager.error('Incremental update failed', { error: e }),
        );
      },
      shouldIgnore: () => this.internalWriteCount > 0,
    });
  }

  public getCachedData() {
    return this.cache.getCache();
  }

  private async loadContacts(): Promise<Contact[]> {
    const records = await getContactsJson(this.rootDir);
    return records.map(contactRecordToContact);
  }

  private async loadServers(): Promise<Server[]> {
    const records = await getServersJson(this.rootDir);
    return records.map(serverRecordToServer);
  }

  private async loadOnCall(): Promise<OnCallRow[]> {
    const records = await getOnCallJson(this.rootDir);
    return records.map(onCallRecordToOnCallRow);
  }

  private async loadLayout(): Promise<TeamLayout> {
    try {
      const content = await this.fsService.readFile('oncall_layout.json');
      if (content) {
        try {
          const parsed: unknown = JSON.parse(content);
          const result = TeamLayoutSchema.safeParse(parsed);
          if (result.success && result.data) {
            return result.data;
          }
          loggers.fileManager.warn('oncall_layout.json failed schema validation, ignoring');
        } catch (error_) {
          loggers.fileManager.warn('oncall_layout.json contains invalid JSON, treating as empty', {
            error: error_,
          });
        }
      }
    } catch (e) {
      loggers.fileManager.error('Unexpected error loading layout', { error: e });
    }
    return {};
  }

  private async readAndEmitIncremental(filesToUpdate: Set<FileType>) {
    if (filesToUpdate.size === 0) {
      await this.readAndEmit();
      return;
    }
    this.cache.emitReloadStarted();
    try {
      const [g, c, s, o] = await Promise.all([
        filesToUpdate.has('groups') ? getGroups(this.rootDir) : null,
        filesToUpdate.has('contacts') ? this.loadContacts() : null,
        filesToUpdate.has('servers') ? this.loadServers() : null,
        filesToUpdate.has('oncall') ? this.loadOnCall() : null,
      ]);

      const updates: {
        groups?: ReturnType<typeof getGroups> extends Promise<infer T> ? T : never;
        contacts?: Contact[];
        servers?: Server[];
        onCall?: OnCallRow[];
      } = {};
      if (g) updates.groups = g;
      if (c) updates.contacts = c;
      if (s) updates.servers = s;
      if (o) updates.onCall = o;

      this.cache.updateCache(updates);
      this.cache.broadcast();
      this.cache.emitReloadCompleted(true);
    } catch (error) {
      loggers.fileManager.error('Error in incremental update', { error });
      this.cache.emitReloadCompleted(false);
    }
  }

  public async readAndEmit() {
    this.cache.emitReloadStarted();
    try {
      const [groups, contacts, servers, onCall, teamLayout] = await Promise.all([
        getGroups(this.rootDir),
        this.loadContacts(),
        this.loadServers(),
        this.loadOnCall(),
        this.loadLayout(),
      ]);
      this.cache.updateCache({ groups, contacts, servers, onCall, teamLayout });
      this.cache.broadcast();
      this.cache.emitReloadCompleted(true);
    } catch (error) {
      loggers.fileManager.error('Error reading files', { error });
      this.cache.emitReloadCompleted(false);
    }
  }

  public emitError(error: DataError) {
    this.cache.emitError(error);
  }

  // Delegated Operations
  public async removeContact(email: string) {
    const contact = await findContactByEmail(this.rootDir, email);
    if (contact) {
      const success = await deleteContactRecord(this.rootDir, contact.id);
      if (success) await this.readAndEmit();
      return success;
    }
    return false;
  }

  public async addContact(contact: Partial<Contact>) {
    const record = {
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      title: contact.title || '',
    };
    const result = await addContactRecord(this.rootDir, record);
    if (result) await this.readAndEmit();
    return !!result;
  }

  public async addServer(server: Partial<Server>) {
    const record = {
      name: server.name || '',
      businessArea: server.businessArea || '',
      lob: server.lob || '',
      comment: server.comment || '',
      owner: server.owner || '',
      contact: server.contact || '',
      os: server.os || '',
    };
    const result = await addServerRecord(this.rootDir, record);
    if (result) await this.readAndEmit();
    return !!result;
  }

  public async removeServer(name: string) {
    const server = await findServerByName(this.rootDir, name);
    if (server) {
      const success = await deleteServerRecord(this.rootDir, server.id);
      if (success) await this.readAndEmit();
      return success;
    }
    return false;
  }

  public async updateOnCallTeam(team: string, rows: OnCallRow[]) {
    const previousOnCall = [...this.cache.getCache().onCall];
    const normalizedTeam = team.trim().toLowerCase();
    const currentOrder = Array.from(new Set(previousOnCall.map((r) => r.team)));
    const newFlatList: OnCallRow[] = [];

    if (currentOrder.some((t) => t.toLowerCase() === normalizedTeam)) {
      currentOrder.forEach((t) => {
        if (t.toLowerCase() === normalizedTeam) newFlatList.push(...rows);
        else newFlatList.push(...previousOnCall.filter((r) => r.team === t));
      });
    } else {
      newFlatList.push(...previousOnCall, ...rows);
    }

    this.cache.updateCache({ onCall: newFlatList });
    this.cache.broadcast();

    const records = rows.map((r) => ({
      id: r.id,
      team: r.team,
      role: r.role,
      name: r.name,
      contact: r.contact,
      timeWindow: r.timeWindow,
    }));
    const success = await updateOnCallTeamJson(this.rootDir, team, records);

    if (!success) {
      loggers.fileManager.error('updateOnCallTeam persistence failed, rolling back');
      this.cache.updateCache({ onCall: previousOnCall });
      this.cache.broadcast();
      this.emitError({
        type: 'persistence',
        message: 'Changes could not be saved. Please try again.',
        file: 'oncall.json',
      });
    }

    return success;
  }

  public async removeOnCallTeam(team: string) {
    const previousOnCall = [...this.cache.getCache().onCall];
    this.cache.updateCache({ onCall: previousOnCall.filter((r) => r.team !== team) });
    this.cache.broadcast();

    const success = await deleteOnCallByTeam(this.rootDir, team);

    if (!success) {
      loggers.fileManager.error('removeOnCallTeam persistence failed, rolling back');
      this.cache.updateCache({ onCall: previousOnCall });
      this.cache.broadcast();
      this.emitError({
        type: 'persistence',
        message: 'Team deletion failed to save. Please try again.',
        file: 'oncall.json',
      });
    }

    return success;
  }

  public async renameOnCallTeam(oldName: string, newName: string) {
    const previousOnCall = [...this.cache.getCache().onCall];
    this.cache.updateCache({
      onCall: previousOnCall.map((r) => (r.team === oldName ? { ...r, team: newName } : r)),
    });
    this.cache.broadcast();

    const success = await renameOnCallTeamJson(this.rootDir, oldName, newName);

    if (!success) {
      loggers.fileManager.error('renameOnCallTeam persistence failed, rolling back');
      this.cache.updateCache({ onCall: previousOnCall });
      this.cache.broadcast();
      this.emitError({
        type: 'persistence',
        message: 'Team rename failed to save. Please try again.',
        file: 'oncall.json',
      });
    }

    return success;
  }

  public async reorderOnCallTeams(teamOrder: string[], layout?: TeamLayout) {
    const previousOnCall = [...this.cache.getCache().onCall];
    const previousLayout = { ...this.cache.getCache().teamLayout };

    const teamMap = new Map<string, OnCallRow[]>();
    previousOnCall.forEach((r) => {
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

    this.cache.updateCache({ onCall: orderedRows, teamLayout: layout || previousLayout });
    this.cache.broadcast();

    this.internalWriteCount++;
    try {
      if (layout) {
        await this.fsService.atomicWrite('oncall_layout.json', JSON.stringify(layout, null, 2));
      }

      const success = await reorderOnCallTeamsJson(this.rootDir, teamOrder);

      if (!success) {
        loggers.fileManager.error('Failed to persist reorder (JSON), rolling back');
        this.cache.updateCache({ onCall: previousOnCall, teamLayout: previousLayout });
        this.cache.broadcast();
        this.emitError({
          type: 'persistence',
          message: 'Team reorder failed to save. Please try again.',
          file: 'oncall.json',
        });
      }

      return success;
    } finally {
      setTimeout(() => {
        this.internalWriteCount--;
      }, WRITE_GUARD_DELAY_MS);
    }
  }

  public async saveAllOnCall(rows: OnCallRow[]) {
    this.cache.updateCache({ onCall: rows });
    this.cache.broadcast();

    const records = rows.map((r) => ({
      id: r.id,
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

  public async generateDummyData() {
    // Only allow in development mode — must match the guard in dataHandlers.ts
    const { app } = await import('electron');
    if (app.isPackaged || process.env.NODE_ENV !== 'development') {
      loggers.fileManager.warn('generateDummyData blocked in production mode');
      return false;
    }
    try {
      const { generateDummyDataAsync } = await import('./dummyDataGenerator');
      const success = await generateDummyDataAsync(this.rootDir);
      if (success) {
        await this.readAndEmit();
      }
      return success;
    } catch (err) {
      loggers.fileManager.error('generateDummyData failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  public async performBackup(reason = 'auto') {
    return performBackupOp(this.rootDir, reason);
  }
  public destroy() {
    if (this.watcher) {
      // Run watcher cleanup (clears debounce timers and pending updates)
      // before closing. Chokidar v5 does not emit a 'close' event.
      const cleanup = (this.watcher as FSWatcher & { _cleanup?: () => void })._cleanup;
      if (cleanup) cleanup();
      this.watcher.close().catch((error_) => {
        loggers.fileManager.warn('Failed to close file watcher cleanly', { error: error_ });
      });
      this.watcher = null;
    }
  }
}
