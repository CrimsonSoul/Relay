#!/usr/bin/env node

/**
 * generate-icons.mjs
 *
 * Generates Windows app icon formats from build/icon.svg:
 *   - build/icon.png (512×512)
 *   - build/icon256.png (256×256)
 *   - build/icon.ico (multi-res, for Windows)
 *
 * Requirements: sharp, png-to-ico (devDependencies)
 * Usage: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const svgPath = join(buildDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

// All sizes needed by the Windows ICO.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(size) {
  return sharp(svgBuffer, { density: Math.round((72 * size) / 512) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function generatePngs() {
  console.log('Generating PNGs...');

  const png512 = await renderPng(512);
  writeFileSync(join(buildDir, 'icon.png'), png512);
  console.log('  icon.png (512×512)');

  const png256 = await renderPng(256);
  writeFileSync(join(buildDir, 'icon256.png'), png256);
  console.log('  icon256.png (256×256)');

  return { png512, png256 };
}

async function generateIco() {
  console.log('Generating ICO...');

  const pngBuffers = await Promise.all(ICO_SIZES.map((size) => renderPng(size)));

  const icoBuffer = await pngToIco(pngBuffers);
  writeFileSync(join(buildDir, 'icon.ico'), icoBuffer);
  console.log(`  icon.ico (${ICO_SIZES.join(', ')}px)`);
}

async function main() {
  console.log('=== Relay Icon Generator ===\n');
  console.log(`Source: ${svgPath}\n`);

  await generatePngs();
  await generateIco();

  console.log('\nDone!');
}

try {
  await main();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
