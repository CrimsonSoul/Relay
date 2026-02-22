import fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { loggers } from './logger';
import { JSON_DATA_FILES } from './operations/FileContext';

export async function ensureDataFilesAsync(targetRoot: string) {
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    loggers.fileManager.error('Failed to create persistent data directory', { error: e });
  }
}

export async function copyDataFilesAsync(sourceRoot: string, targetRoot: string): Promise<boolean> {
  try {
    await fsPromises.mkdir(targetRoot, { recursive: true });
  } catch (e) {
    loggers.fileManager.error('Failed to create target directory', { error: e });
  }

  const results = await Promise.all(
    JSON_DATA_FILES.map(async (file) => {
      const source = join(sourceRoot, file);
      const target = join(targetRoot, file);
      try {
        await fsPromises.access(target);
        return false; // Target already exists
      } catch {
        try {
          await fsPromises.access(source);
          await fsPromises.copyFile(source, target);
          loggers.fileManager.debug(`Copied ${file}`, { from: sourceRoot, to: targetRoot });
          return true;
        } catch {
          // Source doesn't exist, skip - JSON files are created on-demand
          return false;
        }
      }
    }),
  );

  return results.some(Boolean);
}

export async function loadConfigAsync(): Promise<{ dataRoot?: string }> {
  try {
    const content = await fsPromises.readFile(
      join(app.getPath('userData'), 'config.json'),
      'utf-8',
    );
    const parsed: unknown = JSON.parse(content);
    // Validate that the config is a plain object with an optional string dataRoot
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      loggers.fileManager.error('config.json is not a valid object, resetting to defaults');
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    if ('dataRoot' in obj && typeof obj.dataRoot !== 'string') {
      loggers.fileManager.error('config.json dataRoot is not a string, ignoring');
      return {};
    }
    return obj as { dataRoot?: string };
  } catch {
    return {};
  }
}

export async function saveConfigAsync(config: { dataRoot?: string }): Promise<void> {
  try {
    await fsPromises.writeFile(
      join(app.getPath('userData'), 'config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  } catch (error) {
    loggers.fileManager.error('Failed to save config', { error });
  }
}
