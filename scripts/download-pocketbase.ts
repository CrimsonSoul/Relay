import { execSync } from 'child_process';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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
  console.log(`Downloading PocketBase ${PB_VERSION} for ${os}/${arch}...`);
  console.log(`URL: ${url}`);

  execSync(`curl -L "${url}" -o "${join(RESOURCES_DIR, 'pb.zip')}"`);
  execSync(`unzip -o "${join(RESOURCES_DIR, 'pb.zip')}" -d "${RESOURCES_DIR}"`);
  unlinkSync(join(RESOURCES_DIR, 'pb.zip'));

  if (ext === '') {
    execSync(`chmod +x "${outputPath}"`);
  }

  console.log(`PocketBase binary saved to ${outputPath}`);
}

download().catch((err) => {
  console.error('Failed to download PocketBase:', err);
  process.exit(1);
});
