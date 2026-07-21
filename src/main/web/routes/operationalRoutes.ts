import { z } from 'zod';
import type { CloudStatusData, IpcResult, LogEntry } from '@shared/ipc';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import {
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
  type DynatraceProblemsTestResult,
} from '@shared/dynatraceProblems';
import { LogEntrySchema } from '@shared/ipcValidation';
import {
  RELAY_WEB_API_PREFIX,
  WebBrandAssetInputSchema,
  WebDynatraceDashboardIdSchema,
  WebDynatraceDashboardInputSchema,
  WebDynatraceDashboardUpdateSchema,
  WebDynatraceProblemProfileFilterSchema,
  WebDynatraceProblemsSettingsInputSchema,
} from '@shared/webApi';
import type { WebSessionStore } from '../WebSessionStore';
import type { WebRouter } from '../WebRouter';

export type BrandAssetKind = 'company' | 'footer';

export type OperationalServices = {
  cloudStatus: {
    refresh: () => Promise<CloudStatusData>;
  };
  dashboards: {
    list: () => DynatraceDashboardState[];
    add: (input: DynatraceDashboardInput) => IpcResult<DynatraceDashboardState>;
    update: (id: string, input: DynatraceDashboardInput) => IpcResult<DynatraceDashboardState>;
    remove: (id: string) => IpcResult;
    url: (id: string) => string | null;
    onChange?: (listener: (dashboards: DynatraceDashboardState[]) => void) => () => void;
  };
  problems: {
    getSettings: () => DynatraceProblemsPublicSettings;
    saveSettings: (
      input: DynatraceProblemsSettingsInput,
    ) => IpcResult<DynatraceProblemsPublicSettings>;
    testSettings: (
      input: DynatraceProblemsSettingsInput,
    ) => Promise<IpcResult<DynatraceProblemsTestResult>>;
    clearSettings: () => IpcResult;
    sync: () => Promise<IpcResult<{ count: number }>>;
    saveProfileFilter: (profiles: string[]) => Promise<IpcResult<{ count: number }>>;
  };
  assets: {
    get: (kind: BrandAssetKind) => Promise<string | null>;
    save: (kind: BrandAssetKind, dataUrl: string) => Promise<IpcResult<string>>;
    remove: (kind: BrandAssetKind) => Promise<IpcResult>;
  };
  log: (entry: LogEntry) => void;
};

type OperationalRouteOptions = {
  services: OperationalServices;
  sessions: WebSessionStore;
};

const dismissedSchema = z.object({ type: z.string().trim().min(1).max(128) }).strict();

const mutationLimit = {
  key: 'session' as const,
  limit: 30,
  windowMs: 60_000,
};

export function registerOperationalRoutes(
  router: WebRouter,
  { services, sessions }: OperationalRouteOptions,
): void {
  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/operations/cloud-status`,
    authenticated: true,
    rateLimit: { bucket: 'cloud-status', key: 'session', limit: 12, windowMs: 60_000 },
    handler: async () => ({ status: 200, body: await services.cloudStatus.refresh() }),
  });

  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-dashboards`,
    authenticated: true,
    handler: async () => ({ status: 200, body: services.dashboards.list() }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-dashboards/add`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceDashboardInputSchema,
    maxBodyBytes: 4_096,
    rateLimit: { bucket: 'dashboard-add', ...mutationLimit },
    handler: async ({ body }) => ({ status: 200, body: services.dashboards.add(body) }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-dashboards/update`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceDashboardUpdateSchema,
    maxBodyBytes: 4_096,
    rateLimit: { bucket: 'dashboard-update', ...mutationLimit },
    handler: async ({ body }) => ({
      status: 200,
      body: services.dashboards.update(body.id, body.input),
    }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-dashboards/remove`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceDashboardIdSchema,
    maxBodyBytes: 1_024,
    rateLimit: { bucket: 'dashboard-remove', ...mutationLimit },
    handler: async ({ body }) => ({ status: 200, body: services.dashboards.remove(body.id) }),
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-dashboards/open`,
    authenticated: true,
    csrf: true,
    bodySchema: WebDynatraceDashboardIdSchema,
    maxBodyBytes: 1_024,
    rateLimit: { bucket: 'dashboard-open', key: 'session', limit: 60, windowMs: 60_000 },
    handler: async ({ body }) => ({ status: 200, body: { url: services.dashboards.url(body.id) } }),
  });

  registerProblemsRoutes(router, services);
  registerAssetRoutes(router, services);

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/log`,
    authenticated: true,
    csrf: true,
    bodySchema: LogEntrySchema.strict(),
    maxBodyBytes: 16_384,
    rateLimit: { bucket: 'browser-log', key: 'session', limit: 120, windowMs: 60_000 },
    handler: async ({ body }) => {
      services.log(body);
      return { status: 200, body: { ok: true } };
    },
  });

  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/alert-dismissed`,
    authenticated: true,
    csrf: true,
    bodySchema: dismissedSchema,
    maxBodyBytes: 1_024,
    rateLimit: { bucket: 'alert-dismissed', ...mutationLimit },
    handler: async ({ body }) => {
      sessions.publishAll('alert-dismissed', body.type);
      return { status: 200, body: { ok: true } };
    },
  });
}

