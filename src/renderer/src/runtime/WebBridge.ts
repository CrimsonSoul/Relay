import type { BridgeAPI, IpcResult, PbConnectionResult, PrivilegedIpcResult } from '@shared/ipc';
import { z } from 'zod';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  normalizeKnowledgeUploadQueueView,
  normalizeKnowledgeUploadSelectionResult,
  type KnowledgeCoverResult,
  type KnowledgePdfResult,
  type KnowledgeUploadSelectionResult,
} from '@shared/knowledge';
import { normalizeKnowledgeSearchResponse } from '@shared/knowledgeSearch';
import type { WebSessionBootstrap, WebSessionBootstrapResult } from '@shared/webApi';
import {
  RELAY_WEB_API_PREFIX,
  WebBrandAssetResultSchema,
  WebCloudStatusDataSchema,
  WebCountResultSchema,
  WebDynatraceDashboardStateSchema,
  WebDynatraceProblemsPublicSettingsSchema,
  WebDynatraceProblemsTestResultSchema,
  WebKnowledgeIndexStatusSchema,
  WebKnowledgeUploadStagingBatchSchema,
  WebPrivilegedCommandResultSchema,
  WebPrivilegedCredentialSetupViewSchema,
  WebPrivilegedPairingChallengeSchema,
  WebPrivilegedReauthenticationProofSchema,
  WebPrivilegedSessionSchema,
  WebSessionBootstrapResultSchema,
  webPrivilegedIpcResultSchema,
  webIpcResultSchema,
} from '@shared/webApi';
import { createBrowserActions, type BrowserActions } from './browserActions';

type RequestOptions = {
  method: 'GET' | 'POST';
  body?: unknown;
};

export type WebBridgeRequest = <T>(path: string, options: RequestOptions) => Promise<T>;
export type WebBridgeSubscribe = <T>(event: string, callback: (value: T) => void) => () => void;

type WebBridgeOptions = {
  fetcher?: typeof fetch;
  request?: WebBridgeRequest;
  subscribe?: WebBridgeSubscribe;
  actions?: BrowserActions;
  refreshSession?: () => Promise<WebSessionBootstrapResult>;
};

const EMPTY_UPLOAD_QUEUE = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
} as const;

function browserPlatform(): BridgeAPI['platform'] {
  return globalThis.navigator?.platform?.toLowerCase().includes('mac') ? 'darwin' : 'win32';
}

function unavailable<T = void>(message: string): IpcResult<T> {
  return { success: false, error: message };
}

function privilegedUnavailable<T>(): PrivilegedIpcResult<T> {
  return { ok: false, error: 'offline' };
}

