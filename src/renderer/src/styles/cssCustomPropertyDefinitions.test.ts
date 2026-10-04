import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_STYLE_VARS } from '../tabs/alerts/highlightColors';

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testFilePattern = /(\.test\.|\.test-util\.|[\\/]__tests__[\\/])/;

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const sourceFiles = listFiles(rendererRoot).filter((path) => !testFilePattern.test(path));
const cssFiles = sourceFiles.filter((path) => path.endsWith('.css'));
const codeFiles = sourceFiles.filter((path) => /\.tsx?$/.test(path));

/** Reads a source file, blanking CSS comments while keeping line numbers stable for failures. */
function readSource(path: string): string {
  const source = readFileSync(path, 'utf8');
  if (!path.endsWith('.css')) return source;
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

function collectDefinedProperties(): Set<string> {
  const defined = new Set<string>(Object.keys(HIGHLIGHT_STYLE_VARS));
  for (const path of cssFiles) {
    postcss.parse(readFileSync(path, 'utf8')).walkDecls((declaration) => {
      if (declaration.prop.startsWith('--')) defined.add(declaration.prop);
    });
  }
  // Runtime custom properties set from TS/TSX (`style={{ '--team-color': … }}`, setProperty).
  for (const path of codeFiles) {
    for (const [, property] of readSource(path).matchAll(/['"`](--[\w-]+)['"`]/g)) {
      if (property) defined.add(property);
    }
  }
  return defined;
}

describe('CSS custom property definitions', () => {
  it('never reads a custom property that is undefined and has no fallback', () => {
    const defined = collectDefinedProperties();
    const undefinedReads: string[] = [];

    for (const path of [...cssFiles, ...codeFiles]) {
      readSource(path)
        .split('\n')
        .forEach((line, index) => {
          for (const match of line.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
            const [, property, terminator] = match;
            if (terminator === ')' && property && !defined.has(property)) {
              undefinedReads.push(`${relative(rendererRoot, path)}:${index + 1} ${property}`);
            }
          }
        });
    }

    expect(undefinedReads).toEqual([]);
  });
});
