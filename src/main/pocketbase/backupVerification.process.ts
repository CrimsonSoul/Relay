import { restoreAndCheckArchive } from './backupVerificationCore';
const archive = process.argv[2];
const destination = process.argv[3];
if (!archive || !destination) throw new Error('Missing disposable verification paths');
void restoreAndCheckArchive(archive, destination).then(
  () => process.parentPort.postMessage('verified'),
  () => process.parentPort.postMessage('failed'),
);
