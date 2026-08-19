import { createHash } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

export type RelayReleaseArchiveOptions = {
  maxInstallerBytes?: number;
};

const MAX_CHECKSUM_BYTES = 256;
const DEFAULT_MAX_INSTALLER_BYTES = 512 * 1_024 * 1_024;
const CHECKSUM_PATTERN = /^([0-9a-f]{64}) ([ *])(.+)$/u;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_SYMBOLIC_LINK = 0o120000;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;

function stripChecksumLineEnding(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

export function parseRelayChecksum(text: string, assetName: string): string {
  if (
    Buffer.byteLength(text, 'utf8') > MAX_CHECKSUM_BYTES ||
    !assetName ||
    assetName.includes('/') ||
    assetName.includes('\\')
  ) {
    throw new Error('Relay release checksum content was invalid');
  }

  const line = stripChecksumLineEnding(text);
  if (!line || line.includes('\n') || line.includes('\r')) {
    throw new Error('Relay release checksum content was invalid');
  }
  const match = CHECKSUM_PATTERN.exec(line);
  if (!match || match[3] !== assetName) {
    throw new Error('Relay release checksum did not name the expected asset');
  }
  return match[1]!;
}

function openArchive(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      {
        autoClose: false,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error('Relay release ZIP could not be opened'));
          return;
        }
        resolve(zip);
      },
    );
  });
}

function readArchiveEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    const fail = (error: Error) => {
      zip.removeListener('entry', onEntry);
      zip.removeListener('end', onEnd);
      reject(error);
    };
    const onEntry = (entry: Entry) => {
      entries.push(entry);
      if (entries.length > 1) {
        fail(new Error('Relay release ZIP contained more than one entry'));
        return;
      }
      zip.readEntry();
    };
    const onEnd = () => {
      zip.removeListener('error', fail);
      resolve(entries);
    };
    zip.once('error', fail);
    zip.on('entry', onEntry);
    zip.once('end', onEnd);
    zip.readEntry();
  });
}

function validateInstallerEntry(entry: Entry, maximumBytes: number): void {
  if (entry.fileName !== 'Relay.exe') {
    throw new Error('Relay release ZIP did not contain the exact Relay executable');
  }
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new Error('Relay release ZIP executable could not be decoded safely');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error('Relay release ZIP used an unsupported compression method');
  }
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 2 ||
    entry.uncompressedSize > maximumBytes ||
    !Number.isSafeInteger(entry.compressedSize) ||
    entry.compressedSize < 0 ||
    entry.compressedSize > maximumBytes
  ) {
    throw new Error('Relay release ZIP executable exceeded its size limit');
  }

  const originSystem = entry.versionMadeBy >>> 8;
  if (originSystem === 3) {
    const fileType = (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
    if (fileType === UNIX_SYMBOLIC_LINK || (fileType !== 0 && fileType !== UNIX_REGULAR_FILE)) {
      throw new Error('Relay release ZIP executable was not a regular file');
    }
  }
  if ((entry.externalFileAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0) {
    throw new Error('Relay release ZIP executable was a directory');
  }
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error('Relay release ZIP executable could not be read'));
        return;
      }
      resolve(stream);
    });
  });
}

async function writeChunk(file: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten <= 0) throw new Error('Relay installer extraction could not write');
    offset += result.bytesWritten;
  }
}

function normalizeStreamChunk(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  return Buffer.from(value as Uint8Array);
}

async function extractInstallerPayload(
  stream: NodeJS.ReadableStream,
  file: FileHandle,
  entry: Entry,
  maximumBytes: number,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let rollingCrc = 0;
  let bytes = 0;
  let magic = Buffer.alloc(0);

  for await (const value of stream) {
    const chunk = normalizeStreamChunk(value);
    bytes += chunk.byteLength;
    if (bytes > maximumBytes || bytes > entry.uncompressedSize) {
      throw new Error('Relay release ZIP executable exceeded its size limit');
    }
    if (magic.byteLength < 2) {
      magic = Buffer.concat([magic, chunk.subarray(0, 2 - magic.byteLength)]);
    }
    hash.update(chunk);
    rollingCrc = crc32(chunk, rollingCrc);
    await writeChunk(file, chunk);
  }

  if (bytes !== entry.uncompressedSize || rollingCrc >>> 0 !== entry.crc32 >>> 0) {
    throw new Error('Relay release ZIP executable failed integrity validation');
  }
  if (magic.byteLength !== 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
    throw new Error('Relay release payload was not a Windows executable');
  }

  return { bytes, sha256: hash.digest('hex') };
}

export async function extractVerifiedRelayInstaller(
  archivePath: string,
  destinationPath: string,
  options: RelayReleaseArchiveOptions = {},
): Promise<{ bytes: number; sha256: string }> {
  const maximumBytes = options.maxInstallerBytes ?? DEFAULT_MAX_INSTALLER_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2) {
    throw new Error('Relay installer extraction size limit was invalid');
  }

  const zip = await openArchive(archivePath);
  let file: FileHandle | null = null;
  let createdDestination = false;
  try {
    const entries = await readArchiveEntries(zip);
    const [entry] = entries;
    if (entries.length !== 1 || !entry) {
      throw new Error('Relay release ZIP did not contain one entry');
    }
    validateInstallerEntry(entry, maximumBytes);

    const stream = await openEntryStream(zip, entry);
    file = await open(destinationPath, 'wx', 0o600);
    createdDestination = true;
    const result = await extractInstallerPayload(stream, file, entry, maximumBytes);
    await file.sync();
    await file.close();
    file = null;
    return result;
  } catch (error) {
    await file?.close().catch(() => undefined);
    if (createdDestination) await rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    zip.close();
  }
}
