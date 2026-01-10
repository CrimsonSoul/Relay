import fs from 'fs';
import fsPromises from 'fs/promises';
import { join } from 'path';
import { app } from 'electron';
import { logger } from './logger';

const DEFAULT_HEADERS: Record<string, string> = {
  'groups.csv': 'Group,Members', 'contacts.csv': 'Name,Email,Phone,Title',
  'servers.csv': 'Server,IP,Port,Protocol,Owner,Comment', 'oncall.csv': 'Team,Primary,Backup,Label'
};

export async function ensureDataFilesAsync(targetRoot: string, _bundledDataPath: string, _isPackaged: boolean) {
  try { await fsPromises.mkdir(targetRoot, { recursive: true }); } catch (e) { logger.error('DataUtils', 'Failed to create persistent data directory', { error: e }); }
  const files = ['groups.csv', 'contacts.csv'];
  for (const file of files) {
    const targetPath = join(targetRoot, file);
    try { await fsPromises.access(targetPath); } catch {
      try { await fsPromises.writeFile(targetPath, (DEFAULT_HEADERS[file] || '') + '\n', 'utf-8'); logger.debug('DataUtils', `Created empty ${file} with headers only`); }
      catch (e) { logger.error('DataUtils', `Failed to create ${file}`, { error: e }); }
    }
  }
}

export function ensureDataFiles(targetRoot: string, _bundledDataPath: string, _isPackaged: boolean) {
  if (!fs.existsSync(targetRoot)) { try { fs.mkdirSync(targetRoot, { recursive: true }); } catch (e) { logger.error('DataUtils', 'Failed to create persistent data directory', { error: e }); } }
  const files = ['groups.csv', 'contacts.csv'];
  for (const file of files) {
    const targetPath = join(targetRoot, file);
    if (!fs.existsSync(targetPath)) {
      try { fs.writeFileSync(targetPath, (DEFAULT_HEADERS[file] || '') + '\n', 'utf-8'); logger.debug('DataUtils', `Created empty ${file} with headers only`); }
      catch (e) { logger.error('DataUtils', `Failed to create ${file}`, { error: e }); }
    }
  }
}

export async function copyDataFilesAsync(sourceRoot: string, targetRoot: string, _bundledDataPath: string): Promise<boolean> {
  const essentialFiles = ['contacts.csv', 'groups.csv', 'oncall.csv', 'history.json'];
  try { await fsPromises.mkdir(targetRoot, { recursive: true }); } catch (e) { logger.error('DataUtils', 'Failed to create target directory', { error: e }); }
  const results = await Promise.all(essentialFiles.map(async (file) => {
    const source = join(sourceRoot, file), target = join(targetRoot, file);
    try {
      await fsPromises.access(target);
      return false;
    } catch {
      try {
        await fsPromises.access(source);
        await fsPromises.copyFile(source, target);
        logger.debug('DataUtils', `Copied ${file}`, { from: sourceRoot, to: targetRoot });
        return true;
      } catch {
        const headers = DEFAULT_HEADERS[file];
        if (headers) {
          try {
            await fsPromises.writeFile(target, headers + '\n', 'utf-8');
            logger.debug('DataUtils', `Created empty ${file} with headers only`);
            return true;
          } catch (writeErr) {
            logger.debug('DataUtils', `Failed to create ${file}`, { error: writeErr });
          }
        }
        return false;
      }
    }
  }));
  return results.some(copied => copied);
}

export function copyDataFiles(sourceRoot: string, targetRoot: string, _bundledDataPath: string) {
  const essentialFiles = ['contacts.csv', 'groups.csv', 'oncall.csv', 'history.json'];
  let filesCopied = false;
  if (!fs.existsSync(targetRoot)) { try { fs.mkdirSync(targetRoot, { recursive: true }); } catch (e) { logger.error('DataUtils', 'Failed to create target dir', { error: e }); } }
  for (const file of essentialFiles) {
    const source = join(sourceRoot, file), target = join(targetRoot, file);
    if (!fs.existsSync(target)) {
      if (fs.existsSync(source)) { try { fs.copyFileSync(source, target); filesCopied = true; logger.debug('DataUtils', `Copied ${file}`, { from: sourceRoot, to: targetRoot }); } catch (e) { logger.error('DataUtils', `Failed to copy ${file}`, { error: e }); } }
      else { const headers = DEFAULT_HEADERS[file]; if (headers) { try { fs.writeFileSync(target, headers + '\n', 'utf-8'); filesCopied = true; logger.debug('DataUtils', `Created empty ${file} with headers only`); } catch (e) { logger.error('DataUtils', `Failed to create ${file}`, { error: e }); } } }
    }
  }
  return filesCopied;
}

export async function loadConfigAsync(): Promise<{ dataRoot?: string }> {
  try { const content = await fsPromises.readFile(join(app.getPath('userData'), 'config.json'), 'utf-8'); return JSON.parse(content); } catch { return {}; }
}

export function loadConfig(): { dataRoot?: string } {
  try { const configPath = join(app.getPath('userData'), 'config.json'); if (fs.existsSync(configPath)) { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } } catch (error) { logger.error('DataUtils', 'Failed to load config', { error }); }
  return {};
}

export async function saveConfigAsync(config: { dataRoot?: string }): Promise<void> {
  try { await fsPromises.writeFile(join(app.getPath('userData'), 'config.json'), JSON.stringify(config, null, 2), 'utf-8'); } catch (error) { logger.error('DataUtils', 'Failed to save config', { error }); }
}

export function saveConfig(config: { dataRoot?: string }) {
  try { fs.writeFileSync(join(app.getPath('userData'), 'config.json'), JSON.stringify(config, null, 2), 'utf-8'); } catch (error) { logger.error('DataUtils', 'Failed to save config', { error }); }
}

export { generateDummyDataAsync } from './dummyDataGenerator';
