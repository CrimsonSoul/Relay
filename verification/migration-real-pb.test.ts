import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCollections } from '../src/main/pocketbase/CollectionBootstrap';

/**
 * Exercises collection bootstrap and the legacy upgrade against a REAL
 * PocketBase server.
 *
 * The unit suite covers this path with a hand-written fake, and that fake is
 * what let a defect through where the post-migration patch re-sent
 * already-created fields without the ids PocketBase had assigned. Only a real
 * server settles whether the fix holds, because the bug lived entirely in how
 * PocketBase merges a fields[] payload by id.
 */

const BINARY = join(
  process.cwd(),
  'resources',
  'pocketbase',
  process.platform === 'darwin' ? 'darwin-arm64' : 'win32-x64',
  process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase',
);
const HOOKS_DIR = join(process.cwd(), 'resources', 'pocketbase', 'hooks');
const SUPERUSER = 'verify@relay.test';
const PASSWORD = 'verify-password-1234';

type Server = { pb: PocketBase; stop: () => void };
const running: Server[] = [];
let nextPort = 41100;

async function waitForHealth(target: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`${target}/api/health`)).ok) return;
    } catch {
      // still binding
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PocketBase did not become healthy');
}

/** A fresh server + data directory per test, so no test inherits schema. */
async function startServer(): Promise<Server> {
  // Each server gets its OWN parent directory. PocketBase's default
  // migrationsDir is <dataDir>/../pb_migrations, so data dirs placed directly
  // in $TMPDIR share one auto-generated migration set — and a later run then
  // replays schema changes written by an earlier one against a fresh database.
  const root = mkdtempSync(join(tmpdir(), 'relay-verify-'));
  const dataDir = join(root, 'pb_data');
  const migrationsDir = join(root, 'pb_migrations');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  const port = nextPort++;
  const url = `http://127.0.0.1:${port}`;

  const created = spawnSync(
    BINARY,
    ['superuser', 'upsert', SUPERUSER, PASSWORD, '--dir', dataDir],
    {
      encoding: 'utf8',
    },
  );
  if (created.status !== 0) throw new Error(`superuser upsert failed: ${created.stderr}`);

  const child: ChildProcess = spawn(
    BINARY,
    [
      'serve',
      '--http',
      `127.0.0.1:${port}`,
      '--dir',
      dataDir,
      '--migrationsDir',
      migrationsDir,
      '--hooksDir',
      HOOKS_DIR,
    ],
    { stdio: 'ignore' },
  );
  await waitForHealth(url);

  const pb = new PocketBase(url);
  await pb.collection('_superusers').authWithPassword(SUPERUSER, PASSWORD);

  const server: Server = {
    pb,
    stop: () => {
      child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    },
  };
  running.push(server);
  return server;
}

afterEach(() => {
  while (running.length > 0) running.pop()?.stop();
});

/**
 * Reproduces the pre-upgrade database shape the migration actually expects: a
 * roster, plus one primary state row whose adminOperatorId designates the
 * owner. Each of those is a hard precondition — the migration refuses with a
 * distinct reason when any is missing.
 */
