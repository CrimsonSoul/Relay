import { describe, expect, it } from 'vitest';
import { buildKnowledgePdfFixture } from '../../../tests/fixtures/knowledgePdfFixtures';
import { renderKnowledgeCover } from './knowledgeCover';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('renderKnowledgeCover', () => {
  it('renders page one as a bounded PNG', async () => {
    const result = await renderKnowledgeCover(
      buildKnowledgePdfFixture({ title: 'Oracle SOP', pageCount: 2 }),
    );

    expect([...result.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    expect(result.byteLength).toBeGreaterThan(PNG_SIGNATURE.length);
    expect(result.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('rejects malformed PDF bytes with a bounded error', async () => {
    await expect(renderKnowledgeCover(new TextEncoder().encode('%PDF-invalid'))).rejects.toThrow(
      'render-failed',
    );
  });
});
