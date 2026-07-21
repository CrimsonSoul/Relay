import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { nativeImage } from 'electron';
import type { CloudStatusData, IpcResult, LogEntry } from '@shared/ipc';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import {
  MAX_DYNATRACE_ALERTING_PROFILES,
  MAX_DYNATRACE_ALERTING_PROFILE_LENGTH,
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
  type DynatraceProblemsTestResult,
} from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';
import type { AppConfig } from '../config/AppConfig';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import type { DynatraceWindowManager } from '../dynatrace/DynatraceWindowManager';
import type { CloudStatusManager } from '../handlers/cloudStatus/CloudStatusManager';
import {
  emptyCloudStatusProviders,
  fetchCloudStatusData,
} from '../handlers/cloudStatus/fetchCloudStatus';
import { loggers } from '../logger';
import type { BrandAssetKind, OperationalServices } from '../web/routes/operationalRoutes';

const MANUAL_CACHE_TTL_MS = 60_000;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_WIDTH = 400;

const unavailableSettings: DynatraceProblemsPublicSettings = {
  configured: false,
  environmentUrl: '',
  profileFilterConfigured: false,
  selectedAlertingProfiles: [],
};

function failure<T = void>(error: unknown): IpcResult<T> {
  return { success: false, error: getErrorMessage(error) };
}

export class CloudStatusService {
  private manualCache: { data: CloudStatusData; fetchedAt: number } | null = null;

  constructor(
    private readonly getManager: () => CloudStatusManager | null,
    private readonly fetchStatus = fetchCloudStatusData,
    private readonly now = Date.now,
  ) {}

  snapshot(): CloudStatusData {
    return (
      this.getManager()?.getSnapshot() ??
      this.manualCache?.data ?? {
        providers: emptyCloudStatusProviders(),
        lastUpdated: 0,
        errors: [],
      }
    );
  }

  async refresh(): Promise<CloudStatusData> {
    const manager = this.getManager();
    if (manager) return manager.refresh({ force: true });
    if (this.manualCache && this.now() - this.manualCache.fetchedAt < MANUAL_CACHE_TTL_MS) {
      return this.manualCache.data;
    }
    try {
      const data = await this.fetchStatus(this.manualCache?.data);
      this.manualCache = { data, fetchedAt: this.now() };
      return data;
    } catch (error) {
      loggers.cloudStatus.error('Failed to fetch cloud status', { error });
      return this.snapshot();
    }
  }
}

export class DynatraceDashboardService {
  constructor(private readonly getManager: () => DynatraceWindowManager | null) {}

  list(): DynatraceDashboardState[] {
    return this.getManager()?.listDashboards() ?? [];
  }

  add(input: DynatraceDashboardInput): IpcResult<DynatraceDashboardState> {
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace manager not available');
    try {
      return { success: true, data: manager.addDashboard(input) };
    } catch (error) {
      return failure(error);
    }
  }

  update(id: string, input: DynatraceDashboardInput): IpcResult<DynatraceDashboardState> {
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace manager not available');
    try {
      const dashboard = manager.updateDashboard(id, input);
      return dashboard
        ? { success: true, data: dashboard }
        : failure('Dynatrace dashboard not found');
    } catch (error) {
      return failure(error);
    }
  }

  remove(id: string): IpcResult {
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace manager not available');
    try {
      return manager.removeDashboard(id)
        ? { success: true }
        : failure('Dynatrace dashboard not found');
    } catch (error) {
      return failure(error);
    }
  }

  url(id: string): string | null {
    return this.list().find((dashboard) => dashboard.id === id)?.url ?? null;
  }

  async open(id: string): Promise<boolean> {
    try {
      return (await this.getManager()?.openDashboard(id)) ?? false;
    } catch {
      return false;
    }
  }

  async clearSession(): Promise<IpcResult> {
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace manager not available');
    try {
      await manager.clearSession();
      return { success: true };
    } catch (error) {
      return failure(error);
    }
  }

  onChange(listener: (dashboards: DynatraceDashboardState[]) => void): () => void {
    return this.getManager()?.onStateChange(listener) ?? (() => undefined);
  }
}

export class DynatraceProblemsService {
  constructor(
    private readonly getManager: () => DynatraceProblemsManager | null,
    private readonly getAppConfig: () => AppConfig | null,
  ) {}

  getSettings(): DynatraceProblemsPublicSettings {
    return this.isServer()
      ? (this.getManager()?.getSettings() ?? unavailableSettings)
      : unavailableSettings;
  }

  saveSettings(input: DynatraceProblemsSettingsInput): IpcResult<DynatraceProblemsPublicSettings> {
    if (!this.isServer()) return failure('Configure Dynatrace Problems on the Relay server.');
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    try {
      return { success: true, data: manager.saveSettings(this.validateInput(input)) };
    } catch (error) {
      return failure(error);
    }
  }