function createRequest(session: WebSessionBootstrap, fetcher: typeof fetch): WebBridgeRequest {
  return async <T>(path: string, options: RequestOptions): Promise<T> => {
    const mutating = options.method !== 'GET';
    const response = await fetcher(`${RELAY_WEB_API_PREFIX}${path}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      method: options.method,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...(mutating
          ? { 'Content-Type': 'application/json', 'X-Relay-CSRF': session.csrfToken }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok) throw new Error('Relay Web request unavailable');
    return (await response.json()) as T;
  };
}

type KnowledgeBinaryKind = 'pdf' | 'cover';
type KnowledgeBinaryResult = KnowledgePdfResult | KnowledgeCoverResult;

function knowledgeDownloadError(kind: KnowledgeBinaryKind, value: unknown): KnowledgeBinaryResult {
  const safe = String(value);
  if (kind === 'pdf') {
    const errors: Array<Extract<KnowledgePdfResult, { ok: false }>['error']> = [
      'not-found',
      'not-available-offline',
      'invalid-document',
      'download-failed',
      'checksum-mismatch',
    ];
    return {
      ok: false,
      error: errors.includes(safe as (typeof errors)[number])
        ? (safe as (typeof errors)[number])
        : 'download-failed',
    };
  }
  const errors: Array<Extract<KnowledgeCoverResult, { ok: false }>['error']> = [
    'not-found',
    'not-available-offline',
    'invalid-document',
    'download-failed',
    'render-failed',
  ];
  return {
    ok: false,
    error: errors.includes(safe as (typeof errors)[number])
      ? (safe as (typeof errors)[number])
      : 'download-failed',
  };
}

async function knowledgeFailure(
  kind: KnowledgeBinaryKind,
  response: Response,
): Promise<KnowledgeBinaryResult> {
  try {
    const error = (await response.json()) as { error?: unknown };
    return knowledgeDownloadError(kind, error.error);
  } catch {
    return knowledgeDownloadError(kind, null);
  }
}

function knowledgeSuccess(
  kind: KnowledgeBinaryKind,
  data: ArrayBuffer,
  checksum: string,
  source: string | null,
): KnowledgeBinaryResult {
  if (kind === 'pdf') {
    return ['server', 'cache', 'download'].includes(source ?? '')
      ? {
          ok: true,
          data,
          checksum,
          source: source as Extract<KnowledgePdfResult, { ok: true }>['source'],
        }
      : { ok: false, error: 'download-failed' };
  }
  return ['server', 'cache', 'generated', 'download'].includes(source ?? '')
    ? {
        ok: true,
        data,
        checksum,
        source: source as Extract<KnowledgeCoverResult, { ok: true }>['source'],
      }
    : { ok: false, error: 'download-failed' };
}

async function knowledgeBinary(
  kind: KnowledgeBinaryKind,
  input: { documentId: string; checksum: string },
  fetcher: typeof fetch,
): Promise<KnowledgeBinaryResult> {
  const parameters = new URLSearchParams({
    documentId: input.documentId,
    checksum: input.checksum,
  });
  const response = await fetcher(`${RELAY_WEB_API_PREFIX}/knowledge/${kind}?${parameters}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    method: 'GET',
    redirect: 'error',
    headers: { Accept: kind === 'pdf' ? 'application/pdf' : 'image/png' },
  });
  if (!response.ok) return knowledgeFailure(kind, response);
  const checksum = response.headers.get('x-relay-checksum');
  const source = response.headers.get('x-relay-source');
  if (checksum !== input.checksum) return { ok: false, error: 'download-failed' };
  const data = await response.arrayBuffer();
  return knowledgeSuccess(kind, data, checksum, source);
}

function validSelectedPdfs(files: readonly File[]): boolean {
  if (files.length < 1 || files.length > KNOWLEDGE_UPLOAD_MAX_FILES) return false;
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    const name = file.name.toLocaleLowerCase('en');
    total += file.size;
    if (
      !name.endsWith('.pdf') ||
      file.size < 5 ||
      file.size > KNOWLEDGE_MAX_PDF_BYTES ||
      names.has(name) ||
      total > KNOWLEDGE_MAX_PDF_BYTES * KNOWLEDGE_UPLOAD_MAX_FILES
    ) {
      return false;
    }
    names.add(name);
  }
  return true;
}

