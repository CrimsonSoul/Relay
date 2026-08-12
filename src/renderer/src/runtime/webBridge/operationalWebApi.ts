import type { BridgeAPI, IpcResult } from '@shared/ipc';
import { normalizeServiceDeskUrl } from '@shared/urlSecurity';
import {
  WebBrandAssetResultSchema,
  WebCloudStatusDataSchema,
  WebCountResultSchema,
  WebDynatraceDashboardStateSchema,
  WebDynatraceProblemsPublicSettingsSchema,
  WebDynatraceProblemsTestResultSchema,
  WebRadarSnapshotSchema,
  webIpcResultSchema,
} from '@shared/webApi';
import { z } from 'zod';
import {
  browserPlatform,
  noopSubscription,
  unavailable,
  validatedRequest,
  type WebBridgeContext,
  type WebBridgeRequest,
} from './context';
import type { BrowserActions } from '../browserActions';

export type OperationalWebApi = Pick<
  BridgeAPI,
  | 'runtime'
  | 'platform'
  | 'openExternal'
  | 'openServiceDeskUrl'
  | 'onAuthRequested'
  | 'submitAuth'
  | 'cancelAuth'
  | 'useCachedAuth'
  | 'logBridge'
  | 'getCloudStatus'
  | 'listDynatraceDashboards'
  | 'addDynatraceDashboard'
  | 'updateDynatraceDashboard'
  | 'removeDynatraceDashboard'
  | 'openDynatraceDashboard'
  | 'clearDynatraceSession'
  | 'onDynatraceDashboardsChanged'
  | 'getDynatraceProblemsSettings'
  | 'saveDynatraceProblemsSettings'
  | 'testDynatraceProblemsSettings'
  | 'clearDynatraceProblemsSettings'
  | 'syncDynatraceProblems'
  | 'saveDynatraceProblemProfileFilter'
  | 'getRadarSnapshot'
  | 'refreshRadar'
  | 'openRadarSignIn'
  | 'onRadarSnapshot'
  | 'onErrorNotification'
  | 'onPbCrashed'
  | 'logToMain'
  | 'notifyDragStart'
  | 'notifyDragStop'
  | 'onDragStateChange'
  | 'notifyAlertDismissed'
  | 'onAlertDismissed'
  | 'writeClipboard'
  | 'optimizeAlertImage'
  | 'playAlertSound'
  | 'selectReminderSound'
  | 'saveAlertImage'
  | 'selectAlertBodyImage'
  | 'saveAndOpenAlertDraft'
  | 'saveAndOpenIcs'
  | 'saveCompanyLogo'
  | 'getCompanyLogo'
  | 'removeCompanyLogo'
  | 'saveFooterLogo'
  | 'getFooterLogo'
  | 'removeFooterLogo'
>;

function dataUrlExtension(dataUrl: string): string {
  return dataUrl.startsWith('data:image/png') ? 'png' : 'bin';
}

function sanitizeDownloadResult(suggestedName: string, dataUrl: string): string {
  const base = suggestedName.replace(/\.[^.]*$/u, '') || 'relay-alert';
  return `${base}.${dataUrlExtension(dataUrl)}`;
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

export function createOperationalWebApi({
  session,
  request,
  subscribe,
  actions,
}: WebBridgeContext): OperationalWebApi {
  return {
    runtime: session.runtime,
    platform: browserPlatform(),
    openExternal: async (url) => actions.openExternal(url),
    openServiceDeskUrl: async (url) => {
      const normalized = normalizeServiceDeskUrl(url);
      return normalized ? actions.openExternal(normalized) : false;
    },
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
    getRadarSnapshot: () =>
      validatedRequest(request, '/operations/radar', { method: 'GET' }, WebRadarSnapshotSchema),
    refreshRadar: () =>
      validatedRequest(
        request,
        '/operations/radar/refresh',
        { method: 'POST' },
        WebRadarSnapshotSchema,
      ),
    openRadarSignIn: async () => false,
    onRadarSnapshot: (callback) => subscribe('radar-snapshot-changed', callback),
    onErrorNotification: (callback) => subscribe('error-notification', callback),
    onPbCrashed: (callback) => subscribe('pb-crashed', callback),
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
  } satisfies OperationalWebApi;
}