function registerProblemsRoutes(router: WebRouter, services: OperationalServices): void {
  router.register({
    method: 'GET',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-problems/settings`,
    authenticated: true,
    capability: 'settings.manage',
    handler: async () => ({ status: 200, body: services.problems.getSettings() }),
  });
  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-problems/settings/save`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceProblemsSettingsInputSchema,
    maxBodyBytes: 8_192,
    rateLimit: { bucket: 'problems-settings-save', ...mutationLimit },
    handler: async ({ body }) => ({ status: 200, body: services.problems.saveSettings(body) }),
  });
  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-problems/settings/test`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceProblemsSettingsInputSchema,
    maxBodyBytes: 8_192,
    rateLimit: { bucket: 'problems-settings-test', key: 'session', limit: 10, windowMs: 60_000 },
    handler: async ({ body }) => ({
      status: 200,
      body: await services.problems.testSettings(body),
    }),
  });
  for (const [path, bucket, invoke] of [
    ['settings/clear', 'problems-settings-clear', () => services.problems.clearSettings()],
    ['sync', 'problems-sync', () => services.problems.sync()],
  ] as const) {
    router.register({
      method: 'POST',
      path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-problems/${path}`,
      authenticated: true,
      csrf: true,
      capability: 'settings.manage',
      rateLimit: { bucket, ...mutationLimit },
      handler: async () => ({ status: 200, body: await invoke() }),
    });
  }
  router.register({
    method: 'POST',
    path: `${RELAY_WEB_API_PREFIX}/operations/dynatrace-problems/profile-filter`,
    authenticated: true,
    csrf: true,
    capability: 'settings.manage',
    bodySchema: WebDynatraceProblemProfileFilterSchema,
    maxBodyBytes: 128 * 1024,
    rateLimit: { bucket: 'problems-profile-filter', ...mutationLimit },
    handler: async ({ body }) => ({
      status: 200,
      body: await services.problems.saveProfileFilter(body.alertingProfiles),
    }),
  });
}

function registerAssetRoutes(router: WebRouter, services: OperationalServices): void {
  for (const kind of ['company', 'footer'] as const) {
    router.register({
      method: 'GET',
      path: `${RELAY_WEB_API_PREFIX}/operations/assets/${kind}`,
      authenticated: true,
      handler: async () => ({ status: 200, body: await services.assets.get(kind) }),
    });
    router.register({
      method: 'POST',
      path: `${RELAY_WEB_API_PREFIX}/operations/assets/${kind}/save`,
      authenticated: true,
      csrf: true,
      bodySchema: WebBrandAssetInputSchema,
      maxBodyBytes: 2_900_000,
      rateLimit: { bucket: `asset-${kind}-save`, key: 'session', limit: 10, windowMs: 60_000 },
      handler: async ({ body }) => ({
        status: 200,
        body: await services.assets.save(kind, body.dataUrl),
      }),
    });
    router.register({
      method: 'POST',
      path: `${RELAY_WEB_API_PREFIX}/operations/assets/${kind}/remove`,
      authenticated: true,
      csrf: true,
      rateLimit: { bucket: `asset-${kind}-remove`, ...mutationLimit },
      handler: async () => ({ status: 200, body: await services.assets.remove(kind) }),
    });
  }
}
