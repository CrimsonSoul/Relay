import { basename, isAbsolute } from 'node:path';
import { restoreAndCheckArchive } from './backupVerificationCore';

const parent = process.parentPort;
if (!parent) throw new Error('Backup verification requires a private parent channel');
const request = await new Promise<unknown>((resolve) =>
  parent.once('message', (event) => resolve(event.data)),
);
try {
  if (
    !request ||
    typeof request !== 'object' ||
    !('archive' in request) ||
    !('destination' in request) ||
    typeof request.archive !== 'string' ||
    typeof request.destination !== 'string' ||
    !isAbsolute(request.archive) ||
    !isAbsolute(request.destination) ||
    !basename(request.destination).startsWith('.relay-backup-verify-')
  ) {
    throw new TypeError('Invalid disposable verification request');
  }
  await restoreAndCheckArchive(request.archive, request.destination);
  parent.postMessage('verified');
} catch {
  parent.postMessage('failed');
}
