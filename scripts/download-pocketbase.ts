import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PB_VERSION = '0.25.9';
const RESOURCES_DIR = join(__dirname, '..', 'resources', 'pocketbase');

type SupportedPlatform = 'win32' | 'darwin' | 'linux';
type SupportedArch = 'x64' | 'arm64';

type PlatformArch = {
  platform: SupportedPlatform;
  arch: SupportedArch;
  pbOs: 'windows' | 'darwin' | 'linux';
  pbArch: 'amd64' | 'arm64';
  ext: '.exe' | '';
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function toSupportedPlatform(value: string): SupportedPlatform {
  if (value === 'win32' || value === 'darwin' || value === 'linux') return value;
  throw new Error(`Unsupported PocketBase platform: ${value}`);
}

function toSupportedArch(value: string): SupportedArch {
  if (value === 'x64' || value === 'arm64') return value;
  throw new Error(`Unsupported PocketBase architecture: ${value}`);
}

function getPlatformArch(): PlatformArch {
  const platform = toSupportedPlatform(parseArg('platform') ?? process.platform);
  const arch = toSupportedArch(parseArg('arch') ?? process.arch);

  return {
    platform,
    arch,
    pbOs: platform === 'win32' ? 'windows' : platform,
    pbArch: arch === 'arm64' ? 'arm64' : 'amd64',
    ext: platform === 'win32' ? '.exe' : '',
  };
}

type HttpClient = typeof https | typeof http;

function getHttpClient(url: string): HttpClient {
  return url.startsWith('https') ? https : http;
}

function resolveRedirect(location: string, requestUrl: string): string {
  return new URL(location, requestUrl).toString();
}

function pipeResponseToFile(
  res: http.IncomingMessage,
  dest: string,
  resolve: () => void,
  reject: (reason?: unknown) => void,
): void {
  const file = createWriteStream(dest);
  res.pipe(file);
  file.on('finish', () => {
    file.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  file.on('error', (err) => {
    file.close();
    reject(err);
  });
}

function requestDownload(
  requestUrl: string,
  dest: string,
  resolve: () => void,
  reject: (reason?: unknown) => void,
): void {
  getHttpClient(requestUrl)
    .get(requestUrl, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        requestDownload(resolveRedirect(res.headers.location, requestUrl), dest, resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }
      pipeResponseToFile(res, dest, resolve, reject);
    })
    .on('error', reject);
}

/** Download a file following redirects (works on all platforms without curl). */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => requestDownload(url, dest, resolve, reject));
}

/** Extract a zip file (cross-platform). */
function extractZip(zipPath: string, destDir: string): void {
  if (process.platform === 'win32') {
    // PowerShell is available on all modern Windows.
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'"`,
    );
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
  }
}

/** Download the SHA256 checksums file and verify a local file against it. */
async function verifyChecksum(zipPath: string, expectedFilename: string): Promise<void> {
  const checksumUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_checksums.txt`;
  const checksumPath = `${zipPath}.checksums.txt`;

  try {
    await downloadFile(checksumUrl, checksumPath);
  } catch {
    // Some PocketBase versions don't publish a checksums file, so skip verification.
    console.warn(`Checksums file not available for v${PB_VERSION} - skipping verification`);
    return;
  }

  try {
    const checksumFile = readFileSync(checksumPath, 'utf-8');
    const line = checksumFile.split('\n').find((l) => l.includes(expectedFilename));
    if (!line) {
      console.warn(
        `Checksum for ${expectedFilename} not found in checksums file - skipping verification`,
      );
      return;
    }

    const expectedHash = line.trim().split(/\s+/)[0];
    const fileBuffer = readFileSync(zipPath);
    const actualHash = createHash('sha256').update(fileBuffer).digest('hex');

    if (actualHash !== expectedHash) {
      unlinkSync(zipPath);
      throw new Error(
        `Checksum mismatch for ${expectedFilename}!\n  Expected: ${expectedHash}\n  Actual:   ${actualHash}`,
      );
    }

    console.log(`Checksum verified: ${actualHash}`);
    unlinkSync(checksumPath);
  } catch (err) {
    try {
      unlinkSync(checksumPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function download(): Promise<void> {
  const { platform, arch, pbOs, pbArch, ext } = getPlatformArch();
  const binaryName = `pocketbase${ext}`;
  const outputDir = join(RESOURCES_DIR, `${platform}-${arch}`);
  const outputPath = join(outputDir, binaryName);

  if (existsSync(outputPath)) {
    console.log(`PocketBase binary already exists at ${outputPath}`);
    return;
  }

  mkdirSync(outputDir, { recursive: true });

  const zipFilename = `pocketbase_${PB_VERSION}_${pbOs}_${pbArch}.zip`;
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipFilename}`;
  const zipPath = join(outputDir, 'pb.zip');

  console.log(`Downloading PocketBase ${PB_VERSION} for ${platform}/${arch}...`);
  console.log(`URL: ${url}`);

  try {
    await downloadFile(url, zipPath);
    await verifyChecksum(zipPath, zipFilename);
  } catch (err) {
    try {
      unlinkSync(zipPath);
    } catch {
      /* already gone */
    }
    throw err;
  }
  extractZip(zipPath, outputDir);
  unlinkSync(zipPath);

  if (ext === '') {
    execSync(`chmod +x "${outputPath}"`);
  }

  console.log(`PocketBase binary saved to ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await download();
  } catch (err) {
    console.error('Failed to download PocketBase:', err);
    process.exit(1);
  }
}
