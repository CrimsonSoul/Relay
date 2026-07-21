import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import { ELECTRON_RUNTIME } from '@shared/runtime';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
  },
}));

describe('preload Knowledge web link bridge', () => {
  let api: BridgeAPI;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMocks.invoke.mockResolvedValue({ ok: true });

    await import('./index');

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('api', expect.any(Object));
    api = electronMocks.exposeInMainWorld.mock.calls[0][1] as BridgeAPI;
  });

  it('invokes the dedicated Knowledge web link channel with the URL', async () => {
    const url = 'https://docs.example.com/runbook?incident=123';

    expect(api.openKnowledgeWebLink).toBeTypeOf('function');
    await expect(api.openKnowledgeWebLink(url)).resolves.toEqual({ ok: true });
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:openWebLink', url);
  });

  it('identifies the existing preload as the full desktop runtime', () => {
    expect(api.runtime).toEqual(ELECTRON_RUNTIME);
  });

  it('exposes cover bytes through the narrow Knowledge cover channel', async () => {
    const request = { documentId: 'document1', checksum: 'a'.repeat(64) };
    await api.getKnowledgeCover(request);
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:getCover', request);
  });

  it('exposes only validated-request search and identifier-only cancellation methods', async () => {
    const request = {
      requestId: 'search-request-1',
      query: 'failover',
      scope: { kind: 'all' as const },
      categoryId: null,
      documentType: null,
      limit: 20,
    };

    await api.searchKnowledge(request);
    api.cancelKnowledgeSearch(request.requestId);

    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:search', request);
    expect(electronMocks.send).toHaveBeenCalledWith('knowledge:searchCancel', request.requestId);
  });

  it('exposes only selection, safe queue state, and identifier-based Knowledge controls', async () => {
    const callback = vi.fn();
    await api.selectAndQueueKnowledgePdfs();
    await api.getKnowledgeUploadQueue();
    await api.pauseKnowledgeUploadBatch('batch-1');
    await api.resumeKnowledgeUploadBatch('batch-1');
    await api.retryKnowledgeUpload('upload-1');
    await api.reselectKnowledgeUploadSource('upload-1');
    await api.cancelKnowledgeUpload('upload-1');
    await api.cancelKnowledgeUploadBatch('batch-1');
    const unsubscribe = api.onKnowledgeUploadQueueChanged(callback);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === 'knowledge:uploadQueueChanged',
    )?.[1] as (_event: unknown, queue: unknown) => void;
    const queue = {
      restartRecovery: false,
      activeBatchId: 'batch-1',
      totalBytes: 100,
      acknowledgedBytes: 20,
      items: [],
    };
    handler({}, queue);
    unsubscribe();

    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:selectAndStage');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadQueue');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadBatchPause', 'batch-1');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadBatchResume', 'batch-1');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadRetry', 'upload-1');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadReselect', 'upload-1');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadFileCancel', 'upload-1');
    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:uploadBatchCancel', 'batch-1');
    expect(callback).toHaveBeenCalledWith(queue);
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      'knowledge:uploadQueueChanged',
      handler,
    );
  });

  it('exposes the narrow privileged bridge and forwards only its approved arguments', async () => {
    const login = { username: 'ryan', password: 'Test-access-value-123!' };
    const reauthentication = { password: 'Test-access-value-123!' };
    const pairing = {
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      deviceLabel: 'Ryan work laptop',
    };
    const command = {
      command: 'privileged.status.read' as const,
      payload: { clientVersion: '1.0.0' },
      expectedRevision: null,
    };

    await api.getPrivilegedSession();
    await api.loginPrivileged(login);
    await api.logoutPrivileged();
    await api.reauthenticatePrivileged(reauthentication);
    await api.createPrivilegedPairingChallenge('account-publisher');
    await api.completePrivilegedPairing(pairing);
    await api.submitPrivilegedCommand(command);
    const initialOwnerCredential = {
      username: 'Ryan',
      password: 'Test-access-value-123!',
      passwordConfirm: 'Test-access-value-123!',
    };
    const credential = {
      accountId: 'account-admin',
      password: 'Test-access-value-123!',
      passwordConfirm: 'Test-access-value-123!',
    };
    await api.setupInitialAdministratorCredential(initialOwnerCredential);
    await api.setupPrivilegedCredential(credential);

    expect(electronMocks.invoke.mock.calls).toEqual(
      expect.arrayContaining([
        ['privileged:getSession'],
        ['privileged:login', login],
        ['privileged:logout'],
        ['privileged:reauthenticate', reauthentication],
        ['privileged:createPairingChallenge', 'account-publisher'],
        ['privileged:completePairing', pairing],
        ['privileged:submitCommand', command],
        ['privileged:setupInitialAdministrator', initialOwnerCredential],
        ['privileged:setupCredential', credential],
      ]),
    );
  });

  it('does not expose retired roster management methods', () => {
    const bridge = api as unknown as Record<string, unknown>;

    expect(bridge.lockPrivileged).toBeUndefined();
    expect(bridge.createRelayOperator).toBeUndefined();
    expect(bridge.renameRelayOperator).toBeUndefined();
    expect(bridge.setRelayOperatorActive).toBeUndefined();
  });

  it('subscribes and unsubscribes from public privileged session changes', () => {
    const callback = vi.fn();
    const unsubscribe = api.onPrivilegedSessionChanged(callback);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === 'privileged:sessionChanged',
    )?.[1] as (_event: unknown, view: unknown) => void;
    const view = {
      state: 'signed-out',
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
      expiresAt: null,
    };

    handler({}, view);
    expect(callback).toHaveBeenCalledWith(view);
    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith('privileged:sessionChanged', handler);
  });
});
