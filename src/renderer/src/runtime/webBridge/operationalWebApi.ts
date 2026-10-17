import type { BridgeAPI, IpcResult } from '@shared/ipc';
import { normalizeServiceDeskUrl } from '@shared/urlSecurity';
import {
  WebBrandAssetResultSchema,
  WebCloudStatusDataSchema,
  WebCountResultSchema,
  WebDynatraceDashboardStateSchema,
  WebRadarSnapshotSchema,
  webIpcResultSchema,
} from '@shared/webApi';
import { z } from 'zod';
import {
  browserPlatform,
  unavailable,
  validatedRequest,
  type WebBridgeContext,
  type WebBridgeRequest,
} from './context';
import type { BrowserActions } from '../browserActions';
import { prepareAlertBodyImage } from '../../utils/alertBodyImage';

export type OperationalWebApi = Pick<
  BridgeAPI,
  | 'runtime'
  | 'platform'
  | 'openExternal'
  | 'openServiceDeskUrl'
  | 'getCloudStatus'
  | 'listDynatraceDashboards'
  | 'addDynatraceDashboard'
  | 'updateDynatraceDashboard'
  | 'removeDynatraceDashboard'
  | 'openDynatraceDashboard'
  | 'clearDynatraceSession'
  | 'onDynatraceDashboardsChanged'
  | 'syncDynatraceProblems'
  | 'getRadarSnapshot'
  | 'refreshRadar'
  | 'openRadarSignIn'
  | 'onRadarSnapshot'
  | 'onErrorNotification'
  | 'onPbCrashed'
  | 'logToMain'
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

// Decodes in place: Relay Web's connect-src does not allow fetching data: URLs.
function dataUrlBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new TypeError('Unsupported image data');
  return new Blob([Uint8Array.from(atob(match[2]!), (char) => char.codePointAt(0)!)], {
    type: match[1],
  });
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
    syncDynatraceProblems: () =>
      validatedRequest(
        request,
        '/operations/dynatrace-problems/sync',
        { method: 'POST' },
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
      if (!dataUrl) return unavailable('Cancelled');
      // The desktop picker scales in the main process; the browser scales here to the same width
      // so a full-resolution file stays under the body sanitizer's data-image bound.
      try {
        return { success: true, data: await prepareAlertBodyImage(dataUrlBlob(dataUrl)) };
      } catch {
        return unavailable('Could not read this image.');
      }
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
