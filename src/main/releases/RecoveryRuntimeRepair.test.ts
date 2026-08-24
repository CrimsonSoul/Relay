import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryBuildRecord } from './RecoveryCatalog';
import {
  parseRecoveryRepairRequest,
  serializeRecoveryRepairReceipt,
} from './RecoveryRepairRequest';
import { repairRecoveryRuntime } from './RecoveryRuntimeRepair';
import type { RelayInstallableRelease } from './ReleaseUpdateService';

const TRANSACTION_ID = '11111111-2222-4333-8444-555555555555';
const INSTALLER = Buffer.from([0x4d, 0x5a, 0x01, 0x02]);
const INSTALLER_SHA256 = createHash('sha256').update(INSTALLER).digest('hex');
const ARCHIVE_SHA256 = 'a'.repeat(64);

let relayRoot: string;
let source: RecoveryBuildRecord;
let target: RecoveryBuildRecord;
let release: RelayInstallableRelease;

function build(buildId: string, version: string, commit: string): RecoveryBuildRecord {
  return {
    buildId,
    version,
    releaseTag: `v${version}`,
    targetCommitish: commit,
    runtimeSha512: 'b'.repeat(128),
    installerSha256: INSTALLER_SHA256,
    recoveryProtocol: 2,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: '2026-08-24T15:00:00.000Z',
    health: 'healthy',
    rollbackSnapshotId: null,
  };
}

beforeEach(async () => {
  relayRoot = await mkdtemp(join(tmpdir(), 'relay-runtime-repair-'));
  await mkdir(join(relayRoot, 'Runtime'));
  source = build(`r2-${'1'.repeat(40)}`, '1.6.0', '1'.repeat(40));
  target = build(`r2-${'2'.repeat(40)}`, '1.5.0', '2'.repeat(40));
  release = {
    version: target.version,
    targetCommitish: target.targetCommitish,
    archive: {
      id: 10,
      name: 'relay-win-x64.zip',
      apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/10',
      size: 20,
      sha256: ARCHIVE_SHA256,
    },
    checksum: {
      id: 11,
      name: 'relay-win-x64.zip.sha256',
      apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/11',
      size: 88,
      sha256: 'c'.repeat(64),
    },
  };
});

afterEach(async () => {
  await rm(relayRoot, { recursive: true, force: true });
});

function options(receiptOverride: Record<string, string> = {}) {
  const resolveInstallableByTag = vi.fn(async () => release);
  const downloadAsset = vi.fn(async (asset, destination) => {
    if (asset.name.endsWith('.sha256')) {
      await writeFile(destination, `${ARCHIVE_SHA256}  ${release.archive.name}\n`);
    } else {
      await writeFile(destination, Buffer.alloc(asset.size));
    }
    return { bytes: asset.size, sha256: asset.sha256 };
  });
  const extractInstaller = vi.fn(async (_archivePath, destinationPath) => {
    await writeFile(destinationPath, INSTALLER);
    return { bytes: INSTALLER.byteLength, sha256: INSTALLER_SHA256 };
  });
  const spawnInstaller = vi.fn(async (_path: string, args: string[]) => {
    const request = parseRecoveryRepairRequest(
      await readFile(join(relayRoot, 'Recovery', 'repair-request.ini'), 'utf8'),
    );
    if (!request) throw new Error('missing request');
    await writeFile(
      join(relayRoot, 'Recovery', 'repair-result.ini'),
      serializeRecoveryRepairReceipt({
        protocol: 2,
        transactionId: receiptOverride.transactionId ?? request.transactionId,
        buildId: receiptOverride.buildId ?? request.targetBuildId,
        version: receiptOverride.version ?? request.targetVersion,
        targetCommitish: receiptOverride.targetCommitish ?? request.targetCommitish,
        runtimeSha512: target.runtimeSha512,
        installerSha256: request.targetInstallerSha256,
        completedAt: '2026-08-24T15:11:00.000Z',
      }),
    );
    expect(args).toEqual(['/relay-repair-only', `/relay-transaction=${TRANSACTION_ID}`]);
    return 0;
  });
  return {
    resolveInstallableByTag,
    downloadAsset,
    extractInstaller,
    spawnInstaller,
    createPrivateDirectory: (path: string) => mkdir(path, { mode: 0o700 }),
    now: () => new Date('2026-08-24T15:10:00.000Z'),
    randomUuid: () => TRANSACTION_ID,
  };
}

describe('repairRecoveryRuntime', () => {
  it('downloads an immutable exact tag, binds the installer to a request, and verifies its receipt', async () => {
    const dependencies = options();

    await expect(
      repairRecoveryRuntime({ relayRoot, sourceBuild: source, targetBuild: target }, dependencies),
    ).resolves.toBe(true);

    expect(dependencies.resolveInstallableByTag).toHaveBeenCalledWith(
      target.version,
      target.targetCommitish,
    );
    expect(dependencies.spawnInstaller).toHaveBeenCalledOnce();
    expect(existsSync(join(relayRoot, 'Recovery', 'repair-request.ini'))).toBe(false);
    expect(existsSync(join(relayRoot, 'Recovery', 'repair-result.ini'))).toBe(false);
    expect(await readdir(join(relayRoot, 'Updates'))).toEqual([]);
  });

  it('refuses a release whose exact version or commit drifts before any download', async () => {
    const dependencies = options();
    dependencies.resolveInstallableByTag.mockResolvedValue({
      ...release,
      targetCommitish: '3'.repeat(40),
    });

    await expect(
      repairRecoveryRuntime({ relayRoot, sourceBuild: source, targetBuild: target }, dependencies),
    ).rejects.toThrow(/identity/i);
    expect(dependencies.downloadAsset).not.toHaveBeenCalled();
    expect(dependencies.spawnInstaller).not.toHaveBeenCalled();
  });

  it('refuses a changed installer or mismatched native receipt', async () => {
    const changedInstaller = options();
    target.installerSha256 = 'f'.repeat(64);
    await expect(
      repairRecoveryRuntime(
        { relayRoot, sourceBuild: source, targetBuild: target },
        changedInstaller,
      ),
    ).rejects.toThrow(/installer/i);
    expect(changedInstaller.spawnInstaller).not.toHaveBeenCalled();

    target.installerSha256 = INSTALLER_SHA256;
    const mismatchedReceipt = options({ buildId: `r2-${'3'.repeat(40)}` });
    await expect(
      repairRecoveryRuntime(
        { relayRoot, sourceBuild: source, targetBuild: target },
        mismatchedReceipt,
      ),
    ).rejects.toThrow(/receipt/i);
    expect(basename(mismatchedReceipt.spawnInstaller.mock.calls[0]![0])).toBe('Relay.exe');
  });
});
