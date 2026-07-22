#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NtExecutable, NtExecutableResource } from 'pe-library';

export function assertAsInvokerManifest(manifest, label) {
  const level = manifest.match(/requestedExecutionLevel\b[^>]*\blevel=["']([^"']+)["']/i)?.[1];
  const uiAccess = manifest.match(
    /requestedExecutionLevel\b[^>]*\buiAccess=["']([^"']+)["']/i,
  )?.[1];
  if (level !== 'asInvoker') {
    throw new Error(`${label} must request execution level asInvoker, found ${level ?? 'none'}.`);
  }
  if (uiAccess?.toLowerCase() !== 'false') {
    throw new Error(`${label} must set uiAccess=false.`);
  }
}

export function verifyWindowsPe(filePath) {
  const executable = NtExecutable.from(readFileSync(filePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable, true);
  const manifests = resources.entries
    .filter((entry) => entry.type === 24)
    .map((entry) => Buffer.from(entry.bin).toString('utf8').replaceAll('\0', ''));
  if (manifests.length === 0) {
    throw new Error(`${filePath} has no Windows application manifest.`);
  }

  let lastError;
  for (const manifest of manifests) {
    try {
      assertAsInvokerManifest(manifest, filePath);
      return {
        file: path.resolve(filePath),
        sizeBytes: statSync(filePath).size,
        architecture: executable.is32bit() ? 'pe32' : 'pe32+',
        requestedExecutionLevel: 'asInvoker',
        uiAccess: false,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function main(argv) {
  if (argv.length === 0) {
    throw new Error('Usage: node scripts/verify-windows-pe.mjs <executable> [...]');
  }
  process.stdout.write(`${JSON.stringify(argv.map(verifyWindowsPe), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
