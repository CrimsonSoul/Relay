import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A private disposable data restore. Never invokes PocketBase or archived code. */
export async function verifyBackupArchive(
  archive: string,
  dataDir: string,
  options: { timeoutMs?: number; workerPath?: string } = {},
): Promise<void> {
  const destination = await mkdtemp(join(dataDir, '.relay-backup-verify-'));
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(
      options.workerPath ??
        join(dirname(fileURLToPath(import.meta.url)), 'backupVerificationWorker.js'),
      {
        workerData: { archive, destination },
      },
    );
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Disposable verification timed out')),
        options.timeoutMs ?? 120_000,
      );
      worker!.once('message', (message: unknown) => {
        if (message === 'verified') resolve();
        else reject(new Error('Disposable verification failed: archive is not readable'));
      });
      worker!.once('error', () => reject(new Error('Disposable verification worker failed')));
      worker!.once('exit', () => reject(new Error('Disposable verification worker exited')));
    });
  } finally {
    clearTimeout(timer);
    // SQLite may still be executing when the deadline expires. Await termination first.
    if (worker) await worker.terminate();
    await rm(destination, { recursive: true, force: true });
  }
}
