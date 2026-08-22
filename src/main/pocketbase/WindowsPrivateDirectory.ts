import { execFileSync } from 'node:child_process';
import { win32 } from 'node:path';

const WINDOWS_PRIVATE_DIRECTORY_TIMEOUT_MS = 5_000;

function getWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (
    !systemRoot ||
    systemRoot.includes('\0') ||
    !win32.isAbsolute(systemRoot) ||
    win32.basename(systemRoot).length === 0
  ) {
    throw new Error('Windows system root is unavailable');
  }
  return win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function buildPrivateDirectoryAclCommand(directoryPath: string): string {
  const encodedPath = Buffer.from(directoryPath, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $repairPath = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('${encodedPath}')
  )
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $allowedSids = @($currentSid.Value, $systemSid.Value)
  $rights = [Security.AccessControl.FileSystemRights]::FullControl
  $inheritance = (
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
  )
  $propagation = [Security.AccessControl.PropagationFlags]::None
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentSid, $systemSid)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      $rights,
      $inheritance,
      $propagation,
      $allow
    )
    [void]$security.AddAccessRule($rule)
  }

  $directory = [IO.DirectoryInfo]::new($repairPath)
  [void]$directory.Create($security)
  $actual = $directory.GetAccessControl(
    [Security.AccessControl.AccessControlSections]::Access
  )
  if (-not $actual.AreAccessRulesProtected) {
    throw 'Private directory inherits access rules'
  }

  $currentRule = $false
  $systemRule = $false
  $rules = @(
    $actual.GetAccessRules(
      $true,
      $true,
      [Security.Principal.SecurityIdentifier]
    )
  )
  foreach ($rule in $rules) {
    $sid = $rule.IdentityReference.Value
    if (
      $rule.IsInherited -or
      $rule.AccessControlType -ne $allow -or
      $allowedSids -notcontains $sid -or
      ($rule.FileSystemRights -band $rights) -ne $rights -or
      ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ContainerInherit) -eq 0 -or
      ($rule.InheritanceFlags -band [Security.AccessControl.InheritanceFlags]::ObjectInherit) -eq 0
    ) {
      throw 'Private directory access rules are invalid'
    }
    if ($sid -eq $currentSid.Value) { $currentRule = $true }
    if ($sid -eq $systemSid.Value) { $systemRule = $true }
  }
  if (-not $currentRule -or -not $systemRule) {
    throw 'Private directory access rules are incomplete'
  }
  if (@($directory.GetFileSystemInfos()).Count -ne 0) {
    throw 'Private directory is not empty'
  }
  exit 0
} catch {
  exit 1
}
`.trim();
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function createWindowsPrivateDirectory(directoryPath: string): void {
  execFileSync(
    getWindowsPowerShellPath(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      buildPrivateDirectoryAclCommand(directoryPath),
    ],
    {
      timeout: WINDOWS_PRIVATE_DIRECTORY_TIMEOUT_MS,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
}
