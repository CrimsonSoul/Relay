import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReleaseUpdateManager } from '../releases/ReleaseUpdateManager';
import { createWindowsPrivateDirectory } from './WindowsPrivateDirectory';

type WindowsAclRule = Readonly<{
  identity: string;
  accessControlType: string;
  fileSystemRights: string;
  inheritanceFlags: string;
  propagationFlags: string;
  isInherited: boolean;
}>;

type WindowsAclSnapshot = Readonly<{
  currentUserSid: string;
  directory: {
    areAccessRulesProtected: boolean;
    rules: WindowsAclRule[];
  };
  file: {
    areAccessRulesProtected: boolean;
    rules: WindowsAclRule[];
  };
}>;

function inspectWindowsAcls(directoryPath: string, filePath: string): WindowsAclSnapshot {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (!systemRoot) throw new Error('Windows system root is unavailable');

  const encodedDirectoryPath = Buffer.from(directoryPath, 'utf8').toString('base64');
  const encodedFilePath = Buffer.from(filePath, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$directoryPath = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String('${encodedDirectoryPath}')
)
$filePath = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String('${encodedFilePath}')
)

function Get-AccessRules(
  [Security.AccessControl.FileSystemSecurity]$security
) {
  return @(
    $security.GetAccessRules(
      $true,
      $true,
      [Security.Principal.SecurityIdentifier]
    ) | ForEach-Object {
      [PSCustomObject]@{
        identity = $_.IdentityReference.Value
        accessControlType = $_.AccessControlType.ToString()
        fileSystemRights = $_.FileSystemRights.ToString()
        inheritanceFlags = $_.InheritanceFlags.ToString()
        propagationFlags = $_.PropagationFlags.ToString()
        isInherited = $_.IsInherited
      }
    }
  )
}

$directory = [IO.DirectoryInfo]::new($directoryPath)
$directorySecurity = $directory.GetAccessControl(
  [Security.AccessControl.AccessControlSections]::Access
)
$file = [IO.FileInfo]::new($filePath)
$fileSecurity = $file.GetAccessControl(
  [Security.AccessControl.AccessControlSections]::Access
)

[PSCustomObject]@{
  currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  directory = [PSCustomObject]@{
    areAccessRulesProtected = $directorySecurity.AreAccessRulesProtected
    rules = @(Get-AccessRules $directorySecurity)
  }
  file = [PSCustomObject]@{
    areAccessRulesProtected = $fileSecurity.AreAccessRulesProtected
    rules = @(Get-AccessRules $fileSecurity)
  }
} | ConvertTo-Json -Compress -Depth 5
`.trim();

  const output = execFileSync(
    win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  return JSON.parse(output.trim()) as WindowsAclSnapshot;
}

function expectPrivateWindowsAcl(acl: WindowsAclSnapshot): void {
  const compareSids = (left: string, right: string): number => left.localeCompare(right);
  const expectedSids = [acl.currentUserSid, 'S-1-5-18'].sort(compareSids);

  expect(acl.directory.areAccessRulesProtected).toBe(true);
  expect(acl.directory.rules.map((rule) => rule.identity).sort(compareSids)).toEqual(expectedSids);
  for (const rule of acl.directory.rules) {
    expect(rule).toMatchObject({
      accessControlType: 'Allow',
      fileSystemRights: 'FullControl',
      isInherited: false,
      propagationFlags: 'None',
    });
    expect(rule.inheritanceFlags).toContain('ContainerInherit');
    expect(rule.inheritanceFlags).toContain('ObjectInherit');
  }

  expect(acl.file.areAccessRulesProtected).toBe(false);
  expect(acl.file.rules.map((rule) => rule.identity).sort(compareSids)).toEqual(expectedSids);
  for (const rule of acl.file.rules) {
    expect(rule).toMatchObject({
      accessControlType: 'Allow',
      fileSystemRights: 'FullControl',
      isInherited: true,
      propagationFlags: 'None',
    });
  }
}

describe.runIf(process.platform === 'win32')('Windows private directory integration', () => {
  it('limits the protected directory and inherited file DACLs to the user and LocalSystem', () => {
    const parent = mkdtempSync(join(tmpdir(), 'relay-private-directory-'));
    const target = join(parent, 'repair');
    const inheritedFile = join(target, 'secret');
    try {
      createWindowsPrivateDirectory(target);
      writeFileSync(inheritedFile, 'test secret', { flag: 'wx' });

      const acl = inspectWindowsAcls(target, inheritedFile);
      expectPrivateWindowsAcl(acl);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('applies the protected DACL to updater staging and its extracted executable', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'relay-update-private-directory-'));
    const localAppData = join(parent, 'LocalAppData');
    const relayRoot = join(localAppData, 'Relay');
    const runtimeDirectory = join(relayRoot, 'Runtime', 'r1-currentbuild');
    const execPath = join(runtimeDirectory, 'Relay.exe');
    const archiveName = 'Relay-v1.1.0-windows-x64.zip';
    const archiveSha256 = 'a'.repeat(64);
    const checksumSha256 = 'b'.repeat(64);
    const installer = Buffer.from('MZverified updater payload');
    const installerSha256 = createHash('sha256').update(installer).digest('hex');
    let installerPath = '';

    try {
      mkdirSync(runtimeDirectory, { recursive: true });
      writeFileSync(execPath, 'MZcurrent runtime');
      writeFileSync(join(relayRoot, 'Relay.exe'), 'MZstable launcher');
      const updates = new ReleaseUpdateManager({
        service: {
          resolveLatestInstallable: async () => ({
            version: '1.1.0',
            targetCommitish: '0123456789abcdef0123456789abcdef01234567',
            archive: {
              id: 10,
              name: archiveName,
              apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/10',
              size: 140_000_000,
              sha256: archiveSha256,
            },
            checksum: {
              id: 11,
              name: `${archiveName}.sha256`,
              apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/11',
              size: 95,
              sha256: checksumSha256,
            },
          }),
        },
        getCurrentVersion: () => '1.0.0',
        platform: 'win32',
        arch: 'x64',
        isPackaged: true,
        localAppData,
        execPath,
        downloadAsset: async (asset, destination, options) => {
          if (asset.name.endsWith('.sha256')) {
            writeFileSync(destination, `${archiveSha256}  ${archiveName}\n`);
          } else {
            writeFileSync(destination, 'archive bytes');
            options.onProgress?.(asset.size, asset.size);
          }
          return { bytes: asset.size, sha256: asset.sha256 };
        },
        extractInstaller: async (_archivePath, destination) => {
          installerPath = destination;
          writeFileSync(destination, installer);
          return { bytes: installer.byteLength, sha256: installerSha256 };
        },
      });

      await updates.noteCheck({
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
        installable: true,
        assetSizeBytes: 140_000_000,
      });
      await expect(updates.download()).resolves.toMatchObject({ phase: 'downloaded' });

      expectPrivateWindowsAcl(inspectWindowsAcls(dirname(installerPath), installerPath));
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
