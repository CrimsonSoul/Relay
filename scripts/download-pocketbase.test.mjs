import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POCKETBASE_VERSION,
  __downloadTestHooks,
  downloadPocketBase,
  verifyChecksum,
} from './download-pocketbase.mjs';

const { findChecksumEntry, handleRedirect, maxRedirects } = __downloadTestHooks;

const WINDOWS_ASSET = `pocketbase_${POCKETBASE_VERSION}_windows_amd64.zip`;
const LINUX_ASSET = `pocketbase_${POCKETBASE_VERSION}_linux_amd64.zip`;
const DIGEST = 'a'.repeat(64);

const redirectResponse = (location) => ({
  headers: { location },
  resume: vi.fn(),
});

describe('PocketBase version contract', () => {
  it('prints the machine-readable configured version without attempting a download', () => {
    const config = JSON.parse(
      readFileSync(new URL('../resources/pocketbase/version.json', import.meta.url), 'utf8'),
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./download-pocketbase.mjs', import.meta.url)), '--print-version'],
      {
        encoding: 'utf8',
        env: { ...process.env, RELAY_SKIP_POCKETBASE_DOWNLOAD: '1' },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${config.version}\n`);
  });
});

describe('findChecksumEntry', () => {
  it('matches the asset name as a whole field rather than a substring', () => {
    const contents = [
      `${'b'.repeat(64)}  ${WINDOWS_ASSET}.sig`,
      `${DIGEST}  ${WINDOWS_ASSET}`,
      `${'c'.repeat(64)}  ${LINUX_ASSET}`,
    ].join('\n');

    expect(findChecksumEntry(contents, WINDOWS_ASSET)).toBe(DIGEST);
  });

  it('accepts CRLF checksum files and binary-mode markers', () => {
    const contents = `${DIGEST} *${WINDOWS_ASSET}\r\n${'c'.repeat(64)} *${LINUX_ASSET}\r\n`;

    expect(findChecksumEntry(contents, WINDOWS_ASSET)).toBe(DIGEST);
  });

  it('rejects an asset that appears more than once', () => {
    const contents = `${DIGEST}  ${WINDOWS_ASSET}\n${'d'.repeat(64)}  ${WINDOWS_ASSET}\n`;

    expect(() => findChecksumEntry(contents, WINDOWS_ASSET)).toThrow(
      /not found in checksums file/i,
    );
  });

  it('rejects an entry whose digest is not a SHA-256 hash', () => {
    expect(() => findChecksumEntry(`deadbeef  ${WINDOWS_ASSET}\n`, WINDOWS_ASSET)).toThrow(
      /not a SHA-256 digest/i,
    );
  });

  it('rejects a missing asset', () => {
    expect(() => findChecksumEntry(`${DIGEST}  ${LINUX_ASSET}\n`, WINDOWS_ASSET)).toThrow(
      /not found in checksums file/i,
    );
  });
});

describe('verifyChecksum', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'relay-pb-checksum-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('verifies the archive against its exact checksum entry', async () => {
    const zipPath = join(workDir, 'pb.zip');
    const payload = Buffer.from('relay pocketbase archive');
    await writeFile(zipPath, payload);
    const digest = createHash('sha256').update(payload).digest('hex');

    await expect(
      verifyChecksum(zipPath, WINDOWS_ASSET, async (_url, destination) => {
        writeFileSync(
          destination,
          `${digest}  ${WINDOWS_ASSET}\n${'c'.repeat(64)}  ${LINUX_ASSET}`,
        );
      }),
    ).resolves.toBeUndefined();

    expect(existsSync(`${zipPath}.checksums.txt`)).toBe(false);
    expect(existsSync(zipPath)).toBe(true);
  });

  it('deletes the archive when the digest does not match', async () => {
    const zipPath = join(workDir, 'pb.zip');
    await writeFile(zipPath, 'tampered');

    await expect(
      verifyChecksum(zipPath, WINDOWS_ASSET, async (_url, destination) => {
        writeFileSync(destination, `${DIGEST}  ${WINDOWS_ASSET}\n`);
      }),
    ).rejects.toThrow(/checksum mismatch/i);

    expect(existsSync(zipPath)).toBe(false);
    expect(existsSync(`${zipPath}.checksums.txt`)).toBe(false);
  });
});

describe('download redirect handling', () => {
  it('rejects instead of throwing when a redirect downgrades to plain HTTP', () => {
    const reject = vi.fn();
    const resolve = vi.fn();
    // The insecure scheme is the subject of this test, not a real endpoint.
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    const response = redirectResponse('http://mirror.invalid/pb.zip');

    expect(() =>
      handleRedirect(response, 'https://github.test/pb.zip', 'pb.zip', resolve, reject, 3),
    ).not.toThrow();
    expect(response.resume).toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(reject.mock.calls[0][0].message).toMatch(/refusing insecure/i);
  });

  it('stops following redirects once the budget is exhausted', () => {
    const reject = vi.fn();
    const resolve = vi.fn();
    const response = redirectResponse('https://loop.test/pb.zip');

    handleRedirect(response, 'https://loop.test/pb.zip', 'pb.zip', resolve, reject, 0);

    expect(resolve).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0].message).toMatch(
      new RegExp(`exceeded ${maxRedirects} redirects`, 'i'),
    );
  });
});

describe('downloadPocketBase cleanup', () => {
  const baseOptions = (overrides) => ({
    platform: 'linux',
    arch: 'x64',
    resourcesDir: '/relay/resources/pocketbase',
    exists: () => false,
    mkdir: () => undefined,
    download: async () => undefined,
    verify: async () => undefined,
    extract: () => undefined,
    chmod: () => undefined,
    remove: vi.fn(),
    log: vi.fn(),
    ...overrides,
  });

  it('removes the downloaded archive when extraction fails', async () => {
    const remove = vi.fn();
    const options = baseOptions({
      remove,
      extract: () => {
        throw new Error('unzip exited with status 1');
      },
    });

    await expect(downloadPocketBase(options)).rejects.toThrow(/unzip exited with status 1/);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(String(remove.mock.calls[0][0])).toMatch(/pb\.zip$/);
  });

  it('preserves the original failure when the archive cannot be removed', async () => {
    const options = baseOptions({
      remove: () => {
        throw new Error('EBUSY');
      },
      extract: () => {
        throw new Error('unzip exited with status 1');
      },
    });

    await expect(downloadPocketBase(options)).rejects.toThrow(/unzip exited with status 1/);
  });

  it('removes the archive after a successful extraction', async () => {
    const remove = vi.fn();
    const chmod = vi.fn();

    await downloadPocketBase(baseOptions({ remove, chmod }));

    expect(remove).toHaveBeenCalledTimes(1);
    expect(chmod).toHaveBeenCalledTimes(1);
  });
});
