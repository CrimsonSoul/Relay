export type RecoveryLaunchIntent = 'recovery';

const RECOVERY_CENTER_ARGUMENT = '--relay-recovery-center';

export function parseRecoveryLaunchIntent(
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
  isPackaged = false,
): RecoveryLaunchIntent | null {
  if (platform !== 'win32' || !isPackaged) return null;
  const matches = argv.filter((argument) => argument === RECOVERY_CENTER_ARGUMENT);
  return matches.length === 1 ? 'recovery' : null;
}
