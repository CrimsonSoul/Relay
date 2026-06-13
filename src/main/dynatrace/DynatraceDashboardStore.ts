import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDynatraceStartUrlError,
  type DynatraceDashboard,
  type DynatraceDashboardBounds,
  type DynatraceDashboardInput,
} from '../../shared/dynatrace';
import { loggers } from '../logger';

const DASHBOARD_STORE_FILE = 'dynatrace-dashboards.json';
const SCHEMA_VERSION = 1;
const DEFAULT_DASHBOARD_NAME = 'Dynatrace Dashboard';

type StoredDynatraceDashboards = {
  schemaVersion: 1;
  dashboards: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

    const validBounds = this.validateBounds(bounds);
    const updated: DynatraceDashboard = {
      ...dashboards[index],
      bounds: validBounds,
    };
    dashboards[index] = updated;

    this.writeDashboards(dashboards);
    return updated;
  }

  private readDashboards(): DynatraceDashboard[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const stored = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!this.isStoredEnvelope(stored)) {
        loggers.main.warn('Invalid Dynatrace dashboards file shape', { path: this.filePath });
        return [];
      }

      return this.normalizeStoredDashboards(stored.dashboards);
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

  private isStoredEnvelope(value: unknown): value is StoredDynatraceDashboards {
    return (
      isRecord(value) && value.schemaVersion === SCHEMA_VERSION && Array.isArray(value.dashboards)
    );
  }

  private normalizeStoredDashboards(values: unknown[]): DynatraceDashboard[] {
    const dashboards: DynatraceDashboard[] = [];
    let dropped = 0;

    for (const value of values) {
      const dashboard = this.normalizeStoredDashboard(value);
      if (dashboard) {
        dashboards.push(dashboard);
      } else {
        dropped += 1;
      }
    }

    if (dropped > 0) {
      loggers.main.warn('Dropped invalid Dynatrace dashboard records', {
        path: this.filePath,
        dropped,
      });
    }

    return dashboards;
  }

  private normalizeStoredDashboard(value: unknown): DynatraceDashboard | null {
    if (!isRecord(value)) return null;

    const id = value.id;
    const name = value.name;
    const url = value.url;
    if (typeof id !== 'string' || !id.startsWith('dt_')) return null;
    if (typeof name !== 'string' || name.trim().length === 0) return null;
    if (typeof url !== 'string') return null;

    const trimmedUrl = url.trim();
    if (getDynatraceStartUrlError(trimmedUrl)) return null;

    const dashboard: DynatraceDashboard = {
      id,
      name: name.trim(),
      url: trimmedUrl,
    };

    if ('bounds' in value) {
      const bounds = this.parseBounds(value.bounds);
      if (!bounds) return null;
      dashboard.bounds = bounds;
    }

    return dashboard;
  }

  private validateBounds(bounds: DynatraceDashboardBounds): DynatraceDashboardBounds {
    const validBounds = this.parseBounds(bounds);
    if (!validBounds) throw new Error('Invalid Dynatrace dashboard bounds.');
    return validBounds;
  }

  private parseBounds(bounds: unknown): DynatraceDashboardBounds | null {
    if (!isRecord(bounds)) return null;
    if (!this.isPositiveFiniteNumber(bounds.width)) return null;
    if (!this.isPositiveFiniteNumber(bounds.height)) return null;
    if (bounds.x !== undefined && !this.isFiniteNumber(bounds.x)) return null;
    if (bounds.y !== undefined && !this.isFiniteNumber(bounds.y)) return null;

    const validBounds: DynatraceDashboardBounds = {
      width: bounds.width,
      height: bounds.height,
    };
    if (typeof bounds.x === 'number') validBounds.x = bounds.x;
    if (typeof bounds.y === 'number') validBounds.y = bounds.y;

    return validBounds;
  }

  private isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}
