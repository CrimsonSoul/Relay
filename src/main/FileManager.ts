import chokidar from 'chokidar';
import { join } from 'path';
import { BrowserWindow } from 'electron';
import { IPC_CHANNELS, type AppData, type Contact, type GroupMap } from '@shared/ipc';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { MicrosoftAuth } from './microsoft/MicrosoftAuth';
import { GraphService } from './microsoft/GraphService';
import { AvatarManager } from './microsoft/AvatarManager';

const GROUP_FILES = ['groups.csv'];
const CONTACT_FILES = ['contacts.csv'];
const DEBOUNCE_MS = 100;

function parseCsv(contents: string): any[][] {
  return parse(contents, {
    trim: true,
    skip_empty_lines: true
  });
}

export class FileManager {
  private watcher: chokidar.FSWatcher | null = null;
  private rootDir: string;
  private mainWindow: BrowserWindow;
  private debounceTimer: NodeJS.Timeout | null = null;

  private auth: MicrosoftAuth;
  private graph: GraphService;
  private avatars: AvatarManager;
  private enrichmentData: Record<string, any> = {};

  constructor(window: BrowserWindow, rootDir: string, auth: MicrosoftAuth) {
    this.mainWindow = window;
    this.rootDir = rootDir;
    this.auth = auth;
    this.graph = new GraphService(() => this.auth.getToken());
    this.avatars = new AvatarManager(rootDir);

    this.loadEnrichmentData();

    console.log(`[FileManager] Initialized. Watching root: ${this.rootDir}`);
    this.startWatching();
    this.readAndEmit();
  }

  private loadEnrichmentData() {
    try {
      const path = join(this.rootDir, 'enrichment.json');
      if (fs.existsSync(path)) {
        this.enrichmentData = JSON.parse(fs.readFileSync(path, 'utf-8'));
      }
    } catch (e) {
      console.error('Failed to load enrichment data', e);
    }
  }

  private saveEnrichmentData() {
    try {
      const path = join(this.rootDir, 'enrichment.json');
      fs.writeFileSync(path, JSON.stringify(this.enrichmentData, null, 2));
    } catch (e) {
      console.error('Failed to save enrichment data', e);
    }
  }

