#!/usr/bin/env node

/**
 * generate-icons.mjs
 *
 * Renders build/icon.svg into build/icon.ico, the Windows icon used by Relay.exe,
 * the installer, and the recovery launcher. Each frame is rasterized directly at
 * its size so small shell icons stay sharp.
 *
 * Requirements: sharp, png-to-ico (devDependencies)
 * Usage: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svgBuffer = readFileSync(join(buildDir, 'icon.svg'));
const SOURCE_SIZE = 1024;

// 100–200% scaling of the 16/24/32/48 px shell slots plus the 256 px jumbo view.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

function renderPng(size) {
  return sharp(svgBuffer, { density: (72 * size) / SOURCE_SIZE })
    .resize(size, size)
    .png()
    .toBuffer();
}

try {
  const frames = await Promise.all(ICO_SIZES.map(renderPng));
  writeFileSync(join(buildDir, 'icon.ico'), await pngToIco(frames));
  console.log(`build/icon.ico (${ICO_SIZES.join(', ')} px)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
