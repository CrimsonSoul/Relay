import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeUploadQueueView } from '@shared/knowledge';
import { WebKnowledgeSession } from './WebKnowledgeSession';
import { WebSessionStore } from './WebSessionStore';

const emptyQueue: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

function ordinarySession(sessions: WebSessionStore) {
  return sessions.create({
    pbUrl: 'http://127.0.0.1:8090',
    auth: { token: 'app-token', record: { id: 'app-user' } },
    publicConfig: {
      mode: 'server',
      port: 8090,
      web: { enabled: true, port: 8091 },
      retention: { chatDays: 30, alertDays: 30, auditDays: 30 },
      autoBackup: { enabled: false, intervalHours: 24, maxBackups: 7 },
    },
    runtime: { target: 'web', mode: 'server', capabilities: [] },
    refresh: async () => ({ token: 'next-token', record: { id: 'app-user' } }),
  });
}

describe('WebKnowledgeSession', () => {
  it('keeps a session queue alive across event disconnects and disposes at logout', async () => {
    const sessions = new WebSessionStore();
    const ordinary = ordinarySession(sessions);
    const stopRuntime = vi.fn();
    let emitSnapshot!: (snapshot: KnowledgeUploadQueueView) => void;
    const upload = {
      start: vi.fn(async () => undefined),
      refresh: vi.fn(async () => emptyQueue),
      queuePaths: vi.fn(async () => ({ ok: true, uploads: [] }) as const),
      pauseBatch: vi.fn(),
      resumeBatch: vi.fn(),
      retryUpload: vi.fn(),
      reselectSource: vi.fn(async () => false),
      cancelUpload: vi.fn(async () => undefined),
      cancelBatch: vi.fn(async () => undefined),
      handleSessionChanged: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    const runtime = {
      getView: vi.fn(() => ({
        state: 'active',
        accountId: 'admin',
        username: 'ryan',
        displayName: 'Ryan',
        role: 'admin',
        capabilities: ['knowledge.manage'],
        deviceId: null,
        expiresAt: null,
      })),
      onSessionChanged: vi.fn(() => stopRuntime),
    };
    const events: unknown[] = [];
    const unsubscribe = sessions.subscribeEvents(ordinary.id, (event, data) =>
      events.push({ event, data }),
    );
    const knowledge = new WebKnowledgeSession({
      logicalSessionId: ordinary.rateLimitId,
      sessions,
      runtime: runtime as never,
      rootDir: await mkdtemp(join(tmpdir(), 'relay-web-knowledge-session-')),
      createUploadService: (options) => {
        emitSnapshot = options.emitSnapshot;
        return upload;
      },
    });

    await knowledge.getQueue();
    emitSnapshot(emptyQueue);
    unsubscribe();

    expect(events).toEqual([{ event: 'knowledge-upload-queue-changed', data: emptyQueue }]);
    expect(upload.dispose).not.toHaveBeenCalled();
    await sessions.destroy(ordinary.id);
    expect(stopRuntime).toHaveBeenCalledOnce();
    expect(upload.dispose).toHaveBeenCalledOnce();
  });
});
