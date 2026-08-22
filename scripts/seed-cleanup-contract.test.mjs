import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSource = readFileSync(resolve(process.cwd(), 'scripts/seed.mjs'), 'utf8');

describe('seed script cleanup contract', () => {
  it('never calls process.exit, which would skip the superuser cleanup in finally', () => {
    // process.exit() terminates before pending finally blocks run, stranding the
    // temporary seed superuser (a privileged account) inside PocketBase.
    expect(seedSource).not.toMatch(/\bprocess\.exit\s*\(/u);
    expect(seedSource).toMatch(/process\.exitCode\s*=\s*1/u);
  });

  it('always awaits the temporary superuser cleanup', () => {
    expect(seedSource).toMatch(/\}\s*finally\s*\{\s*await cleanupSeedSuperuser\(\);\s*\}/u);
  });

  it('fails the run when any record could not be created', () => {
    expect(seedSource).toMatch(/failedRecords\.push\(/u);
    expect(seedSource).toMatch(/if \(failedRecords\.length > 0\) \{\s*throw new Error\(/u);
  });

  it('cannot loop forever when records refuse to delete', () => {
    expect(seedSource).toMatch(/if \(deletedThisPass === 0\) \{\s*throw new Error\(/u);
  });

  it('surfaces a failed record listing instead of reporting an empty collection', () => {
    expect(seedSource).toMatch(
      /if \(!res\.ok\) \{\s*throw new Error\(`Could not list \$\{collection\}/u,
    );
  });
});
