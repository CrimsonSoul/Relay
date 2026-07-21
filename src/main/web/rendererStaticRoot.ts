import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveRendererStaticRoot(mainModuleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(mainModuleUrl)), '../renderer');
}
