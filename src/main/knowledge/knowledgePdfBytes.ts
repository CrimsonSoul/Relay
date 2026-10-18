import { createHash } from 'node:crypto';

const PDF_SIGNATURE = '%PDF-';

/**
 * pdf.js loading options shared by every Wiki PDF parse: no network or system font access, no
 * XFA, and a hard stop on malformed input. `isEvalSupported` is intentionally absent: pdf.js 6
 * removed both the option and the `new Function` font/pattern path it used to gate.
 */
export const KNOWLEDGE_PDFJS_LOAD_OPTIONS = {
  useWorkerFetch: false,
  useSystemFonts: false,
  disableAutoFetch: true,
  disableStream: true,
  enableXfa: false,
  stopAtErrors: true,
} as const;

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hasPdfSignature(data: Uint8Array): boolean {
  return (
    data.byteLength >= PDF_SIGNATURE.length &&
    Buffer.from(data.subarray(0, PDF_SIGNATURE.length)).toString('ascii') === PDF_SIGNATURE
  );
}

/** True only when the bytes are exactly the declared PDF: same size, PDF signature, same SHA-256. */
export function matchesDeclaredPdf(
  data: Uint8Array,
  declared: { byteSize: number; checksum: string },
): boolean {
  return (
    data.byteLength === declared.byteSize &&
    hasPdfSignature(data) &&
    sha256Hex(data) === declared.checksum
  );
}

/** Escapes a value for use inside a double-quoted PocketBase filter string. */
export function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

/**
 * Reads a response body without ever buffering past `maxBytes`, whatever content-length claims.
 * Resolves null when there is no body or the body is larger than the limit.
 */
export async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
