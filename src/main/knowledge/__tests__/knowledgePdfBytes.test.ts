import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  escapeFilterValue,
  hasPdfSignature,
  matchesDeclaredPdf,
  readBoundedBody,
  sha256Hex,
} from '../knowledgePdfBytes';

const pdf = Buffer.from('%PDF-1.7\nbody');

describe('knowledgePdfBytes', () => {
  it('accepts only bytes that match the declared size, signature, and checksum', () => {
    const declared = { byteSize: pdf.byteLength, checksum: sha256Hex(pdf) };

    expect(sha256Hex(pdf)).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(matchesDeclaredPdf(pdf, declared)).toBe(true);
    expect(matchesDeclaredPdf(pdf.subarray(1), declared)).toBe(false);
    expect(matchesDeclaredPdf(pdf, { ...declared, checksum: 'f'.repeat(64) })).toBe(false);
    expect(hasPdfSignature(Buffer.from('%PDF'))).toBe(false);
    expect(hasPdfSignature(Buffer.from('<html>'))).toBe(false);
  });

  it('escapes quotes and backslashes for PocketBase filter strings', () => {
    expect(escapeFilterValue(String.raw`a"b\c`)).toBe(String.raw`a\"b\\c`);
  });

  it('reads a body within the limit and cancels one that grows past it', async () => {
    await expect(readBoundedBody(new Response(pdf), pdf.byteLength)).resolves.toEqual(
      new Uint8Array(pdf),
    );
    await expect(readBoundedBody(new Response(null), 10)).resolves.toBeNull();

    let cancelled = false;
    let pulls = 0;
    const endless = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(4));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readBoundedBody(endless, 10)).resolves.toBeNull();
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(4);
  });
});
