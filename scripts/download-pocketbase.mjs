import { execFileSync } from 'node:child_process';
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
const POSIX_CHMOD_PATH = '/bin/chmod';
const POSIX_UNZIP_PATH = '/usr/bin/unzip';
const WINDOWS_POWERSHELL_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function parseArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function toSupportedPlatform(value) {
  if (value === 'win32' || value === 'darwin' || value === 'linux') return value;
  throw new Error(`Unsupported PocketBase platform: ${value}`);
}

function toSupportedArch(value) {
  if (value === 'x64' || value === 'arm64') return value;
  throw new Error(`Unsupported PocketBase architecture: ${value}`);
}

function getPlatformArch() {
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

function getHttpClient(url) {
  const protocol = new URL(url).protocol;
  return protocol === 'https:' ? https : http;
}

function assertSecureDownloadUrl(url) {
  if (new URL(url).protocol !== 'https:') {
    throw new Error(`Refusing insecure PocketBase download URL: ${url}`);
  }
}

function resolveRedirect(location, requestUrl) {
  const redirectedUrl = new URL(location, requestUrl).toString();
  assertSecureDownloadUrl(redirectedUrl);
  return redirectedUrl;
}

function pipeResponseToFile(res, dest, resolve, reject) {
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

function requestDownload(requestUrl, dest, resolve, reject) {
  try {
    assertSecureDownloadUrl(requestUrl);
  } catch (error) {
    reject(error);
    return;
  }

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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => requestDownload(url, dest, resolve, reject));
}

function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync(WINDOWS_POWERSHELL_PATH, [
      '-NoProfile',
      '-Command',
      'Expand-Archive -Force -LiteralPath $args[0] -DestinationPath $args[1]',
      zipPath,
      destDir,
    ]);
  } else {
    execFileSync(POSIX_UNZIP_PATH, ['-o', zipPath, '-d', destDir]);
  }
}

function chmodExecutable(outputPath) {
  execFileSync(POSIX_CHMOD_PATH, ['+x', outputPath]);
}

export const __downloadTestHooks = {
  resolveRedirect,
};

export async function verifyChecksum(
  zipPath,
  expectedFilename,
  downloadChecksumFile = downloadFile,
) {
  const checksumUrl = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt`;
  const checksumPath = `${zipPath}.checksums.txt`;

  try {
    await downloadChecksumFile(checksumUrl, checksumPath);
  } catch (err) {
    throw new Error(`Checksums file not available for v${PB_VERSION}`, { cause: err });
  }

  try {
    const checksumFile = readFileSync(checksumPath, 'utf-8');
    const line = checksumFile.split('\n').find((l) => l.includes(expectedFilename));
    if (!line) {
      throw new Error(`Checksum for ${expectedFilename} not found in checksums file`);
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

export async function downloadPocketBase(options = {}) {
  const platformArch =
    options.platform || options.arch
      ? (() => {
          const platform = toSupportedPlatform(options.platform ?? process.platform);
          const arch = toSupportedArch(options.arch ?? process.arch);
          return {
            platform,
            arch,
            pbOs: platform === 'win32' ? 'windows' : platform,
            pbArch: arch === 'arm64' ? 'arm64' : 'amd64',
            ext: platform === 'win32' ? '.exe' : '',
          };
        })()
      : getPlatformArch();
  const { platform, arch, pbOs, pbArch, ext } = platformArch;
  const resourcesDir = options.resourcesDir ?? RESOURCES_DIR;
  const exists = options.exists ?? existsSync;
  const mkdir = options.mkdir ?? mkdirSync;
  const download = options.download ?? downloadFile;
  const verify = options.verify ?? verifyChecksum;
  const extract = options.extract ?? extractZip;
  const remove = options.remove ?? unlinkSync;
  const chmod = options.chmod ?? chmodExecutable;
  const log = options.log ?? console.log;

  const binaryName = `pocketbase${ext}`;
  const outputDir = join(resourcesDir, `${platform}-${arch}`);
  const outputPath = join(outputDir, binaryName);

  if (exists(outputPath)) {
    log(`PocketBase binary already exists at ${outputPath}; refreshing verified copy`);
  }

  mkdir(outputDir, { recursive: true });

  const zipFilename = `pocketbase_${PB_VERSION}_${pbOs}_${pbArch}.zip`;
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipFilename}`;
  const zipPath = join(outputDir, 'pb.zip');

  log(`Downloading PocketBase ${PB_VERSION} for ${platform}/${arch}...`);
  log(`URL: ${url}`);

  try {
    await download(url, zipPath);
    await verify(zipPath, zipFilename);
  } catch (err) {
    try {
      remove(zipPath);
    } catch {
      /* already gone */
    }
    throw err;
  }
  extract(zipPath, outputDir);
  remove(zipPath);

  if (ext === '') {
    chmod(outputPath);
  }

  log(`PocketBase binary saved to ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.RELAY_SKIP_POCKETBASE_DOWNLOAD === '1') {
    console.log('Skipping PocketBase download because RELAY_SKIP_POCKETBASE_DOWNLOAD=1');
    process.exit(0);
  }

  try {
    await downloadPocketBase();
  } catch (err) {
    console.error('Failed to download PocketBase:', err);
    process.exit(1);
  }
}