  async testSettings(
    input: DynatraceProblemsSettingsInput,
  ): Promise<IpcResult<DynatraceProblemsTestResult>> {
    if (!this.isServer()) return failure('Test Dynatrace Problems on the Relay server.');
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    try {
      return { success: true, data: await manager.testSettings(this.validateInput(input)) };
    } catch (error) {
      return failure(error);
    }
  }

  clearSettings(): IpcResult {
    if (!this.isServer()) return failure('Configure Dynatrace Problems on the Relay server.');
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    return manager.clearSettings() ? { success: true } : failure('Could not remove configuration.');
  }

  async sync(): Promise<IpcResult<{ count: number }>> {
    if (!this.isServer()) return failure('Sync Dynatrace Problems from the Relay server.');
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    try {
      return { success: true, data: { count: await manager.syncNow(true) } };
    } catch (error) {
      return failure(error);
    }
  }

  async saveProfileFilter(profiles: string[]): Promise<IpcResult<{ count: number }>> {
    if (!this.isServer()) return failure('Save the alerting profile filter on the Relay server.');
    const manager = this.getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    try {
      const normalized = [...new Set(profiles.map((profile) => profile.trim()))].filter(Boolean);
      if (
        normalized.length === 0 ||
        normalized.length > MAX_DYNATRACE_ALERTING_PROFILES ||
        normalized.some((profile) => profile.length > MAX_DYNATRACE_ALERTING_PROFILE_LENGTH)
      ) {
        throw new Error('Select at least one valid alerting profile.');
      }
      return { success: true, data: { count: await manager.saveAlertingProfiles(normalized) } };
    } catch (error) {
      return failure(error);
    }
  }

  private isServer(): boolean {
    return this.getAppConfig()?.load()?.mode === 'server';
  }

  private validateInput(input: DynatraceProblemsSettingsInput): DynatraceProblemsSettingsInput {
    const environmentError = getDynatraceEnvironmentUrlError(input.environmentUrl);
    if (environmentError) throw new Error(environmentError);
    const requireToken = !this.getManager()?.getSettings().configured;
    if (requireToken || input.apiToken?.trim()) {
      const tokenError = getDynatraceApiTokenError(input.apiToken ?? '');
      if (tokenError) throw new Error(tokenError);
    }
    return input;
  }
}

export class BrandAssetService {
  constructor(private readonly getDataRoot: () => Promise<string>) {}

  async get(kind: BrandAssetKind): Promise<string | null> {
    try {
      const buffer = await readFile(await this.path(kind));
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async save(kind: BrandAssetKind, dataUrl: string): Promise<IpcResult<string>> {
    try {
      const encoded = dataUrl.split(',', 2)[1] ?? '';
      if (Buffer.byteLength(encoded, 'base64') > MAX_LOGO_BYTES) {
        return failure('Image must be under 2MB');
      }
      let image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) return failure('Invalid image file');
      if (image.getSize().width > MAX_LOGO_WIDTH) image = image.resize({ width: MAX_LOGO_WIDTH });
      return await this.savePng(kind, image.toPNG());
    } catch (error) {
      return failure(error);
    }
  }

  async savePng(kind: BrandAssetKind, png: Buffer): Promise<IpcResult<string>> {
    try {
      const path = await this.path(kind);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, png);
      return { success: true, data: `data:image/png;base64,${png.toString('base64')}` };
    } catch (error) {
      return failure(error);
    }
  }

  async remove(kind: BrandAssetKind): Promise<IpcResult> {
    try {
      await unlink(await this.path(kind));
      return { success: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true };
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Remove failed',
      };
    }
  }

  private async path(kind: BrandAssetKind): Promise<string> {
    return join(await this.getDataRoot(), 'assets', `${kind}-logo.png`);
  }
}

function writeBrowserLog(entry: LogEntry): void {
  const module = entry.module.replaceAll(/[^a-zA-Z0-9.-]/g, '').slice(0, 50);
  const message = `[web:${module}] ${entry.message}`;
  switch (entry.level) {
    case 'DEBUG':
      loggers.bridge.debug(message);
      break;
    case 'WARN':
      loggers.bridge.warn(message);
      break;
    case 'ERROR':
      loggers.bridge.error(message);
      break;
    case 'FATAL':
      loggers.bridge.fatal(message);
      break;
    default:
      loggers.bridge.info(message);
  }
}

export function createOperationalServices(options: {
  getCloudStatusManager: () => CloudStatusManager | null;
  getDynatraceWindowManager: () => DynatraceWindowManager | null;
  getDynatraceProblemsManager: () => DynatraceProblemsManager | null;
  getAppConfig: () => AppConfig | null;
  getDataRoot: () => Promise<string>;
}): OperationalServices & {
  dashboards: OperationalServices['dashboards'] & DynatraceDashboardService;
} {
  return {
    cloudStatus: new CloudStatusService(options.getCloudStatusManager),
    dashboards: new DynatraceDashboardService(options.getDynatraceWindowManager),
    problems: new DynatraceProblemsService(
      options.getDynatraceProblemsManager,
      options.getAppConfig,
    ),
    assets: new BrandAssetService(options.getDataRoot),
    log: writeBrowserLog,
  };
}
