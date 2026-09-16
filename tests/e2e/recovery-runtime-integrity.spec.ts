import { _electron as electron, expect, test } from '@playwright/test';
import { createPackage } from '@electron/asar';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const integrityFiles = [
  ['executableSha512', 'Relay.exe'],
  ['d3dCompilerSha512', 'd3dcompiler_47.dll'],
  ['dxCompilerSha512', 'dxcompiler.dll'],
  ['dxilSha512', 'dxil.dll'],
  ['ffmpegSha512', 'ffmpeg.dll'],
  ['libEglSha512', 'libEGL.dll'],
  ['libGlesV2Sha512', 'libGLESv2.dll'],
  ['vkSwiftshaderSha512', 'vk_swiftshader.dll'],
  ['vulkanSha512', 'vulkan-1.dll'],
  ['appAsarSha512', 'resources/app.asar'],
  ['pocketbaseSha512', 'resources/pocketbase/win32-x64/pocketbase.exe'],
  ['pocketbaseHookSha512', 'resources/pocketbase/hooks/relay_privileged_reauth.pb.js'],
  [
    'betterSqlite3Sha512',
    'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  ],
  [
    'koffiSha512',
    'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  ],
] as const;

test('recovery verifies physical ASAR bytes inside Electron and rejects archive tampering', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'relay-recovery-asar-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const runtime = join(fixture, 'runtime');
    for (const [, file] of integrityFiles) {
      const path = join(runtime, file);
      mkdirSync(dirname(path), { recursive: true });
      if (file !== 'resources/app.asar') writeFileSync(path, `Fixture for ${file}`);
    }
    const archiveInput = join(fixture, 'archive-input');
    mkdirSync(archiveInput);
    writeFileSync(join(archiveInput, 'package.json'), '{"name":"recovery-fixture"}');
    const archive = join(runtime, 'resources/app.asar');
    await createPackage(archiveInput, archive);
    const hashes = integrityFiles.map(([key, file]) => {
      const digest = createHash('sha512')
        .update(readFileSync(join(runtime, file)))
        .digest('hex');
      return `${key}=${digest}`;
    });
    writeFileSync(
      join(runtime, '.relay-runtime-ready'),
      ['[Relay]', 'protocol=2', '[Integrity]', ...hashes, ''].join('\n'),
    );
    const verifier = join(fixture, 'integrity.cjs');
    writeFileSync(
      verifier,
      ts.transpileModule(
        readFileSync(
          resolve(import.meta.dirname, '../../src/main/releases/RecoveryRuntimeIntegrity.ts'),
          'utf8',
        ),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
        },
      ).outputText,
    );
    const main = join(fixture, 'main.cjs');
    writeFileSync(
      main,
      `const {app,BrowserWindow}=require('electron'); app.dock?.hide(); globalThis.integrityTest={...require('./integrity.cjs'),fs:require('node:fs')}; app.whenReady().then(()=>new BrowserWindow({show:false}).loadURL('about:blank'));`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [`--user-data-dir=${join(fixture, 'user-data')}`, main],
      env,
    });
    const verify = () =>
      app!.evaluate(
        async (_, input) => {
          const harness = (
            globalThis as unknown as {
              integrityTest: {
                readRecoveryRuntimeMarker: (
                  directory: string,
                ) => Promise<{ contentVerified: boolean } | null>;
                fs: typeof import('node:fs');
              };
            }
          ).integrityTest;
          return {
            virtualDirectory: harness.fs.lstatSync(input.archive).isDirectory(),
            verified: (await harness.readRecoveryRuntimeMarker(input.runtime))?.contentVerified,
          };
        },
        { archive, runtime },
      );
    expect(await verify()).toEqual({ virtualDirectory: true, verified: true });
    appendFileSync(archive, 'modified after installation');
    expect(await verify()).toEqual({ virtualDirectory: true, verified: false });
  } finally {
    await app?.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});
