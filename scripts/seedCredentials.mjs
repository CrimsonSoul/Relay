import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Own a fresh principal before authentication, so failed auth still has cleanup. */
export function createSeedCredentials({ binaryPath, dataDir, run = execFileSync }) {
  const identity = `relay-seed-${randomUUID()}@relay.local`;
  const password = `relay-seed-${randomUUID()}-Passphrase`;
  run(binaryPath, ['superuser', 'create', identity, password, `--dir=${dataDir}`], {
    stdio: 'pipe',
  });
  let removed = false;
  return {
    identity,
    password,
    cleanup() {
      if (removed) return;
      try {
        run(binaryPath, ['superuser', 'delete', identity, `--dir=${dataDir}`], { stdio: 'pipe' });
        removed = true;
      } catch {
        throw new Error(
          'Temporary seed superuser cleanup failed; remove the seed account before reusing the disposable database.',
        );
      }
    },
  };
}
