import fs from 'fs';
import fsPromises from 'fs/promises';
import { join } from 'path';
import { app } from 'electron';
import { logger } from './logger';

// JSON files used by the application (CSV is legacy, handled by migration)
const JSON_DATA_FILES = ['contacts.json', 'servers.json', 'oncall.json', 'bridgeGroups.json', 'history.json'];

export async function ensureDataFilesAsync(targetRoot: string) {
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    logger.error('DataUtils', 'Failed to create persistent data directory', { error: e });
  }
  // No longer create CSV stub files - JSON files are created on-demand by their respective operations
}

export function ensureDataFiles(targetRoot: string) {
  if (!fs.existsSync(targetRoot)) {
    try {
      fs.mkdirSync(targetRoot, { recursive: true });
    } catch (e) {
      logger.error('DataUtils', 'Failed to create persistent data directory', { error: e });
    }
  }
  // No longer create CSV stub files - JSON files are created on-demand by their respective operations
}

export async function copyDataFilesAsync(sourceRoot: string, targetRoot: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    logger.error('DataUtils', 'Failed to create target directory', { error: e });
  }

  const results = await Promise.all(JSON_DATA_FILES.map(async (file) => {
    const source = join(sourceRoot, file);
    const target = join(targetRoot, file);
    try {
      await fsPromises.access(target);
      return false; // Target already exists
    } catch {
      try {
        await fsPromises.access(source);
        await fsPromises.copyFile(source, target);
        logger.debug('DataUtils', `Copied ${file}`, { from: sourceRoot, to: targetRoot });
        return true;
      } catch {
        // Source doesn't exist, skip - JSON files are created on-demand
        return false;
      }
    }
  }));

  return results.some(copied => copied);
}

export function copyDataFiles(sourceRoot: string, targetRoot: string) {
  let filesCopied = false;

  if (!fs.existsSync(targetRoot)) {
    try {
      fs.mkdirSync(targetRoot, { recursive: true });
    } catch (e) {
      logger.error('DataUtils', 'Failed to create target dir', { error: e });
    }
  }

  for (const file of JSON_DATA_FILES) {
    const source = join(sourceRoot, file);
    const target = join(targetRoot, file);

    if (!fs.existsSync(target)) {
      if (fs.existsSync(source)) {
        try {
          fs.copyFileSync(source, target);
          filesCopied = true;
          logger.debug('DataUtils', `Copied ${file}`, { from: sourceRoot, to: targetRoot });
        } catch (e) {
          logger.error('DataUtils', `Failed to copy ${file}`, { error: e });
        }
      }
      // No longer create empty files - JSON files are created on-demand
    }
  }

  return filesCopied;
}

export async function loadConfigAsync(): Promise<{ dataRoot?: string }> {
  try {
    const content = await fsPromises.readFile(join(app.getPath('userData'), 'config.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export function loadConfig(): { dataRoot?: string } {
  try {
    const configPath = join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (error) {
    logger.error('DataUtils', 'Failed to load config', { error });
  }
  return {};
}

export async function saveConfigAsync(config: { dataRoot?: string }): Promise<void> {
  try {
    await fsPromises.writeFile(join(app.getPath('userData'), 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logger.error('DataUtils', 'Failed to save config', { error });
  }
}

export function saveConfig(config: { dataRoot?: string }) {
  try {
    fs.writeFileSync(join(app.getPath('userData'), 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    logger.error('DataUtils', 'Failed to save config', { error });
  }
}

export { generateDummyDataAsync } from './dummyDataGenerator';