async function seedLegacyRoster(pb: PocketBase, displayNames: string[]): Promise<string> {
  await pb.collections.create({
    name: 'relay_operators',
    type: 'base',
    fields: [
      { name: 'displayName', type: 'text', required: true },
      { name: 'sortOrder', type: 'number' },
    ],
  });
  const ids = new Map<string, string>();
  for (const [index, displayName] of displayNames.entries()) {
    const record = await pb
      .collection('relay_operators')
      .create({ displayName, sortOrder: index }, { requestKey: null });
    ids.set(displayName, record.id);
  }

  const ownerId = ids.get('Ryan Bledsoe') ?? '';
  const adminIds = [ids.get('Charles Gibbs') ?? ''];
  await pb.collections.create({
    name: 'relay_privileged_state',
    type: 'base',
    fields: [
      { name: 'key', type: 'text', required: true },
      { name: 'adminOperatorId', type: 'text' },
      { name: 'adminOperatorIds', type: 'json' },
      { name: 'identityMigrationVersion', type: 'number' },
      { name: 'revision', type: 'number' },
    ],
  });
  await pb.collection('relay_privileged_state').create(
    {
      key: 'primary',
      adminOperatorId: ownerId,
      adminOperatorIds: adminIds,
      identityMigrationVersion: 0,
      revision: 0,
    },
    { requestKey: null },
  );

  // The pre-upgrade build already authenticated against relay_privileged_accounts
  // keyed by operatorId, so the UNIQUE index below is part of the legacy shape —
  // without it the compatibility patch is rejected outright, because it declares
  // operatorId as the password-auth identity field.
  await pb.collections.create({
    name: 'relay_privileged_accounts',
    type: 'auth',
    fields: [
      { name: 'operatorId', type: 'text', required: true },
      { name: 'role', type: 'text' },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_legacy_operator_id ON relay_privileged_accounts (operatorId)',
    ],
    passwordAuth: { enabled: true, identityFields: ['operatorId'] },
  });
  for (const displayName of ['Ryan Bledsoe', 'Charles Gibbs']) {
    await pb.collection('relay_privileged_accounts').create(
      {
        operatorId: ids.get(displayName),
        role: 'admin',
        email: `${displayName.toLowerCase().replace(/\s+/g, '.')}@relay.test`,
        emailVisibility: false,
        verified: true,
        password: 'legacy-password-1234',
        passwordConfirm: 'legacy-password-1234',
      },
      { requestKey: null },
    );
  }
  return ownerId;
}

describe('collection bootstrap against a real PocketBase', () => {
  it('brings up a fresh database', async () => {
    const { pb } = await startServer();

    await expect(ensureCollections(pb)).resolves.toBeTruthy();

    const names = (await pb.collections.getFullList({ requestKey: null })).map((c) => c.name);
    expect(names).toContain('relay_privileged_accounts');
  });

  it('is idempotent on a fresh database', async () => {
    const { pb } = await startServer();

    await ensureCollections(pb);
    const first = (await pb.collections.getFullList({ requestKey: null }))
      .map((c) => c.name)
      .sort();

    await expect(ensureCollections(pb)).resolves.toBeTruthy();
    const second = (await pb.collections.getFullList({ requestKey: null }))
      .map((c) => c.name)
      .sort();

    expect(second).toEqual(first);
  });

  /**
   * The legacy conversion is a one-time migration keyed to one deployment's
   * actual roster: it requires those exact operator display names, a primary
   * state row naming the owner and administrators, matching auth accounts, and
   * the pre-upgrade collection shape. Reconstructing that from guesses would
   * prove nothing about the real database, so this asserts the property that
   * does matter and IS checkable — the migration never partially applies. It
   * refuses with a stated reason and leaves the legacy roster untouched, so a
   * mismatched database is recoverable rather than half-converted.
   *
   * Verifying the committed path needs a copy of production pb_data; see the
   * note in the review summary.
   */
  it('refuses an unrecognised legacy database without destroying it', async () => {
    const { pb } = await startServer();
    await seedLegacyRoster(pb, ['Ryan Bledsoe', 'Charles Gibbs', 'Paris Carlson']);

    const before = await pb
      .collection('relay_operators')
      .getFullList<{ id: string; displayName: string }>({ requestKey: null });

    await expect(ensureCollections(pb)).rejects.toBeTruthy();

    // The roster — the only copy of who the operators were — must survive.
    const names = (await pb.collections.getFullList({ requestKey: null })).map((c) => c.name);
    expect(names).toContain('relay_operators');
    const after = await pb
      .collection('relay_operators')
      .getFullList<{ id: string; displayName: string }>({ requestKey: null });
    expect(after.map((o) => o.displayName).sort()).toEqual(before.map((o) => o.displayName).sort());
  });
});
