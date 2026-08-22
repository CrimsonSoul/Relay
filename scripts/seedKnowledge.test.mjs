import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { seedKnowledgeDocuments } from './seedKnowledge.mjs';

describe('seedKnowledgeDocuments', () => {
  it('uploads deterministic PDFs to protected PocketBase records without filesystem writes', async () => {
    const baseUrl = ['http', '://relay.local'].join('');
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ Authorization: 'seed-token' });
      expect(init.body).toBeInstanceOf(FormData);
      const pdf = init.body.get('pdf');
      expect(pdf).toBeInstanceOf(Blob);
      expect(pdf.type).toBe('application/pdf');
      const bytes = Buffer.from(await pdf.arrayBuffer());
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(init.body.get('checksum')).toBe(createHash('sha256').update(bytes).digest('hex'));
      return new Response(JSON.stringify({ id: 'document1' }), { status: 200 });
    });

    await expect(
      seedKnowledgeDocuments({
        baseUrl,
        token: 'seed-token',
        fetchImpl,
        now: () => new Date('2026-07-15T12:00:00.000Z'),
      }),
    ).resolves.toHaveLength(2);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
