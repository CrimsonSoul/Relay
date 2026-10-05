import { _electron as electron, expect, test } from '@playwright/test';
import { createPackage } from '@electron/asar';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

function transpile(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(
    destination,
    ts.transpileModule(
      readFileSync(resolve(import.meta.dirname, '../../src/main', source), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      },
    ).outputText,
  );
}

function writeRuntime(runtimeRoot: string, buildId: string, withMarker: boolean): string {
  const directory = join(runtimeRoot, buildId);
  mkdirSync(join(directory, 'resources'), { recursive: true });
  writeFileSync(join(directory, 'Relay.exe'), 'fixture');
  if (withMarker) {
    writeFileSync(
      join(directory, '.relay-runtime-ready'),
      `[Relay]\nprotocol=1\nbuildId=${buildId}\n`,
    );
  }
  return directory;
}

test('runtime cleanup removes unreferenced runtimes containing app.asar inside Electron', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'relay-runtime-cleanup-asar-'));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const archiveInput = join(fixture, 'archive-input');
    mkdirSync(archiveInput);
    writeFileSync(join(archiveInput, 'package.json'), '{"name":"cleanup-fixture"}');
    const archive = join(fixture, 'app.asar');
    await createPackage(archiveInput, archive);

    const root = join(fixture, 'Relay');
    const runtimeRoot = join(root, 'Runtime');
    const current = writeRuntime(runtimeRoot, 'r1-current', true);
    const orphan = writeRuntime(runtimeRoot, 'r1-orphan', true);
    writeFileSync(join(orphan, 'resources', 'app.asar'), readFileSync(archive));
    // What earlier cleanups left behind when Electron's ASAR-aware fs could not remove the archive.
    const remnant = join(runtimeRoot, 'r1-remnant');
    mkdirSync(join(remnant, 'resources'), { recursive: true });
    writeFileSync(join(remnant, 'resources', 'app.asar'), readFileSync(archive));
    writeFileSync(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=r1-current\n');

    transpile('releases/RecoveryCatalog.ts', join(fixture, 'harness/releases/RecoveryCatalog.js'));
    transpile(
      'app/windowsRuntimeCleanup.ts',
      join(fixture, 'harness/app/windowsRuntimeCleanup.js'),
    );
    const main = join(fixture, 'main.cjs');
    writeFileSync(
      main,
      `const {app,BrowserWindow}=require('electron'); app.dock?.hide(); globalThis.cleanupTest=require('./harness/app/windowsRuntimeCleanup.js'); app.whenReady().then(()=>new BrowserWindow({show:false}).loadURL('about:blank'));`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [`--user-data-dir=${join(fixture, 'user-data')}`, main],
      env,
    });

    const result = await app.evaluate(
      async (_, input) => {
        const harness = (
          globalThis as unknown as {
            cleanupTest: {
              cleanupWindowsRuntimes: (options: {
                root: string;
                execPath: string;
              }) => Promise<{ removed: string[]; failed: string[] }>;
            };
          }
        ).cleanupTest;
        return harness.cleanupWindowsRuntimes(input);
      },
      { root, execPath: join(current, 'Relay.exe') },
    );

    expect(result).toMatchObject({ removed: ['r1-orphan', 'r1-remnant'], failed: [] });
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(remnant)).toBe(false);
    expect(existsSync(current)).toBe(true);
  } finally {
    await app?.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});
