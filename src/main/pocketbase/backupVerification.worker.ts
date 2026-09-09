import { parentPort, workerData } from 'node:worker_threads';
import { restoreAndCheckArchive } from './backupVerificationCore';
const { archive, destination } = workerData as { archive: string; destination: string };
void restoreAndCheckArchive(archive, destination).then(
  () => parentPort?.postMessage('verified'),
  () => parentPort?.postMessage('failed'),
);
