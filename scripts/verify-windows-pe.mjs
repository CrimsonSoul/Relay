#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NtExecutable, NtExecutableResource } from 'pe-library';

export function assertAsInvokerManifest(manifest, label) {
  const activeXml = manifest
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const declarations = activeXml.match(/<requestedExecutionLevel\b[^>]*>/gi) ?? [];
  if (declarations.length !== 1) {
    throw new Error(
      `${label} must contain exactly one active requestedExecutionLevel declaration.`,
    );
  }
  const declaration = declarations[0];
  const level = declaration.match(/\blevel=["']([^"']+)["']/i)?.[1];
  const uiAccess = declaration.match(/\buiAccess=["']([^"']+)["']/i)?.[1];
  if (level !== 'asInvoker') {
    throw new Error(`${label} must request execution level asInvoker, found ${level ?? 'none'}.`);
  }
  if (uiAccess?.toLowerCase() !== 'false') {
    throw new Error(`${label} must set uiAccess=false.`);
  }
}

export function assertApplicationManifestResources(resources, label) {
  if (resources.length !== 1 || resources[0]?.id !== 1) {
    throw new Error(`${label} must contain exactly one primary application manifest resource.`);
  }
  assertAsInvokerManifest(resources[0].manifest, label);
}

function decodeManifest(entry) {
  const bytes = Buffer.from(entry.bin);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le').replaceAll('\0', '');
  }
  return bytes
    .toString('utf8')
    .replaceAll('\0', '')
    .replace(/^\uFEFF/, '');
}

export function verifyWindowsPe(filePath) {
  const executable = NtExecutable.from(readFileSync(filePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable, true);
  const manifests = resources.entries
    .filter((entry) => entry.type === 24)
    .map((entry) => ({ id: entry.id, manifest: decodeManifest(entry) }));
  if (manifests.length === 0) {
    throw new Error(`${filePath} has no Windows application manifest.`);
  }
  assertApplicationManifestResources(manifests, filePath);
  return {
    file: path.resolve(filePath),
    sizeBytes: statSync(filePath).size,
    architecture: executable.is32bit() ? 'pe32' : 'pe32+',
    requestedExecutionLevel: 'asInvoker',
    uiAccess: false,
  };
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
