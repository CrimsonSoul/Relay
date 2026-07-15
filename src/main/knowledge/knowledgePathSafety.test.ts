import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KNOWLEDGE_MAX_PDF_BYTES } from '@shared/knowledge';
import {
  ensureKnowledgeRoot,
  readKnowledgeSourceFile,
  scanKnowledgeRoot,
} from './knowledgePathSafety';

const roots: string[] = [];
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-knowledge-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('knowledgePathSafety', () => {
  it('creates the server source directory when missing', async () => {
    const parent = await temporaryRoot();
    const root = join(parent, 'knowledge-base');

    await ensureKnowledgeRoot(root);

    await expect(scanKnowledgeRoot(root)).resolves.toMatchObject({ healthy: true, candidates: [] });
  });

  it('discovers root General PDFs and immediate category PDFs in display order', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'access'));
    await mkdir(join(root, 'Zoo'));
    await writeFile(join(root, 'General guide.pdf'), pdfBytes);
    await writeFile(join(root, 'access', 'VPN.PDF'), pdfBytes);
    await writeFile(join(root, 'Zoo', 'Last.pdf'), pdfBytes);
    await writeFile(join(root, 'ignore.txt'), 'not a PDF');

    const result = await scanKnowledgeRoot(root);

    expect(result.healthy).toBe(true);
    expect(result.candidates.map(({ category, sourceKey }) => ({ category, sourceKey }))).toEqual([
      { category: 'General', sourceKey: 'General guide.pdf' },
      { category: 'access', sourceKey: 'access/VPN.PDF' },
      { category: 'Zoo', sourceKey: 'Zoo/Last.pdf' },
    ]);
  });

  it('ignores PDFs below the supported category depth and reports the structure issue', async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, 'Monitoring', 'Nested'), { recursive: true });
    await writeFile(join(root, 'Monitoring', 'Nested', 'Hidden.pdf'), pdfBytes);

    const result = await scanKnowledgeRoot(root);

    expect(result.candidates).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'nested-directory', sourceKey: 'Monitoring/Nested' }),
    );
  });

  it('rejects symbolic links even when their target is a valid PDF', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const target = join(outside, 'Outside.pdf');
    await writeFile(target, pdfBytes);
    await symlink(target, join(root, 'Linked.pdf'));

    const result = await scanKnowledgeRoot(root);

    expect(result.candidates).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'symbolic-link' }));
  });

  it('rejects empty, invalid-signature, oversized, and control-character PDFs independently', async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, 'Empty.pdf'), Buffer.alloc(0));
    await writeFile(join(root, 'Not pdf.pdf'), Buffer.from('not a pdf'));
    await writeFile(join(root, 'Bad\nName.pdf'), pdfBytes);
    const oversized = join(root, 'Huge.pdf');
    await writeFile(oversized, pdfBytes);
    await truncate(oversized, KNOWLEDGE_MAX_PDF_BYTES + 1);

    const result = await scanKnowledgeRoot(root);

    expect(result.candidates).toEqual([]);
    expect(
      result.issues.map((issue) => issue.code).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['control-character', 'empty-file', 'invalid-signature', 'oversized-file']);
  });

  it('reports an unavailable root as unhealthy rather than an empty healthy scan', async () => {
    const parent = await temporaryRoot();

    const result = await scanKnowledgeRoot(join(parent, 'missing'));

    expect(result).toMatchObject({ healthy: false, candidates: [], issues: [] });
  });

  it('reads the scanned file but rejects a symlink swapped in after validation', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const sourcePath = join(root, 'Guide.pdf');
    await writeFile(sourcePath, pdfBytes);
    const scan = await scanKnowledgeRoot(root);
    const candidate = scan.candidates[0]!;

    await expect(readKnowledgeSourceFile(root, candidate)).resolves.toEqual(pdfBytes);

    const outsidePath = join(outside, 'Outside.pdf');
    await writeFile(outsidePath, pdfBytes);
    await rm(sourcePath);
    await symlink(outsidePath, sourcePath);

    await expect(readKnowledgeSourceFile(root, candidate)).rejects.toThrow(
      /changed or is no longer safe/i,
    );
  });
});
