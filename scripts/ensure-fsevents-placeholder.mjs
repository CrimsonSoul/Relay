import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const fseventsPath = path.join(projectRoot, 'node_modules', 'fsevents');

async function ensurePlaceholder() {
  try {
    await fs.access(fseventsPath);
    return;
  } catch {
    // Missing optional dependency on non-macOS platforms; create a placeholder so packaging doesn't fail.
  }

  await fs.mkdir(fseventsPath, { recursive: true });
  await fs.writeFile(
    path.join(fseventsPath, 'README.txt'),
    'Placeholder for optional macOS-only fsevents dependency created during Windows packaging.'
  );
}

ensurePlaceholder().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
