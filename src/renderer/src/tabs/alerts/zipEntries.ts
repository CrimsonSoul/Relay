/*
 * Minimal zip reader for Word documents (.docx is a zip of XML parts and media). It reads the
 * central directory and inflates the requested entries with the browser's DecompressionStream,
 * so importing needs no dependency and no main-process help. Encrypted, multi-disk and zip64
 * archives are refused; a Word document never needs them.
 */

/** Largest document accepted, and the most any one entry may inflate to. */
export const MAX_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRY_BYTES = 25 * 1024 * 1024;

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

type ZipEntry = { method: number; compressedSize: number; size: number; localOffset: number };

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of at most 65,535 bytes.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('Not a zip archive.');
}

function readDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff)
    throw new Error('Zip64 archives are not supported.');

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > bytes.byteLength ||
      view.getUint32(offset, true) !== CENTRAL_DIRECTORY_ENTRY
    ) {
      throw new Error('Damaged zip directory.');
    }
    const flags = view.getUint16(offset + 8, true);
    if (flags & 0x1) throw new Error('Encrypted documents are not supported.');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Errors surface on the read side; the write promises only mirror them.
  writer.write(data as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('A part of this document is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.byteLength;
  }
  return out;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.size > MAX_ZIP_ENTRY_BYTES) throw new Error('A part of this document is too large.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (header + 30 > bytes.byteLength || view.getUint32(header, true) !== LOCAL_FILE_HEADER) {
    throw new Error('Damaged zip entry.');
  }
  const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.byteLength !== entry.compressedSize) throw new Error('Damaged zip entry.');
  if (entry.method === STORED) return data;
  if (entry.method === DEFLATED) return inflate(data, MAX_ZIP_ENTRY_BYTES);
  throw new Error('Unsupported zip compression.');
}

/** An opened archive: the entry names it holds, and a reader for any of them. */
export type ZipArchive = {
  names: () => string[];
  read: (name: string) => Promise<Uint8Array | null>;
};

export async function openZip(file: Blob): Promise<ZipArchive> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('This document is larger than 50 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = readDirectory(bytes);
  return {
    names: () => [...entries.keys()],
    read: async (name) => {
      const entry = entries.get(name);
      return entry ? readEntry(bytes, entry) : null;
    },
  };
}