async function uploadKnowledgePdfs(
  files: readonly File[],
  request: WebBridgeRequest,
  fetcher: typeof fetch,
  csrfToken: string,
): Promise<KnowledgeUploadSelectionResult> {
  if (!validSelectedPdfs(files)) return { ok: false, error: 'invalid-file' };
  let batchId: string | null = null;
  try {
    const batch = WebKnowledgeUploadStagingBatchSchema.parse(
      await request('/knowledge/upload/begin', {
        method: 'POST',
        body: { files: files.map((file) => ({ name: file.name, size: file.size })) },
      }),
    );
    batchId = batch.batchId;
    if (
      batch.files.length !== files.length ||
      batch.files.some(
        (staged, index) => staged.name !== files[index]?.name || staged.size !== files[index]?.size,
      )
    ) {
      throw new Error('invalid-staging-response');
    }
    for (const [fileIndex, file] of files.entries()) {
      const staged = batch.files[fileIndex]!;
      for (let offset = 0; offset < file.size; offset += KNOWLEDGE_UPLOAD_CHUNK_BYTES) {
        const body = file.slice(offset, Math.min(file.size, offset + KNOWLEDGE_UPLOAD_CHUNK_BYTES));
        const parameters = new URLSearchParams({ fileId: staged.id, offset: String(offset) });
        const response = await fetcher(
          `${RELAY_WEB_API_PREFIX}/knowledge/upload/chunk?${parameters}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            method: 'POST',
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/octet-stream',
              'X-Relay-CSRF': csrfToken,
            },
            body,
          },
        );
        if (!response.ok) throw new Error('chunk-rejected');
      }
    }
    const result = normalizeKnowledgeUploadSelectionResult(
      await request('/knowledge/upload/commit', { method: 'POST', body: { batchId } }),
    );
    return result ?? { ok: false, error: 'upload-failed' };
  } catch {
    if (batchId) {
      void request('/knowledge/upload/abort', { method: 'POST', body: { batchId } }).catch(
        () => undefined,
      );
    }
    return { ok: false, error: 'upload-failed' };
  }
}

export function createWebEventSubscriber(
  EventSourceConstructor?: typeof EventSource,
): WebBridgeSubscribe {
  let source: EventSource | null = null;
  let listenerCount = 0;
  return <T>(event: string, callback: (value: T) => void): (() => void) => {
    const Source = EventSourceConstructor ?? globalThis.EventSource;
    if (!Source) return () => undefined;
    source ??= new Source(`${RELAY_WEB_API_PREFIX}/session/events`);
    const activeSource = source;
    const listener = (message: MessageEvent<string>) => {
      try {
        callback(JSON.parse(message.data) as T);
      } catch {
        // Ignore malformed or stale event payloads.
      }
    };
    activeSource.addEventListener(event, listener as EventListener);
    listenerCount += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      activeSource.removeEventListener(event, listener as EventListener);
      listenerCount -= 1;
      if (listenerCount === 0 && source === activeSource) {
        activeSource.close();
        source = null;
      }
    };
  };
}

function dataUrlExtension(dataUrl: string): string {
  return dataUrl.startsWith('data:image/png') ? 'png' : 'bin';
}

async function validatedRequest<T>(
  request: WebBridgeRequest,
  path: string,
  options: RequestOptions,
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await request(path, options));
  if (!parsed.success) throw new Error('Relay Web returned an invalid response');
  return parsed.data;
}

async function uploadLogo(
  kind: 'company' | 'footer',
  request: WebBridgeRequest,
  actions: BrowserActions,
): Promise<IpcResult<string>> {
  const dataUrl = await actions.selectImage(2 * 1024 * 1024);
  if (!dataUrl) return unavailable('Cancelled');
  try {
    return await request<IpcResult<string>>(`/operations/assets/${kind}/save`, {
      method: 'POST',
      body: { dataUrl },
    });
  } catch {
    return unavailable('Could not save the selected image.');
  }
}

export function createWebBridge(
  session: WebSessionBootstrap,
  options: WebBridgeOptions = {},
): BridgeAPI {
  const fetcher = options.fetcher ?? fetch;
  const request = options.request ?? createRequest(session, fetcher);
  const subscribe = options.subscribe ?? createWebEventSubscriber();
  const actions = options.actions ?? createBrowserActions();
  const connection = (): PbConnectionResult => ({
    ok: true,
    connection: { pbUrl: session.pbUrl, auth: session.auth },
  });
  const noopSubscription = () => () => undefined;

  const bridge = {
    runtime: session.runtime,
    platform: browserPlatform(),
    openPath: async () => undefined,
    openExternal: async (url) => actions.openExternal(url),
    onAuthRequested: noopSubscription,
    submitAuth: async () => false,
    cancelAuth: () => undefined,
    useCachedAuth: async () => false,
    logBridge: (groups) => {
      void request('/operations/log', {
        method: 'POST',
        body: { level: 'INFO', module: 'bridge', message: 'Bridge generated', data: { groups } },
      }).catch(() => undefined);
    },
    getCloudStatus: () =>
      validatedRequest(
        request,
        '/operations/cloud-status',
        { method: 'GET' },
        WebCloudStatusDataSchema,
      ),
    listDynatraceDashboards: () =>
      validatedRequest(
        request,
        '/operations/dynatrace-dashboards',
        { method: 'GET' },
        z.array(WebDynatraceDashboardStateSchema),
      ),
    addDynatraceDashboard: (input) =>
      validatedRequest(
        request,
        '/operations/dynatrace-dashboards/add',
        { method: 'POST', body: input },
        webIpcResultSchema(WebDynatraceDashboardStateSchema),
      ),
    updateDynatraceDashboard: (id, input) =>
      validatedRequest(
        request,
        '/operations/dynatrace-dashboards/update',
        { method: 'POST', body: { id, input } },
        webIpcResultSchema(WebDynatraceDashboardStateSchema),
      ),
    removeDynatraceDashboard: (id) =>
      validatedRequest(
        request,
        '/operations/dynatrace-dashboards/remove',
        { method: 'POST', body: { id } },
        webIpcResultSchema(z.never()),
      ),
    openDynatraceDashboard: (id) =>
      request<{ url?: string }>('/operations/dynatrace-dashboards/open', {
        method: 'POST',
        body: { id },
      })
        .then((result) => (result.url ? actions.openExternal(result.url) : false))
        .catch(() => false),
    clearDynatraceSession: async () =>
      unavailable('Use Dynatrace sign out in this browser to clear its session.'),
    onDynatraceDashboardsChanged: (callback) => subscribe('dynatrace-dashboards-changed', callback),
    getDynatraceProblemsSettings: () =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/settings',
        { method: 'GET' },
        WebDynatraceProblemsPublicSettingsSchema,
      ),
    saveDynatraceProblemsSettings: (input) =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/settings/save',
        { method: 'POST', body: input },
        webIpcResultSchema(WebDynatraceProblemsPublicSettingsSchema),
      ),
    testDynatraceProblemsSettings: (input) =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/settings/test',
        { method: 'POST', body: input },
        webIpcResultSchema(WebDynatraceProblemsTestResultSchema),
      ),
    clearDynatraceProblemsSettings: () =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/settings/clear',
        { method: 'POST' },
        webIpcResultSchema(z.never()),
      ),
    syncDynatraceProblems: () =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/sync',
        { method: 'POST' },
        webIpcResultSchema(WebCountResultSchema),
      ),
    saveDynatraceProblemProfileFilter: (alertingProfiles) =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/profile-filter',
        { method: 'POST', body: { alertingProfiles } },
        webIpcResultSchema(WebCountResultSchema),
      ),
    getPrivilegedSession: () =>
      validatedRequest(
        request,
        '/privileged/session',
        { method: 'GET' },
        WebPrivilegedSessionSchema,
      ),
    loginPrivileged: (input) =>
      validatedRequest(
        request,
        '/privileged/login',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedSessionSchema),
      ),
    logoutPrivileged: () =>
      validatedRequest(
        request,
        '/privileged/logout',
        { method: 'POST' },
        WebPrivilegedSessionSchema,
      ),
    reauthenticatePrivileged: (input) =>
      validatedRequest(
        request,
        '/privileged/reauthenticate',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedReauthenticationProofSchema),
      ),
    createPrivilegedPairingChallenge: (targetAccountId) =>
      validatedRequest(
        request,
        '/privileged/pairing-challenge',
        { method: 'POST', body: { targetAccountId } },
        webPrivilegedIpcResultSchema(WebPrivilegedPairingChallengeSchema),
      ),
    completePrivilegedPairing: async () => privilegedUnavailable(),
    submitPrivilegedCommand: (input) =>
      validatedRequest(
        request,
        '/privileged/commands',
        { method: 'POST', body: input },
        WebPrivilegedCommandResultSchema,
      ),
    setupInitialAdministratorCredential: (input) =>
      validatedRequest(
        request,
        '/privileged/initial-owner',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedCredentialSetupViewSchema),
      ),
    setupPrivilegedCredential: (input) =>
      validatedRequest(
        request,
        '/privileged/credential',
        { method: 'POST', body: input },
        webPrivilegedIpcResultSchema(WebPrivilegedCredentialSetupViewSchema),
      ),
    onPrivilegedSessionChanged: (callback) => subscribe('privileged-session-changed', callback),
    listWebApprovalRequests: async () => [],
    generateWebApprovalCode: async () => ({ ok: false, error: 'unauthorized' }),
    cancelWebApprovalRequest: async () => false,
    onWebApprovalRequestsChanged: noopSubscription,
    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined,
    isMaximized: async () => false,
    onMaximizeChange: noopSubscription,
    onErrorNotification: (callback) => subscribe('error-notification', callback),
    onPbCrashed: (callback) => subscribe('pb-crashed', callback),
    openAuxWindow: (route) => {
      actions.openAuxWindow(route);
    },
    logToMain: (entry) => {
      void request('/operations/log', { method: 'POST', body: entry }).catch(() => undefined);
    },
    notifyDragStart: () => undefined,
    notifyDragStop: () => undefined,
    onDragStateChange: noopSubscription,
    notifyAlertDismissed: (type) => {
      void request('/operations/alert-dismissed', { method: 'POST', body: { type } }).catch(
        () => undefined,
      );
    },
    onAlertDismissed: (callback) => subscribe('alert-dismissed', callback),
    writeClipboard: async (text) => actions.writeClipboard(text),
    optimizeAlertImage: async (dataUrl) => ({ success: true, data: dataUrl }),
    playAlertSound: () => actions.playBuiltInAlert(),
    selectReminderSound: async () => unavailable('Custom sounds are available in Relay Desktop.'),
    saveAlertImage: async (dataUrl, suggestedName) =>
      actions.downloadDataUrl(dataUrl, suggestedName)
        ? { success: true, data: sanitizeDownloadResult(suggestedName, dataUrl) }
        : unavailable('The alert image could not be downloaded.'),
    selectAlertBodyImage: async () => {
      const dataUrl = await actions.selectImage(5 * 1024 * 1024);
      return dataUrl ? { success: true, data: dataUrl } : unavailable('Cancelled');
    },
    saveAndOpenAlertDraft: async (content) =>
      actions.downloadText(content, 'relay-alert.eml', 'message/rfc822'),
    saveAndOpenIcs: async (content) =>
      actions.downloadText(content, 'relay-schedule.ics', 'text/calendar'),
    saveCompanyLogo: () => uploadLogo('company', request, actions),
    getCompanyLogo: () =>
      validatedRequest(
        request,
        '/operations/assets/company',
        { method: 'GET' },
        WebBrandAssetResultSchema,
      ),
    removeCompanyLogo: () => request('/operations/assets/company/remove', { method: 'POST' }),
    saveFooterLogo: () => uploadLogo('footer', request, actions),
    getFooterLogo: () =>
      validatedRequest(
        request,
        '/operations/assets/footer',
        { method: 'GET' },
        WebBrandAssetResultSchema,
      ),
    removeFooterLogo: () => request('/operations/assets/footer/remove', { method: 'POST' }),
    getConfig: async () => session.publicConfig,
    getConnectionSecret: async () => null,
    getClientHostname: async () => globalThis.location?.hostname ?? null,
    saveConfig: async () => false,
    clearConfig: async () => false,
    isConfigured: async () => true,
    testConnection: async () => ({ ok: false, error: 'unreachable' }),
    discoverServers: async () => [],
    getWebServerState: async () => ({
      enabled: true,
      status: 'available',
      port: globalThis.location?.port ? Number(globalThis.location.port) : 8091,
      url: globalThis.location?.origin,
    }),
    saveWebServerConfig: async () => unavailable('Configure Relay Web in Relay Desktop.'),
    retryWebServer: async () => unavailable('Restart Relay Web from Relay Desktop.'),
    cacheRead: async () => [],
    cacheWrite: async () => undefined,
    cacheSnapshot: async () => undefined,
    mutateOffline: async () => ({ ok: false, error: 'Web access is online-only.' }),
    onOfflineMutationApplied: noopSubscription,
    getPendingSyncStatus: async () => ({ pendingCount: 0 }),
    onPendingSyncStatusChanged: noopSubscription,
    getKnowledgePdf: async (input) => {
      const result = await knowledgeBinary('pdf', input, fetcher);
      return result as KnowledgePdfResult;
    },
    getKnowledgeCover: async (input) => {
      const result = await knowledgeBinary('cover', input, fetcher);
      return result as KnowledgeCoverResult;
    },
    getKnowledgeIndexStatus: () =>
      validatedRequest(
        request,
        '/knowledge/index-status',
        { method: 'GET' },
        WebKnowledgeIndexStatusSchema,
      ),
    searchKnowledge: async (input) =>
      normalizeKnowledgeSearchResponse(
        await request('/knowledge/search', { method: 'POST', body: input }),
      ) ?? { ok: false, requestId: input.requestId, error: 'unavailable' },
    cancelKnowledgeSearch: (requestId) => {
      void request('/knowledge/search/cancel', { method: 'POST', body: { requestId } }).catch(
        () => undefined,
      );
    },
    onKnowledgeIndexStatusChanged: (callback) =>
      subscribe('knowledge-index-status-changed', callback),
    openKnowledgeWebLink: async (url) =>
      actions.openExternal(url) ? { ok: true } : { ok: false, error: 'invalid-url' },
    selectAndQueueKnowledgePdfs: async () => {
      const files = await actions.selectPdfs();
      return files.length
        ? uploadKnowledgePdfs(files, request, fetcher, session.csrfToken)
        : { ok: false, error: 'cancelled' };
    },
    getKnowledgeUploadQueue: async () =>
      normalizeKnowledgeUploadQueueView(
        await request('/knowledge/upload/queue', { method: 'GET' }),
      ) ?? EMPTY_UPLOAD_QUEUE,
    pauseKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/pause-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    resumeKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/resume-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    retryKnowledgeUpload: (id) =>
      request<boolean>('/knowledge/upload/retry-upload', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    reselectKnowledgeUploadSource: async () => false,
    cancelKnowledgeUpload: (id) =>
      request<boolean>('/knowledge/upload/cancel-upload', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    cancelKnowledgeUploadBatch: (id) =>
      request<boolean>('/knowledge/upload/cancel-batch', { method: 'POST', body: { id } }).catch(
        () => false,
      ),
    onKnowledgeUploadQueueChanged: (callback) =>
      subscribe('knowledge-upload-queue-changed', callback),
    syncPending: async () => ({ total: 0, conflicts: 0, errors: [], remaining: 0 }),
    getPbConnection: async () => connection(),
    refreshPbConnection: async () => {
      if (!options.refreshSession) return connection();
      const result = WebSessionBootstrapResultSchema.safeParse(await options.refreshSession());
      return result.success && result.data.ok
        ? {
            ok: true,
            connection: { pbUrl: result.data.session.pbUrl, auth: result.data.session.auth },
          }
        : { ok: false, error: 'auth-failed' };
    },
    startPocketBase: async () => false,
    relaunchApp: async () => undefined,
    listBackups: async () => [],
    createBackup: async () => unavailable('Backups are available in Relay Desktop.'),
    restoreBackup: async () => unavailable('Restore is available in Relay Desktop.'),
  } satisfies BridgeAPI;

  return bridge;
}

function sanitizeDownloadResult(suggestedName: string, dataUrl: string): string {
  const base = suggestedName.replace(/\.[^.]*$/u, '') || 'relay-alert';
  return `${base}.${dataUrlExtension(dataUrl)}`;
}
