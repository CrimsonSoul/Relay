import fs from 'fs';
import { join } from 'path';

export function ensureDataFiles(targetRoot: string, bundledDataPath: string, isPackaged: boolean) {
  if (!isPackaged) return;

  if (!fs.existsSync(targetRoot)) {
    try {
      fs.mkdirSync(targetRoot, { recursive: true });
    } catch (e) {
      console.error('Failed to create persistent data directory:', e);
    }
  }

  // Ensure groups.csv and contacts.csv exist
  const files = ['groups.csv', 'contacts.csv'];
  for (const file of files) {
    const targetPath = join(targetRoot, file);
    if (!fs.existsSync(targetPath)) {
      const sourcePath = join(bundledDataPath, file);
      if (fs.existsSync(sourcePath)) {
        try {
          fs.copyFileSync(sourcePath, targetPath);
        } catch (e) {
          console.error(`Failed to copy default ${file}:`, e);
        }
      }
    }
  }
}
