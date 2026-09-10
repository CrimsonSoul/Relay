import { utilityProcess } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A private disposable data restore. Never invokes PocketBase or archived code. */
export async function prepareVerifiedBackupArchive(
  archive: string,
  dataDir: string,
  options: { timeoutMs?: number; processPath?: string } = {},
): Promise<string> {
  const destination = await mkdtemp(join(dataDir, '.relay-backup-verify-'));
  let verified = false;
  let child: Electron.UtilityProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let exited = false;
  let exit: Promise<void> | undefined;
  try {
    // Utility processes work with the packaged RunAsNode fuse disabled.
    child = utilityProcess.fork(
      options.processPath ??
        join(dirname(fileURLToPath(import.meta.url)), 'backupVerificationProcess.js'),
      [archive, destination],
      { stdio: 'ignore', serviceName: 'Relay backup verification' },
    );
    exit = new Promise<void>((resolve) =>
      child!.once('exit', () => {
        exited = true;
        resolve();
      }),
    );
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Disposable verification timed out')),
        options.timeoutMs ?? 120_000,
      );
      child!.once('message', (message: unknown) => {
        if (message === 'verified') resolve();
        else reject(new Error('Disposable verification failed: archive is not readable'));
      });
      child!.once('error', () => reject(new Error('Disposable verification process failed')));
      child!.once('exit', () => reject(new Error('Disposable verification process exited')));
    });
    verified = true;
  } finally {
    clearTimeout(timer);
    if (child && !exited) {
      const terminate = (): void => {
        if (child?.pid && !exited) {
          // utilityProcess.kill() uses graceful SIGTERM on POSIX. SIGKILL also
          // interrupts synchronous native SQLite; never wait for its query to return.
          try {
            process.kill(child.pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
      };
      child.once('spawn', terminate);
      terminate();
    }
    // Do not remove files until the OS confirms the native process has exited.
    await exit;
    if (!verified) await rm(destination, { recursive: true, force: true });
  }
  return destination;
}

/** Verify and discard a private extraction after its worker has exited. */
export async function verifyBackupArchive(
  archive: string,
  dataDir: string,
  options: { timeoutMs?: number; processPath?: string } = {},
): Promise<void> {
  const destination = await prepareVerifiedBackupArchive(archive, dataDir, options);
  await rm(destination, { recursive: true, force: true });
}
