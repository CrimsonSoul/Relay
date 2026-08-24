import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localImportPattern = /^@import\s+['"]([^'"]+)['"][^;]*;/gm;

function expandCssFile(absolutePath: string, visited: Set<string>): string {
  if (visited.has(absolutePath)) return '';
  visited.add(absolutePath);

  const source = readFileSync(absolutePath, 'utf8');
  return source.replace(localImportPattern, (_statement, importPath: string) =>
    expandCssFile(resolve(dirname(absolutePath), importPath), visited),
  );
}

/**
 * Expands local CSS imports for source-level tests that assert rendered style
 * outcomes rather than stylesheet ownership or loading behavior.
 */
export function readCssBundle(path: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(rendererRoot, path);
  return expandCssFile(absolutePath, new Set<string>());
}