  private startWatching() {
    const pathsToWatch = [...GROUP_FILES, ...CONTACT_FILES].map(file => join(this.rootDir, file));

    this.watcher = chokidar.watch(pathsToWatch, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100
      }
    });

    this.watcher.on('all', (event, path) => {
      console.log(`[FileManager] File event: ${event} on ${path}`);
      this.debouncedRead();
    });
  }

  private resolveExistingFile(fileNames: string[]): string | null {
    for (const fileName of fileNames) {
      const path = join(this.rootDir, fileName);
      if (fs.existsSync(path)) return path;
    }
    return null;
  }

  private debouncedRead() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.readAndEmit();
    }, DEBOUNCE_MS);
  }

  private emitReloadStarted() {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.DATA_RELOAD_STARTED);
    }
  }

  private emitReloadCompleted(success: boolean) {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.DATA_RELOAD_COMPLETED, success);
    }
  }

  public async readAndEmit() {
    console.log('[FileManager] Reading data files...');
    this.emitReloadStarted();
    try {
      const groups = this.parseGroups();
      let contacts = this.parseContacts();

      // Enrichment Step
      if (this.auth.getAccount()) {
         console.log('[FileManager] Enriching contacts from Microsoft Graph...');
         contacts = await this.enrichContacts(contacts);
      } else {
         // Even if not logged in, apply existing enrichment data
         contacts = this.applyLocalEnrichment(contacts);
      }

      const payload: AppData = {
        groups,
        contacts,
        lastUpdated: Date.now()
      };

      if (!this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(IPC_CHANNELS.DATA_UPDATED, payload);
        console.log('[FileManager] Data emitted to renderer.');
      }
      this.emitReloadCompleted(true);
    } catch (error) {
      console.error('[FileManager] Error reading files:', error);
      this.emitReloadCompleted(false);
    }
  }

  private applyLocalEnrichment(contacts: Contact[]): Contact[] {
    return contacts.map(c => {
      const enriched = this.enrichmentData[c.email.toLowerCase()];
      if (enriched) {
        return {
          ...c,
          title: enriched.title || c.title,
          avatarUrl: enriched.hasAvatar ? `relay-avatar://${c.email}` : undefined
          // We don't overwrite phone unless CSV is empty?
          // User said: "Phone and email data in our csv should be added to not replaced"
          // We can't really "add" to a single string field easily without format change.
          // But we can fill if missing.
        };
      }
      return c;
    });
  }

  private async enrichContacts(contacts: Contact[]): Promise<Contact[]> {
    // 1. Identify contacts that need enrichment or refresh
    // For now, we'll try to enrich everyone who has an email.
    // Optimization: Check if updated recently?

    const emails = contacts.map(c => c.email).filter(e => !!e);
    if (emails.length === 0) return contacts;

    try {
      // Fetch batch details
      // We only fetch if we have a token
      const token = await this.auth.getToken();
      if (token) {
        const msUsers = await this.graph.getBatchUsers(emails);

        for (const user of msUsers) {
          if (!user.mail) continue;
          const email = user.mail.toLowerCase();

          // Update enrichment data
          if (!this.enrichmentData[email]) this.enrichmentData[email] = {};

          this.enrichmentData[email].title = user.jobTitle;
          this.enrichmentData[email].id = user.id;
          this.enrichmentData[email].phone = user.mobilePhone || user.businessPhones?.[0];

          // Fetch photo
          // We can check if we already have it to avoid spamming graph?
          // For now, let's fetch.
          // Optimization: Add a timestamp check
          const photo = await this.graph.getPhoto(user.id);
          if (photo) {
            await this.avatars.saveAvatar(email, photo);
            this.enrichmentData[email].hasAvatar = true;
          }
        }

        this.saveEnrichmentData();
      }
    } catch (e) {
      console.error('Error during enrichment', e);
    }

    return this.applyLocalEnrichment(contacts);
  }

  private parseGroups(): GroupMap {
    const path = this.resolveExistingFile(GROUP_FILES);
    if (!path) return {};

    const contents = fs.readFileSync(path, 'utf-8');
    const data = parseCsv(contents);

    if (!data || data.length === 0) return {};

    const groups: GroupMap = {};
    const maxCols = data[0].length;
    for (let col = 0; col < maxCols; col++) {
      const groupName = data[0][col];
      if (!groupName) continue;
      const emails: string[] = [];
      for (let row = 1; row < data.length; row++) {
        const email = data[row][col];
        if (email) emails.push(String(email).trim());
      }
      groups[String(groupName).trim()] = emails;
    }
    return groups;
  }

  private parseContacts(): Contact[] {
    const path = this.resolveExistingFile(CONTACT_FILES);
    if (!path) return [];

    const contents = fs.readFileSync(path, 'utf-8');
    const data = parseCsv(contents);

    if (data.length < 2) return [];

    const header = data[0].map(h => h.toLowerCase());
    const rows = data.slice(1);

    return rows.map(rowValues => {
      const row: { [key: string]: string } = {};
      header.forEach((h, i) => {
        row[h] = rowValues[i];
      });

      const getField = (fieldNames: string[]) => {
        for (const fieldName of fieldNames) {
          if (row[fieldName.toLowerCase()]) return row[fieldName.toLowerCase()].trim();
        }
        return '';
      };

      const name = getField(['name', 'full name']);
      const email = getField(['email', 'e-mail']);
      const phone = getField(['phone', 'phone number']);
      const title = getField(['title', 'role', 'position', 'department', 'dept']);

      return {
        name,
        email,
        phone,
        title,
        _searchString: `${name} ${email} ${phone} ${title}`.toLowerCase(),
        raw: row,
        avatarUrl: undefined // Will be populated by enrichment
      };
    });
  }

  public destroy() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
