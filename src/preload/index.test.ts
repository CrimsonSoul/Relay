import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';

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

  it('exposes only selection and safe progress for Knowledge uploads', async () => {
    const callback = vi.fn();
    await api.selectAndStageKnowledgePdfs();
    const unsubscribe = api.onKnowledgeUploadProgress(callback);
    const handler = electronMocks.on.mock.calls.find(
      ([channel]) => channel === 'knowledge:uploadProgress',
    )?.[1] as (_event: unknown, progress: unknown) => void;
    const progress = {
      requestId: 'request-1',
      fileName: 'Runbook.pdf',
      byteSize: 100,
      state: 'uploading',
      progress: 20,
      safeError: null,
    };
    handler({}, progress);
    unsubscribe();

    expect(electronMocks.invoke).toHaveBeenCalledWith('knowledge:selectAndStage');
    expect(callback).toHaveBeenCalledWith(progress);
    expect(electronMocks.removeListener).toHaveBeenCalledWith('knowledge:uploadProgress', handler);
  });

  it('exposes the narrow privileged bridge and forwards only its approved arguments', async () => {
    const login = { operatorId: 'operator-admin', password: 'Test-access-value-123!' };
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
    await api.lockPrivileged();
    await api.reauthenticatePrivileged(reauthentication);
    await api.createPrivilegedPairingChallenge();
    await api.completePrivilegedPairing(pairing);
    await api.submitPrivilegedCommand(command);
    const credential = {
      operatorId: 'operator-admin',
      password: 'Test-access-value-123!',
      passwordConfirm: 'Test-access-value-123!',
    };
    await api.setupInitialAdministratorCredential(credential);
    await api.setupPrivilegedCredential(credential);

    expect(electronMocks.invoke.mock.calls).toEqual(
      expect.arrayContaining([
        ['privileged:getSession'],
        ['privileged:login', login],
        ['privileged:logout'],
        ['privileged:lock'],
        ['privileged:reauthenticate', reauthentication],
        ['privileged:createPairingChallenge'],
        ['privileged:completePairing', pairing],
        ['privileged:submitCommand', command],
        ['privileged:setupInitialAdministrator', credential],
        ['privileged:setupCredential', credential],
      ]),
    );
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
      operatorId: null,
      operatorName: null,
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
