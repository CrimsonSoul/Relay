import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DynatraceDashboard,
  DynatraceDashboardBounds,
  DynatraceDashboardInput,
  getDynatraceStartUrlError,
} from '../../shared/dynatrace';
import { loggers } from '../logger';

const DASHBOARD_STORE_FILE = 'dynatrace-dashboards.json';
const SCHEMA_VERSION = 1;
const DEFAULT_DASHBOARD_NAME = 'Dynatrace Dashboard';

type StoredDynatraceDashboards = {
  schemaVersion: 1;
  dashboards: DynatraceDashboard[];
};

export class DynatraceDashboardStore {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, DASHBOARD_STORE_FILE);
  }

  list(): DynatraceDashboard[] {
    return this.readDashboards();
  }

  add(input: DynatraceDashboardInput): DynatraceDashboard {
    const dashboards = this.readDashboards();
    const dashboard: DynatraceDashboard = {
      id: `dt_${randomUUID()}`,
      ...this.validateInput(input),
    };

    this.writeDashboards([...dashboards, dashboard]);
    return dashboard;
  }

  update(id: string, input: DynatraceDashboardInput): DynatraceDashboard | null {
    const dashboards = this.readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === id);
    if (index === -1) return null;

    const updated: DynatraceDashboard = {
      ...dashboards[index],
      ...this.validateInput(input),
    };
    dashboards[index] = updated;

    this.writeDashboards(dashboards);
    return updated;
  }

  remove(id: string): boolean {
    const dashboards = this.readDashboards();
    const nextDashboards = dashboards.filter((dashboard) => dashboard.id !== id);
    if (nextDashboards.length === dashboards.length) return false;

    this.writeDashboards(nextDashboards);
    return true;
  }

  setBounds(id: string, bounds: DynatraceDashboardBounds): DynatraceDashboard | null {
    const dashboards = this.readDashboards();
    const index = dashboards.findIndex((dashboard) => dashboard.id === id);
    if (index === -1) return null;

    const updated: DynatraceDashboard = {
      ...dashboards[index],
      bounds,
    };
    dashboards[index] = updated;

    this.writeDashboards(dashboards);
    return updated;
  }

  private readDashboards(): DynatraceDashboard[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf-8')) as StoredDynatraceDashboards;
      return Array.isArray(stored.dashboards) ? stored.dashboards : [];
    } catch (error) {
      loggers.main.warn('Failed to parse Dynatrace dashboards file', {
        path: this.filePath,
        error,
      });
      return [];
    }
  }

  private writeDashboards(dashboards: DynatraceDashboard[]): void {
    mkdirSync(this.dataDir, { recursive: true });

    const stored: StoredDynatraceDashboards = {
      schemaVersion: SCHEMA_VERSION,
      dashboards,
    };
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(stored, null, 2), 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  private validateInput(input: DynatraceDashboardInput): DynatraceDashboardInput {
    const url = input.url.trim();
    const error = getDynatraceStartUrlError(url);
    if (error) throw new Error(error);

    return {
      name: input.name.trim() || DEFAULT_DASHBOARD_NAME,
      url,
    };
  }
}
