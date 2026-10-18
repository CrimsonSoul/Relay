import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const createReadStream = ((path: string, ...rest: unknown[]) => {
    reads.paths.push(path);
    return (actual.createReadStream as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.createReadStream;
  return { ...actual, createReadStream, default: { ...actual, createReadStream } };
});

import { readRecoveryRuntimeMarker } from './RecoveryRuntimeIntegrity';

const unpacked = join('resources', 'app.asar.unpacked', 'node_modules');
const files: Array<[string, string]> = [
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
    join(unpacked, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  ],
  ['koffiSha512', join(unpacked, '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node')],
];

let runtime: string;

beforeEach(async () => {
  runtime = await mkdtemp(join(tmpdir(), 'relay-runtime-integrity-'));
  reads.paths.length = 0;
  const integrity: string[] = [];
  for (const [key, path] of files) {
    const contents = `fixture ${key}`;
    await mkdir(dirname(join(runtime, path)), { recursive: true });
    await writeFile(join(runtime, path), contents);
    integrity.push(`${key}=${createHash('sha512').update(contents).digest('hex')}`);
  }
  await writeFile(
    join(runtime, '.relay-runtime-ready'),
    ['[Relay]', 'protocol=2', '', '[Integrity]', ...integrity, ''].join('\r\n'),
  );
});

afterEach(() => rm(runtime, { recursive: true, force: true }));

describe('readRecoveryRuntimeMarker', () => {
  it('hashes each unchanged runtime file once per process', async () => {
    await expect(readRecoveryRuntimeMarker(runtime)).resolves.toMatchObject({
      contentVerified: true,
    });
    expect(reads.paths).toHaveLength(files.length);

    await expect(readRecoveryRuntimeMarker(runtime)).resolves.toMatchObject({
      contentVerified: true,
    });
    expect(reads.paths).toHaveLength(files.length);
  });

  it('hashes a file again after it changes, even at the same size', async () => {
    await readRecoveryRuntimeMarker(runtime);
    const [key, path] = files[9]!;
    const original = `fixture ${key}`;
    await writeFile(join(runtime, path), 'X'.repeat(original.length));

    await expect(readRecoveryRuntimeMarker(runtime)).resolves.toMatchObject({
      contentVerified: false,
    });
    expect(reads.paths).toHaveLength(files.length + 1);
  });
});
