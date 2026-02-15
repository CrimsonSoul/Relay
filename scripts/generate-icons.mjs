#!/usr/bin/env node

/**
 * generate-icons.mjs
 *
 * Generates all app icon formats from build/icon.svg:
 *   - build/icon.png (512×512)
 *   - build/icon256.png (256×256)
 *   - build/icon.ico (multi-res, for Windows)
 *   - build/icon.icns (via iconutil, for macOS)
 *
 * Requirements: sharp, png-to-ico (devDependencies)
 * Usage: node scripts/generate-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const svgPath = join(buildDir, 'icon.svg');
const svgBuffer = readFileSync(svgPath);

// All sizes needed across platforms
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

async function generateIcns() {
  console.log('Generating ICNS...');

  const iconsetDir = join(buildDir, 'icon.iconset');
  mkdirSync(iconsetDir, { recursive: true });

  // macOS iconset naming convention
  const iconsetFiles = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 },
  ];

  await Promise.all(
    iconsetFiles.map(async ({ name, size }) => {
      const buf = await renderPng(size);
      writeFileSync(join(iconsetDir, name), buf);
    }),
  );

  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${join(buildDir, 'icon.icns')}"`, {
      stdio: 'pipe',
    });
    console.log('  icon.icns');
  } catch (err) {
    console.error('  Failed to generate ICNS (iconutil not available?):', err.message);
  }

  // Clean up iconset folder
  rmSync(iconsetDir, { recursive: true, force: true });
}

async function main() {
  console.log('=== Relay Icon Generator ===\n');
  console.log(`Source: ${svgPath}\n`);

  await generatePngs();
  await generateIco();
  await generateIcns();

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
