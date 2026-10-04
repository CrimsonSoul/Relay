import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(__dirname, '../..');
const mainSource = readFileSync(join(rendererRoot, 'main.tsx'), 'utf8');
const themeCss = readFileSync(join(rendererRoot, 'styles/theme.css'), 'utf8');

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });

const weightTokens = new Map(
  [...themeCss.matchAll(/(--weight-[\w-]+):\s*(\d+);/g)].map(([, name, value]) => [
    name,
    Number(value),
  ]),
);

/** Every `font-weight` declaration across the renderer CSS, resolved to a number. */
const declaredWeights = cssFiles(rendererRoot).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/font-weight:\s*([^;}\n]+)/g)].map(([, raw]) => {
    const value = (raw ?? '').trim();
    const token = /^var\((--weight-[\w-]+)\)$/.exec(value)?.[1];
    const weight = token ? weightTokens.get(token) : Number(value);
    return { at: relative(rendererRoot, file), value, weight };
  }),
);

/** IBM Plex Sans upright weights bundled by main.tsx. */
const loadedWeights = new Set(
  [...mainSource.matchAll(/@fontsource\/ibm-plex-sans\/(\d+)\.css/g)].map(([, w]) => Number(w)),
);

describe('font weight contract', () => {
  it('resolves every numeric or token font-weight it finds', () => {
    const unresolved = declaredWeights.filter(
      ({ value, weight }) => /^(\d+|var\(--weight-)/.test(value) && !Number.isFinite(weight),
    );
    expect(unresolved).toEqual([]);
  });

  it('keeps numeric weights in theme.css; every other stylesheet uses a --weight-* token', () => {
    const numeric = declaredWeights.filter(
      ({ at, value }) => at !== join('styles', 'theme.css') && /^\d/.test(value),
    );
    expect(declaredWeights.length).toBeGreaterThan(0);
    expect(numeric).toEqual([]);
  });

  it('never asks for a weight heavier than 700, the heaviest bundled Plex face', () => {
    const tooHeavy = declaredWeights.filter(({ weight }) => (weight ?? 0) > 700);
    expect(tooHeavy).toEqual([]);
    expect([...weightTokens.values()].every((weight) => weight <= 700)).toBe(true);
  });

  it('only uses numeric weights whose IBM Plex Sans face is bundled', () => {
    const unloaded = declaredWeights.filter(
      ({ weight }) => Number.isFinite(weight) && !loadedWeights.has(weight as number),
    );
    expect(unloaded).toEqual([]);
  });

  it('bundles the 200 italic face for the italic light empty-state copy', () => {
    expect(loadedWeights.has(200)).toBe(true);
    expect(mainSource).toContain("'@fontsource/ibm-plex-sans/200-italic.css'");
  });
});
