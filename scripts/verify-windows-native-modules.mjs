#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectWindowsNativeModule } from './windows-package-contract.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const defaultAppDirectory = join(projectDir, 'release', 'win-unpacked');

export const WINDOWS_NATIVE_MODULES = [
  {
    label: 'better-sqlite3',
    relativePath:
      'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  },
  {
    label: 'Koffi',
    relativePath:
      'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
  },
];

export async function verifyWindowsNativeModules(appDirectory = defaultAppDirectory) {
  const resolvedAppDirectory = resolve(appDirectory);
  const modules = [];
  for (const { label, relativePath } of WINDOWS_NATIVE_MODULES) {
    const file = join(resolvedAppDirectory, relativePath);
    const result = inspectWindowsNativeModule(await readFile(file), label);
    modules.push({ label, file, ...result });
  }
  return { appDirectory: resolvedAppDirectory, modules };
}

async function main(argv) {
  if (argv.length > 1) {
    throw new Error(
      'Usage: node scripts/verify-windows-native-modules.mjs [win-unpacked-directory]',
    );
  }
  process.stdout.write(`${JSON.stringify(await verifyWindowsNativeModules(argv[0]), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
