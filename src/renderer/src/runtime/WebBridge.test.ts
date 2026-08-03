// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI, RadarSnapshot } from '@shared/ipc';
import { RADAR_URL } from '@shared/radar';
import { WEB_RUNTIME } from '@shared/runtime';
import type { WebSessionBootstrap } from '@shared/webApi';
import type { WebBridgeRequest } from './WebBridge';
import { createWebBridge, createWebEventSubscriber } from './WebBridge';
import { createBrowserActions } from './browserActions';

const SESSION: WebSessionBootstrap = {
  csrfToken: 'c'.repeat(43),
  pbUrl: ['http', '://', 'relay-server', ':8090'].join(''),
  auth: { token: 'app-user-token', record: null },
  publicConfig: { mode: 'server', port: 8090 },
  runtime: WEB_RUNTIME,
};

const EMPTY_STATUS = {
  providers: Object.fromEntries(
    [
      'aws',
      'azure',
      'm365',
      'jira',
      'github',
      'cloudflare',
      'google',
      'anthropic',
      'openai',
      'salesforce',
    ].map((provider) => [provider, []]),
  ),
  lastUpdated: 0,
  errors: [],
};

const SIGNED_OUT = {
  state: 'signed-out' as const,
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

const RADAR_SNAPSHOT: RadarSnapshot = {
  color: 'green',
  dispatchers: [],
  papa: [],
  metrics: [],
  xcenter: { ok: 977, pending: 3 },
  currentTime: '10:02',
  lastUpdated: 1_785_515_320_000,
  signInRequired: false,
  error: null,
};

/**
 * `WebBridgeRequest` is `<T>(path, options) => Promise<T>` — an unconstrained generic
 * return that no implementation can produce without an assertion; the real one ends in
 * `(await response.json()) as T`. A double has to cross that same unchecked
 * deserialisation boundary, so it is confined to this single helper. The recording mock
 * is handed back so tests still assert on the exact routes and bodies requested.
 */
function stubWebRequest(
  respond: (path: string, options: Parameters<WebBridgeRequest>[1]) => unknown,
) {
  const calls = vi.fn(respond);
  const request: WebBridgeRequest = async <T>(
    path: string,
    options: Parameters<WebBridgeRequest>[1],
  ): Promise<T> => (await calls(path, options)) as T;
  return { request, calls };
}

describe('WebBridge', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('provides an exhaustive safe bridge with the current in-memory connection', async () => {
    const { request } = stubWebRequest((path) =>
      path === '/privileged/session' ? SIGNED_OUT : EMPTY_STATUS,
    );
    const bridge: BridgeAPI = createWebBridge(SESSION, {
      request,
      subscribe: vi.fn(() => () => undefined),
    });

    for (const [name, value] of Object.entries(bridge)) {
      if (name !== 'runtime' && name !== 'platform') expect(value, name).toBeTypeOf('function');
    }
    await expect(bridge.getPbConnection()).resolves.toEqual({
      ok: true,
      connection: { pbUrl: SESSION.pbUrl, auth: SESSION.auth },
    });
    await expect(bridge.isConfigured()).resolves.toBe(true);
    await expect(bridge.getConfig()).resolves.toEqual(SESSION.publicConfig);
    await expect(bridge.saveConfig({})).resolves.toBe(false);
    await expect(bridge.createBackup()).resolves.toMatchObject({ success: false });
    await expect(bridge.getPrivilegedSession()).resolves.toMatchObject({ state: 'signed-out' });
    expect((bridge as unknown as Record<string, unknown>).openPath).toBeUndefined();
  });

  it('composes every non-startup BridgeAPI method without exposing desktop startup controls', () => {
    const { request } = stubWebRequest(() => EMPTY_STATUS);
    const bridge = createWebBridge(SESSION, { request });

    expect(Object.keys(bridge).sort((left, right) => left.localeCompare(right))).toEqual([
      'addDynatraceDashboard',
      'cacheRead',
      'cacheSnapshot',
      'cacheWrite',
      'cancelAuth',
      'cancelKnowledgeSearch',
      'cancelKnowledgeUpload',
      'cancelKnowledgeUploadBatch',
      'cancelWebApprovalRequest',
      'clearConfig',
      'clearDynatraceProblemsSettings',
      'clearDynatraceSession',
      'completePrivilegedPairing',
      'createBackup',
      'createPrivilegedPairingChallenge',
      'discoverServers',
      'generateWebApprovalCode',
      'getClientHostname',
      'getCloudStatus',
      'getCompanyLogo',
      'getConfig',
      'getConnectionSecret',
      'getDynatraceProblemsSettings',
      'getFooterLogo',
      'getKnowledgeCover',
      'getKnowledgeIndexStatus',
      'getKnowledgePdf',
      'getKnowledgeUploadQueue',
      'getPbConnection',
      'getPendingSyncStatus',
      'getPrivilegedSession',
      'getRadarSnapshot',
      'getWebServerState',
      'isConfigured',
      'isMaximized',
      'listBackups',
      'listDynatraceDashboards',
      'listWebApprovalRequests',
      'logBridge',
      'loginPrivileged',
      'logoutPrivileged',
      'logToMain',
      'mutateOffline',
      'notifyAlertDismissed',
      'notifyDragStart',
      'notifyDragStop',
      'onAlertDismissed',
      'onAuthRequested',
      'onDragStateChange',
      'onDynatraceDashboardsChanged',
      'onErrorNotification',
      'onKnowledgeIndexStatusChanged',
      'onKnowledgeUploadQueueChanged',
      'onMaximizeChange',
      'onOfflineMutationApplied',
      'onPbCrashed',
      'onPendingSyncStatusChanged',
      'onPrivilegedSessionChanged',
      'onRadarSnapshot',
      'onWebApprovalRequestsChanged',
      'openDynatraceDashboard',
      'openExternal',
      'openKnowledgeWebLink',
      'openRadarSignIn',
      'optimizeAlertImage',
      'pauseKnowledgeUploadBatch',
      'platform',
      'playAlertSound',
      'reauthenticatePrivileged',
      'refreshPbConnection',
      'refreshRadar',
      'relaunchApp',
      'removeCompanyLogo',
      'removeDynatraceDashboard',
      'removeFooterLogo',
      'reselectKnowledgeUploadSource',
      'restoreBackup',
      'resumeKnowledgeUploadBatch',
      'retryKnowledgeUpload',
      'retryWebServer',
      'runtime',
      'saveAlertImage',
      'saveAndOpenAlertDraft',
      'saveAndOpenIcs',
      'saveCompanyLogo',
      'saveConfig',
      'saveDynatraceProblemProfileFilter',
      'saveDynatraceProblemsSettings',
      'saveFooterLogo',
      'saveWebServerConfig',
      'searchKnowledge',
      'selectAlertBodyImage',
      'selectAndQueueKnowledgePdfs',
      'selectReminderSound',
      'setupInitialAdministratorCredential',
      'setupPrivilegedCredential',
      'startPocketBase',
      'submitAuth',
      'submitPrivilegedCommand',
      'syncDynatraceProblems',
      'syncPending',
      'testConnection',
      'testDynatraceProblemsSettings',
      'updateDynatraceDashboard',
      'useCachedAuth',
      'windowClose',
      'windowMaximize',
      'windowMinimize',
      'writeClipboard',
    ]);
  });

  it('keeps device-only capabilities excluded while shared operations use bounded Web paths', async () => {
    const routeResponses: Record<string, unknown> = {
      '/operations/cloud-status': EMPTY_STATUS,
      '/operations/dynatrace-dashboards': [],
      '/operations/dynatrace-problems/settings': {
        configured: false,
        environmentUrl: '',
        profileFilterConfigured: false,
        selectedAlertingProfiles: [],
      },
      '/operations/assets/company': 'data:image/png;base64,AA==',
      '/privileged/session': SIGNED_OUT,
      '/knowledge/index-status': {
        state: 'idle',
        documentCount: 0,
        categoryCount: 0,
        lastIndexedAt: null,
      },
      '/knowledge/search': { ok: false, requestId: 'search-1', error: 'unavailable' },
      '/knowledge/upload/queue': {
        restartRecovery: false,
        activeBatchId: null,
        totalBytes: 0,
        acknowledgedBytes: 0,
        items: [],
      },
      '/operations/radar': RADAR_SNAPSHOT,
    };
    const { request, calls } = stubWebRequest((path) => routeResponses[path] ?? { ok: true });
    const actions = createBrowserActions({ executeCopy: () => true });
    const writeClipboard = vi.spyOn(actions, 'writeClipboard');
    const downloadText = vi.spyOn(actions, 'downloadText').mockReturnValue(true);
    const bridge = createWebBridge(SESSION, { request, actions });

    const deviceOnlyCapabilities = [
      'connectionConfiguration',
      'pocketBaseRecovery',
      'offlineCache',
      'offlineMutations',
      'nativeWindowControls',
      'customReminderSound',
      'imageClipboard',
    ] as const;
    for (const capability of deviceOnlyCapabilities) {
      expect(bridge.runtime.capabilities[capability], capability).toBe(false);
    }
    expect(bridge.runtime.capabilities.privilegedAccess).toBe(true);
    expect(bridge.runtime.capabilities.knowledgePublishing).toBe(true);

    await expect(bridge.createBackup()).resolves.toMatchObject({ success: false });
    await expect(bridge.mutateOffline({} as never)).resolves.toEqual({
      ok: false,
      error: 'Web access is online-only.',
    });
    await expect(bridge.selectReminderSound()).resolves.toMatchObject({ success: false });
    await expect(bridge.reselectKnowledgeUploadSource('upload-1')).resolves.toBe(false);

    await bridge.getCloudStatus();
    await bridge.listDynatraceDashboards();
    await bridge.getDynatraceProblemsSettings();
    await bridge.getCompanyLogo();
    await bridge.getPrivilegedSession();
    await bridge.getKnowledgeIndexStatus();
    await bridge.searchKnowledge({
      requestId: 'search-1',
      query: 'server',
      scope: { kind: 'all' },
      categoryId: null,
      documentType: null,
      limit: 10,
    });
    await bridge.getKnowledgeUploadQueue();
    await bridge.getRadarSnapshot();
    bridge.logToMain({ level: 'INFO', module: 'parity', message: 'contract' });
    bridge.notifyAlertDismissed('cloud-outage');
    await bridge.writeClipboard('bridge text');
    await bridge.saveAndOpenIcs('BEGIN:VCALENDAR\nEND:VCALENDAR');

    expect(calls.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        '/operations/cloud-status',
        '/operations/dynatrace-dashboards',
        '/operations/dynatrace-problems/settings',
        '/operations/assets/company',
        '/privileged/session',
        '/knowledge/index-status',
        '/knowledge/search',
        '/knowledge/upload/queue',
        '/operations/radar',
        '/operations/log',
        '/operations/alert-dismissed',
      ]),
    );
    expect(writeClipboard).toHaveBeenCalledWith('bridge text');
    expect(downloadText).toHaveBeenCalledWith(
      'BEGIN:VCALENDAR\nEND:VCALENDAR',
      'relay-schedule.ics',
      'text/calendar',
    );
  });

  it('uses exact routes and unsubscribes event listeners', async () => {
    const { request, calls } = stubWebRequest(() => EMPTY_STATUS);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const bridge = createWebBridge(SESSION, { request, subscribe });

    await bridge.getCloudStatus();
    expect(calls).toHaveBeenCalledWith('/operations/cloud-status', { method: 'GET' });

    const onChange = vi.fn();
    const cleanup = bridge.onDynatraceDashboardsChanged(onChange);
    expect(subscribe).toHaveBeenCalledWith('dynatrace-dashboards-changed', onChange);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('maps validated Radar reads, refresh, events, and original-page navigation', async () => {
    const { request, calls } = stubWebRequest(() => RADAR_SNAPSHOT);
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const openWindow = vi.fn(() => ({ opener: null }) as Window);
    const actions = createBrowserActions({ openWindow });
    const bridge = createWebBridge(SESSION, { request, subscribe, actions });

    await expect(bridge.getRadarSnapshot()).resolves.toEqual(RADAR_SNAPSHOT);
    await expect(bridge.refreshRadar()).resolves.toEqual(RADAR_SNAPSHOT);
    expect(calls.mock.calls).toEqual([
      ['/operations/radar', { method: 'GET' }],
      ['/operations/radar/refresh', { method: 'POST' }],
    ]);

    const onSnapshot = vi.fn();
    const cleanup = bridge.onRadarSnapshot(onSnapshot);
    expect(subscribe).toHaveBeenCalledWith('radar-snapshot-changed', onSnapshot);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();

    await expect(bridge.openExternal(RADAR_URL)).resolves.toBe(true);
    expect(openWindow).toHaveBeenCalledWith(RADAR_URL, '_blank', 'noopener,noreferrer');
  });

  it('rejects a malformed Radar response from the server', async () => {
    const { request } = stubWebRequest(() => ({ cookie: 'must-not-cross' }));
    const bridge = createWebBridge(SESSION, { request });

    await expect(bridge.getRadarSnapshot()).rejects.toThrow(
      'Relay Web returned an invalid response',
    );
  });

  it('maps protected actions onto exact privileged routes', async () => {
    const { request, calls } = stubWebRequest((path) => {
      if (path === '/privileged/session' || path === '/privileged/logout') return SIGNED_OUT;
      if (path === '/privileged/commands') {
        return { ok: true, requestId: 'request-1', value: { revision: 4 } };
      }
      return { ok: false, error: 'invalid-credentials' };
    });
    const bridge = createWebBridge(SESSION, { request });

    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake credential verifies the protected login route mapping.
    await bridge.loginPrivileged({ username: 'ryan', password: 'Test-access-value-123!' });
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake credential verifies the separate reauthentication route mapping.
    await bridge.reauthenticatePrivileged({ password: 'Test-access-value-123!' });
    await bridge.submitPrivilegedCommand({
      command: 'administration.snapshot.read',
      payload: {},
      expectedRevision: null,
    });
    await bridge.logoutPrivileged();

    expect(calls.mock.calls.map(([path]) => path)).toEqual([
      '/privileged/login',
      '/privileged/reauthenticate',
      '/privileged/commands',
      '/privileged/logout',
    ]);
  });

  it('streams selected browser PDFs and reads Knowledge binary responses', async () => {
    const file = new File(['%PDF-first!!'], 'Runbook.pdf', { type: 'application/pdf' });
    const actions = createBrowserActions({ pickPdfFiles: async () => [file] });
    const { request, calls } = stubWebRequest((path) => {
      if (path === '/knowledge/upload/begin') {
        return { batchId: 'batch-1', files: [{ id: 'file-1', name: file.name, size: file.size }] };
      }
      if (path === '/knowledge/upload/commit') return { ok: true, uploads: [] };
      return EMPTY_STATUS;
    });
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const bridge = createWebBridge(SESSION, { actions, request, fetcher });

    await expect(bridge.selectAndQueueKnowledgePdfs()).resolves.toEqual({
      ok: true,
      uploads: [],
    });
    expect(calls.mock.calls.map(([path]) => path)).toEqual([
      '/knowledge/upload/begin',
      '/knowledge/upload/commit',
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      '/relay-api/v1/knowledge/upload/chunk?fileId=file-1&offset=0',
      expect.objectContaining({ method: 'POST', body: expect.any(Blob) }),
    );

    fetcher.mockResolvedValueOnce(
      new Response('%PDF-first!!', {
        status: 200,
        headers: { 'x-relay-checksum': 'a'.repeat(64), 'x-relay-source': 'server' },
      }),
    );
    const pdf = await bridge.getKnowledgePdf({ documentId: 'doc-1', checksum: 'a'.repeat(64) });
    expect(pdf.ok && new TextDecoder().decode(pdf.data)).toBe('%PDF-first!!');
  });

  it('binds a single browser PDF upload to its replacement document', async () => {
    const file = new File(['%PDF-replace'], 'Different Filename.pdf', {
      type: 'application/pdf',
    });
    const actions = createBrowserActions({ pickPdfFiles: async () => [file] });
    const selectPdfs = vi.spyOn(actions, 'selectPdfs');
    const { request, calls } = stubWebRequest((path) => {
      if (path === '/knowledge/upload/begin') {
        return {
          batchId: 'batch-replacement',
          files: [{ id: 'file-replacement', name: file.name, size: file.size }],
        };
      }
      if (path === '/knowledge/upload/commit') return { ok: true, uploads: [] };
      return EMPTY_STATUS;
    });
    const bridge = createWebBridge(SESSION, {
      actions,
      request,
      fetcher: vi.fn(async () => new Response(null, { status: 200 })),
    });

    await expect(bridge.selectAndQueueKnowledgePdfs('document-target')).resolves.toEqual({
      ok: true,
      uploads: [],
    });

    expect(selectPdfs).toHaveBeenCalledWith(true);
    expect(calls).toHaveBeenCalledWith('/knowledge/upload/begin', {
      method: 'POST',
      body: {
        files: [{ name: file.name, size: file.size }],
        replacementDocumentId: 'document-target',
      },
    });
  });

  it('waits out a throttled chunk instead of discarding the whole upload', async () => {
    const file = new File(['%PDF-throttle'], 'Runbook.pdf', { type: 'application/pdf' });
    const actions = createBrowserActions({ pickPdfFiles: async () => [file] });
    const { request, calls } = stubWebRequest((path) => {
      if (path === '/knowledge/upload/begin') {
        return { batchId: 'batch-1', files: [{ id: 'file-1', name: file.name, size: file.size }] };
      }
      if (path === '/knowledge/upload/commit') return { ok: true, uploads: [] };
      return EMPTY_STATUS;
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const bridge = createWebBridge(SESSION, { actions, request, fetcher });

    const upload = bridge.selectAndQueueKnowledgePdfs();
    // The retried chunk waits out the advertised Retry-After before it is re-sent.
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2), { timeout: 5_000 });

    await expect(upload).resolves.toEqual({ ok: true, uploads: [] });
    expect(calls.mock.calls.map(([path]) => path)).toEqual([
      '/knowledge/upload/begin',
      '/knowledge/upload/commit',
    ]);
  });

  it('multiplexes subscriptions over one event stream and closes it when idle', () => {
    const instances: Array<{
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    class TestEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
      constructor(_url: string) {
        instances.push(this);
      }
    }
    const subscribe = createWebEventSubscriber(TestEventSource as unknown as typeof EventSource);

    const stopA = subscribe('alert-dismissed', vi.fn());
    const stopB = subscribe('dynatrace-dashboards-changed', vi.fn());
    expect(instances).toHaveLength(1);
    stopA();
    expect(instances[0]?.close).not.toHaveBeenCalled();
    stopB();
    expect(instances[0]?.close).toHaveBeenCalledOnce();
  });
});
