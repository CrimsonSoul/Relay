import { join } from 'node:path';

type BinaryPathOptions = {
  isPackaged: boolean;
  appRoot: string;
  resourcesPath: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
};

export function getPocketBaseBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
}

export function getPocketBaseResourceKey(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  return `${platform}-${arch}`;
}

export function getPocketBaseBinaryPath({
  isPackaged,
  appRoot,
  resourcesPath,
  platform,
  arch,
}: BinaryPathOptions): string {
  const root = isPackaged ? resourcesPath : join(appRoot, 'resources');
  return join(
    root,
    'pocketbase',
    getPocketBaseResourceKey(platform, arch),
    getPocketBaseBinaryName(platform),
  );
}
