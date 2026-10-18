import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { isDirectChild, parseIniSections, type IniSections } from './recoveryFormat';

// Electron's patched fs presents app.asar as a directory. Integrity checks must
// inspect and hash the physical archive without changing process-wide ASAR handling.
const runtimeFs: typeof fs = process.versions.electron ? require('original-fs') : fs;
const { createReadStream } = runtimeFs;
const { lstat, readFile, realpath } = runtimeFs.promises;

const SHA512_PATTERN = /^[0-9a-f]{128}$/u;
const MAX_MARKER_BYTES = 32 * 1_024;
const MARKER_FILE = '.relay-runtime-ready';
const INTEGRITY_FILES = [
  ['executableSha512', 'Relay.exe'],
  ['d3dCompilerSha512', 'd3dcompiler_47.dll'],
  ['dxCompilerSha512', 'dxcompiler.dll'],
  ['dxilSha512', 'dxil.dll'],
  ['ffmpegSha512', 'ffmpeg.dll'],
  ['libEglSha512', 'libEGL.dll'],
  ['libGlesV2Sha512', 'libGLESv2.dll'],
  ['vkSwiftshaderSha512', 'vk_swiftshader.dll'],
  ['vulkanSha512', 'vulkan-1.dll'],
  ['appAsarSha512', join('resources', 'app.asar')],
  ['pocketbaseSha512', join('resources', 'pocketbase', 'win32-x64', 'pocketbase.exe')],
  [
    'pocketbaseHookSha512',
    join('resources', 'pocketbase', 'hooks', 'relay_privileged_reauth.pb.js'),
  ],
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

function parseIni(text: string): IniSections | null {
  return parseIniSections(text, { maximumBytes: MAX_MARKER_BYTES, comments: true });
}

type FileIdentity = { size: number; mtimeMs: number; ctimeMs: number; ino: number };

function fileIdentityKey(realPath: string, stats: FileIdentity): string {
  return JSON.stringify([realPath, stats.size, stats.mtimeMs, stats.ctimeMs, stats.ino]);
}

// Runtime payloads are large (app.asar, Relay.exe) and recovery state is inspected on every
// settings view, so each unchanged file is hashed once per process.
const MAX_REMEMBERED_DIGESTS = 256;
const rememberedDigests = new Map<string, string>();

async function sha512(realPath: string, stats: FileIdentity): Promise<string> {
  const key = fileIdentityKey(realPath, stats);
  const remembered = rememberedDigests.get(key);
  if (remembered) return remembered;
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(realPath)) hash.update(chunk);
  const digest = hash.digest('hex');
  // Remember only a digest of bytes that did not change while they were read.
  if (fileIdentityKey(realPath, await lstat(realPath)) === key) {
    if (rememberedDigests.size >= MAX_REMEMBERED_DIGESTS) rememberedDigests.clear();
    rememberedDigests.set(key, digest);
  }
  return digest;
}

async function verifyFile(
  runtimeDirectory: string,
  realRuntimeDirectory: string,
  relativePath: string,
  expectedHash: string | undefined,
): Promise<boolean> {
  if (!expectedHash) return false;
  const canonicalExpectedHash = expectedHash.toLowerCase();
  if (!SHA512_PATTERN.test(canonicalExpectedHash)) return false;
  const path = join(runtimeDirectory, relativePath);
  try {
    const [stats, realPath] = await Promise.all([lstat(path), realpath(path)]);
    if (stats.isSymbolicLink() || !stats.isFile()) return false;
    if (!isDirectChild(realRuntimeDirectory, realPath, relativePath)) return false;
    return (await sha512(realPath, stats)) === canonicalExpectedHash;
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
      const payloadHash = (relay.get('payloadHash') ?? '').toLowerCase();
      return SHA512_PATTERN.test(payloadHash)
        ? { relay, runtimeSha512: payloadHash, contentVerified: false }
        : null;
    }
    if (relay.get('protocol') !== '2' || sections.size !== 2) return null;
    const integrity = sections.get('Integrity');
    if (integrity?.size !== INTEGRITY_FILES.length) return null;
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
