import { crc32 } from 'node:zlib';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractVerifiedRelayInstaller, parseRelayChecksum } from './RelayReleaseArchive';

const ASSET_NAME = 'Relay-v1.1.0-windows-x64.zip';
const INSTALLER = Buffer.from('MZverified relay installer');
const INSTALLER_SHA256 = 'b1a62e6c00b6dc38761820c5af04b18d8acdebcae5beff6119c9dc6401824b32';

type ZipFixtureEntry = {
  name: string;
  data: Buffer;
  flags?: number;
  compressionMethod?: number;
  externalFileAttributes?: number;
};

function storedZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const flags = entry.flags ?? 0;
    const compressionMethod = entry.compressionMethod ?? 0;
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.byteLength, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(entry.externalFileAttributes ?? (0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + entry.data.byteLength;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localData.byteLength, 16);
  return Buffer.concat([localData, centralDirectory, end]);
}

describe('parseRelayChecksum', () => {
  it.each([
    [`${'a'.repeat(64)}  ${ASSET_NAME}\n`, 'a'.repeat(64)],
    [`${'b'.repeat(64)} *${ASSET_NAME}\r\n`, 'b'.repeat(64)],
  ])('accepts an exact sha256sum entry', (text, expected) => {
    expect(parseRelayChecksum(text, ASSET_NAME)).toBe(expected);
  });

  it.each([
    `${'a'.repeat(64)}  other.zip\n`,
    `${'a'.repeat(64)}  ${ASSET_NAME}\n${'b'.repeat(64)}  ${ASSET_NAME}\n`,
    `${'A'.repeat(64)}  ${ASSET_NAME}\n`,
    `abcd  ${ASSET_NAME}\n`,
    `${'a'.repeat(64)} ${ASSET_NAME}\n`,
    `${'a'.repeat(64)}  ../${ASSET_NAME}\n`,
    `${'a'.repeat(64)}  ${ASSET_NAME} extra\n`,
    'x'.repeat(257),
    '',
  ])('rejects malformed checksum content', (text) => {
    expect(() => parseRelayChecksum(text, ASSET_NAME)).toThrow(/checksum/i);
  });
});

describe('extractVerifiedRelayInstaller', () => {
  let directory: string;
  let archivePath: string;
  let destinationPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'relay-release-archive-'));
    archivePath = join(directory, 'Relay.zip');
    destinationPath = join(directory, 'Relay.exe');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('streams the one Relay executable into an exclusive verified destination', async () => {
    await writeFile(archivePath, storedZip([{ name: 'Relay.exe', data: INSTALLER }]));

    await expect(extractVerifiedRelayInstaller(archivePath, destinationPath)).resolves.toEqual({
      bytes: INSTALLER.byteLength,
      sha256: INSTALLER_SHA256,
    });
    await expect(readFile(destinationPath)).resolves.toEqual(INSTALLER);
  });

  it.each([
    ['an empty archive', []],
    [
      'multiple entries',
      [
        { name: 'Relay.exe', data: INSTALLER },
        { name: 'notes.txt', data: Buffer.from('no') },
      ],
    ],
    ['a traversal path', [{ name: '../Relay.exe', data: INSTALLER }]],
    ['a nested path', [{ name: 'folder/Relay.exe', data: INSTALLER }]],
    ['a backslash path', [{ name: 'folder\\Relay.exe', data: INSTALLER }]],
    ['a case variant', [{ name: 'relay.exe', data: INSTALLER }]],
    ['a directory entry', [{ name: 'Relay.exe/', data: Buffer.alloc(0) }]],
    ['an encrypted entry', [{ name: 'Relay.exe', data: INSTALLER, flags: 1 }]],
    [
      'a symbolic-link entry',
      [{ name: 'Relay.exe', data: INSTALLER, externalFileAttributes: (0o120777 << 16) >>> 0 }],
    ],
    [
      'an unsupported compression method',
      [{ name: 'Relay.exe', data: INSTALLER, compressionMethod: 99 }],
    ],
  ] satisfies Array<[string, ZipFixtureEntry[]]>)('rejects %s', async (_label, entries) => {
    await writeFile(archivePath, storedZip(entries));

    await expect(extractVerifiedRelayInstaller(archivePath, destinationPath)).rejects.toThrow();
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an installer larger than its extraction limit', async () => {
    await writeFile(archivePath, storedZip([{ name: 'Relay.exe', data: INSTALLER }]));

    await expect(
      extractVerifiedRelayInstaller(archivePath, destinationPath, { maxInstallerBytes: 10 }),
    ).rejects.toThrow(/size/i);
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an entry whose CRC no longer matches its directory record', async () => {
    const zip = storedZip([{ name: 'Relay.exe', data: INSTALLER }]);
    const corruptIndex = 30 + Buffer.byteLength('Relay.exe') + 2;
    zip[corruptIndex] = (zip[corruptIndex] ?? 0) ^ 0xff;
    await writeFile(archivePath, zip);

    await expect(extractVerifiedRelayInstaller(archivePath, destinationPath)).rejects.toThrow();
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an extracted payload that is not a Windows executable', async () => {
    await writeFile(
      archivePath,
      storedZip([{ name: 'Relay.exe', data: Buffer.from('not a PE executable') }]),
    );

    await expect(extractVerifiedRelayInstaller(archivePath, destinationPath)).rejects.toThrow(
      /executable/i,
    );
    await expect(stat(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites a pre-existing installer destination', async () => {
    await writeFile(archivePath, storedZip([{ name: 'Relay.exe', data: INSTALLER }]));
    await writeFile(destinationPath, 'keep me');

    await expect(extractVerifiedRelayInstaller(archivePath, destinationPath)).rejects.toThrow();
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe('keep me');
  });
});
