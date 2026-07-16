import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_UPLOADS_COLLECTION } from '@shared/knowledge';
import { KnowledgeUploadService } from '../KnowledgeUploadService';

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

const view = {
  state: 'active' as const,
  accountId: 'account-admin',
  operatorId: 'operator-admin',
  operatorName: 'Ryan Bledsoe',
  role: 'admin' as const,
  capabilities: ['knowledge.manage' as const],
  deviceId: 'device-1',
  expiresAt: '2026-07-16T02:00:00.000Z',
};

describe('KnowledgeUploadService', () => {
  const createPrivilegedRecord = vi.fn();
  const submitPublicCommand = vi.fn();
  const runtime = {
    getView: vi.fn(() => view),
    createPrivilegedRecord,
    submitPublicCommand,
  };
  const selectFiles = vi.fn();
  const inspect = vi.fn();
  const read = vi.fn();
  const emitProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    selectFiles.mockResolvedValue(['/private/work/First.pdf', '/private/work/Second.pdf']);
    inspect.mockImplementation(async (path: string) => ({
      symbolicLink: false,
      size: path.includes('First') ? 12 : 13,
      canonicalPath: path,
    }));
    read.mockImplementation(async (path: string) =>
      Buffer.from(path.includes('First') ? '%PDF-first!!' : '%PDF-second!!'),
    );
    createPrivilegedRecord
      .mockResolvedValueOnce({ id: 'upload-1' })
      .mockResolvedValueOnce({ id: 'upload-2' });
    submitPublicCommand.mockImplementation(async ({ payload }) => ({
      ok: true,
      requestId: 'validated',
      value: {
        id: payload.uploadId,
        requestId: payload.uploadId === 'upload-1' ? 'request-1' : 'request-2',
        state: 'ready',
        progress: 100,
      },
    }));
  });

  function service(overrides: Record<string, unknown> = {}) {
    const ids = ['request-1', 'request-2'];
    return new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      selectFiles,
      inspect,
      read,
      emitProgress,
      now: () => Date.parse('2026-07-16T01:00:00.000Z'),
      createId: () => ids.shift() ?? 'request-extra',
      ...overrides,
    });
  }

  it('stages selected PDFs sequentially through the privileged account and validates each', async () => {
    const result = await service().selectAndStage();

    expect(result).toMatchObject({
      ok: true,
      uploads: [
        { id: 'upload-1', fileName: 'First.pdf', state: 'ready' },
        { id: 'upload-2', fileName: 'Second.pdf', state: 'ready' },
      ],
    });
    expect(createPrivilegedRecord).toHaveBeenCalledTimes(2);
    expect(createPrivilegedRecord.mock.calls[0]?.[0]).toBe(KNOWLEDGE_UPLOADS_COLLECTION);
    expect(submitPublicCommand).toHaveBeenNthCalledWith(1, {
      command: 'knowledge.upload.validate',
      payload: {
        uploadId: 'upload-1',
        preliminaryChecksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      expectedRevision: null,
    });
  });

  it('isolates invalid and symlinked files without uploading them', async () => {
    inspect.mockResolvedValueOnce({
      symbolicLink: true,
      size: 12,
      canonicalPath: '/private/work/First.pdf',
    });
    const result = await service().selectAndStage();

    expect(result).toMatchObject({
      ok: true,
      uploads: [
        { fileName: 'First.pdf', state: 'failed' },
        { id: 'upload-1', state: 'ready' },
      ],
    });
    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
  });

  it('returns bounded cancellation and authorization failures', async () => {
    selectFiles.mockResolvedValueOnce([]);
    await expect(service().selectAndStage()).resolves.toEqual({ ok: false, error: 'cancelled' });

    runtime.getView.mockReturnValueOnce({ ...view, capabilities: [] });
    await expect(service().selectAndStage()).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('never emits local paths or PDF bytes to progress or result state', async () => {
    const result = await service().selectAndStage();
    const exposed = JSON.stringify({ result, progress: emitProgress.mock.calls });

    expect(exposed).not.toContain('/private/work');
    expect(exposed).not.toContain('%PDF-');
  });
});
