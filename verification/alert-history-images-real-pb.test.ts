import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ensureCollections } from '../src/main/pocketbase/CollectionBootstrap';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';

const PASSWORD = 'disposable-alert-images-test';
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let root = '';
let child: ChildProcess | undefined;
let admin: PocketBase;
let account: PocketBase;

async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function pngFile(name: string): File {
  return new File([Buffer.from(PNG_1X1, 'base64')], name, { type: 'image/png' });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'relay-alert-images-'));
  const binary = getPocketBaseBinaryPath({
    isPackaged: false,
    appRoot: process.cwd(),
    resourcesPath: '',
    platform: process.platform,
    arch: process.arch,
  });
  const dataDir = join(root, 'pb_data');
  const created = spawnSync(
    binary,
    ['superuser', 'upsert', 'admin@images.test', PASSWORD, `--dir=${dataDir}`],
    { encoding: 'utf8' },
  );
  if (created.status !== 0) throw new Error(created.stderr);
  const url = `http://127.0.0.1:${await availablePort()}`;
  child = spawn(
    binary,
    [
      'serve',
      `--http=${new URL(url).host}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${join(root, 'pb_migrations')}`,
    ],
    { stdio: 'ignore' },
  );
  admin = new PocketBase(url);
  await vi.waitFor(() => admin.health.check(), { timeout: 10000, interval: 50 });
  await admin.collection('_superusers').authWithPassword('admin@images.test', PASSWORD);
  await ensureCollections(admin);
  await admin.collections.create({ name: 'test_users', type: 'auth' });
  await admin
    .collection('test_users')
    .create({ email: 'guide@images.test', password: PASSWORD, passwordConfirm: PASSWORD });
  account = new PocketBase(url);
  account.autoCancellation(false);
  await account.collection('test_users').authWithPassword('guide@images.test', PASSWORD);
}, 30_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

it('stores guide images as protected files that leave with their record', async () => {
  const saved = await account.collection('alert_history').create({
    severity: 'INFO',
    subject: 'How to reset a badge',
    bodyHtml:
      '<p>Steps</p><img data-relay-image="0" alt="one"><img data-relay-image="1" alt="two">',
    sender: 'ops@images.test',
    recipient: '',
    pinned: true,
    label: '',
    images: [pngFile('image-0.png'), pngFile('image-1.png')],
  });
  expect(saved.images).toHaveLength(2);

  const token = await account.files.getToken();
  const urls = (saved.images as string[]).map((name) => account.files.getURL(saved, name));
  for (const url of urls) {
    const withToken = await fetch(`${url}?token=${encodeURIComponent(token)}`);
    expect(withToken.status).toBe(200);
    expect(withToken.headers.get('content-type')).toBe('image/png');
    expect((await fetch(url)).status).not.toBe(200);
  }

  await account.collection('alert_history').delete(saved.id);
  for (const url of urls) {
    expect((await fetch(`${url}?token=${encodeURIComponent(token)}`)).status).toBe(404);
  }
});

it('refuses a thirty-first image on the server', async () => {
  await expect(
    account.collection('alert_history').create({
      severity: 'INFO',
      subject: 'Too many',
      bodyHtml: '<p>x</p>',
      sender: 'ops@images.test',
      recipient: '',
      pinned: false,
      label: '',
      images: Array.from({ length: 31 }, (_, index) => pngFile(`image-${index}.png`)),
    }),
  ).rejects.toThrow();
});
