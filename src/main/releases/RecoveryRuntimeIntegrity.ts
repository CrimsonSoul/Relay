import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const MAX_MARKER_BYTES = 32 * 1_024;
const MARKER_FILE = '.relay-runtime-ready';
const INTEGRITY_FILES = [
  ['executableSha512', 'Relay.exe'],
  ['appAsarSha512', join('resources', 'app.asar')],
  ['pocketbaseSha512', join('resources', 'pocketbase', 'win32-x64', 'pocketbase.exe')],
  [
    'betterSqlite3Sha512',
    join(
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
  ],
  [
    'koffiSha512',
    join(
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '@koromix',
      'koffi-win32-x64',
      'win32_x64',
      'koffi.node',
    ),
  ],
] as const;

export type RecoveryRuntimeMarker = {
  relay: ReadonlyMap<string, string>;
  runtimeSha512: string;
  contentVerified: boolean;
};

type Ini = Map<string, Map<string, string>>;
type IniParseState = { current: Map<string, string> | null };

function acceptIniLine(rawLine: string, sections: Ini, state: IniParseState): boolean {
  const line = rawLine.trim();
  if (!line || line.startsWith(';') || line.startsWith('#')) return true;
  if (line.startsWith('[') && line.endsWith(']')) {
    const name = line.slice(1, -1);
    if (!name || sections.has(name)) return false;
    state.current = new Map();
    sections.set(name, state.current);
    return true;
  }
  if (!state.current) return false;
  const separator = line.indexOf('=');
  if (separator <= 0) return false;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!key || state.current.has(key)) return false;
  state.current.set(key, value);
  return true;
}

function parseIni(text: string): Map<string, Map<string, string>> | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_MARKER_BYTES || text.includes('\0')) return null;
  const sections: Ini = new Map();
  const state: IniParseState = { current: null };
  for (const rawLine of text.split(/\r?\n/u)) {
    if (!acceptIniLine(rawLine, sections, state)) return null;
  }
  return sections;
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyFile(
  runtimeDirectory: string,
  realRuntimeDirectory: string,
  relativePath: string,
  expectedHash: string | undefined,
): Promise<boolean> {
  if (!expectedHash || !SHA512_PATTERN.test(expectedHash)) return false;
  const path = join(runtimeDirectory, relativePath);
  try {
    const [stats, realPath] = await Promise.all([lstat(path), realpath(path)]);
    if (stats.isSymbolicLink() || !stats.isFile()) return false;
    const resolvedRelative = relative(realRuntimeDirectory, realPath);
    if (isAbsolute(resolvedRelative) || resolvedRelative !== relativePath) return false;
    return (await sha512(realPath)) === expectedHash;
  } catch {
    return false;
  }
}

export async function readRecoveryRuntimeMarker(
  runtimeDirectory: string,
): Promise<RecoveryRuntimeMarker | null> {
  const markerPath = join(runtimeDirectory, MARKER_FILE);
  try {
    const [runtimeStats, realRuntimeDirectory, markerStats, realMarkerPath] = await Promise.all([
      lstat(runtimeDirectory),
      realpath(runtimeDirectory),
      lstat(markerPath),
      realpath(markerPath),
    ]);
    if (
      !runtimeStats.isDirectory() ||
      runtimeStats.isSymbolicLink() ||
      !markerStats.isFile() ||
      markerStats.isSymbolicLink() ||
      markerStats.size > MAX_MARKER_BYTES ||
      relative(realRuntimeDirectory, realMarkerPath) !== MARKER_FILE
    ) {
      return null;
    }

    const markerBytes = await readFile(realMarkerPath);
    const sections = parseIni(markerBytes.toString('utf8'));
    const relay = sections?.get('Relay');
    if (!sections || !relay) return null;
    if (relay.get('protocol') === '1') {
      const payloadHash = relay.get('payloadHash') ?? '';
      return SHA512_PATTERN.test(payloadHash)
        ? { relay, runtimeSha512: payloadHash, contentVerified: false }
        : null;
    }
    if (relay.get('protocol') !== '2' || sections.size !== 2) return null;
    const integrity = sections.get('Integrity');
    if (!integrity || integrity.size !== INTEGRITY_FILES.length) return null;
    const contentVerified = (
      await Promise.all(
        INTEGRITY_FILES.map(([key, relativePath]) =>
          verifyFile(runtimeDirectory, realRuntimeDirectory, relativePath, integrity.get(key)),
        ),
      )
    ).every(Boolean);
    return {
      relay,
      runtimeSha512: createHash('sha512').update(markerBytes).digest('hex'),
      contentVerified,
    };
  } catch {
    return null;
  }
}
