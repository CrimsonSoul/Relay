import { execSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PB_VERSION = '0.25.9';
const RESOURCES_DIR = join(__dirname, '..', 'resources', 'pocketbase');

function getPlatformArch(): { os: string; arch: string; ext: string } {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return { os: 'windows', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '.exe' };
  }
  if (platform === 'darwin') {
    return { os: 'darwin', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '' };
  }
  return { os: 'linux', arch: arch === 'arm64' ? 'arm64' : 'amd64', ext: '' };
}

/** Download a file following redirects (works on all platforms without curl). */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    function doRequest(requestUrl: string): void {
      client
        .get(requestUrl, (res) => {
          // Follow redirects (GitHub uses 302)
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            doRequest(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          file.close();
          reject(err);
        });
    }

    doRequest(url);
  });
}

/** Extract a zip file (cross-platform). */
function extractZip(zipPath: string, destDir: string): void {
  if (process.platform === 'win32') {
    // PowerShell is available on all modern Windows
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
  }
}

async function download(): Promise<void> {
  const { os, arch, ext } = getPlatformArch();
  const binaryName = `pocketbase${ext}`;
  const outputPath = join(RESOURCES_DIR, binaryName);

  if (existsSync(outputPath)) {
    console.log(`PocketBase binary already exists at ${outputPath}`);
    return;
  }

  mkdirSync(RESOURCES_DIR, { recursive: true });

  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${os}_${arch}.zip`;
  const zipPath = join(RESOURCES_DIR, 'pb.zip');

  console.log(`Downloading PocketBase ${PB_VERSION} for ${os}/${arch}...`);
  console.log(`URL: ${url}`);

  await downloadFile(url, zipPath);
  extractZip(zipPath, RESOURCES_DIR);
  unlinkSync(zipPath);

  if (ext === '') {
    execSync(`chmod +x "${outputPath}"`);
  }

  console.log(`PocketBase binary saved to ${outputPath}`);
}

download().catch((err) => {
  console.error('Failed to download PocketBase:', err);
  process.exit(1);
});
