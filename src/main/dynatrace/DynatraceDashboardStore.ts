import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replaceFileDurablySync } from '../utils/durableFile';
import {
  getDynatraceStartUrlError,
  getDynatraceStartUrlSaveError,
  type DynatraceDashboard,
  type DynatraceDashboardBounds,
  type DynatraceDashboardInput,
} from '../../shared/dynatrace';
import { loggers } from '../logger';

const DASHBOARD_STORE_FILE = 'dynatrace-dashboards.json';
/** Built-in apps (Infra Health) are never stored as dashboards, so their window bounds live apart. */
const BUILT_IN_BOUNDS_FILE = 'dynatrace-builtin-bounds.json';
const SCHEMA_VERSION = 1;
const DEFAULT_DASHBOARD_NAME = 'Dynatrace Dashboard';
const MIN_WINDOW_SIZE = 320;
const MAX_WINDOW_SIZE = 10000;
const MIN_WINDOW_POSITION = -10000;
const MAX_WINDOW_POSITION = 10000;

type StoredDynatraceDashboards = {
  schemaVersion: 1;
  dashboards: unknown[];
};

type StoredBuiltInBounds = {
  schemaVersion: 1;
  bounds: Record<string, DynatraceDashboardBounds>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DynatraceDashboardStore {
  private readonly filePath: string;
  private readonly builtInBoundsPath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, DASHBOARD_STORE_FILE);
    this.builtInBoundsPath = join(dataDir, BUILT_IN_BOUNDS_FILE);
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
    const existing = dashboards[index];
    if (existing === undefined) return null;

    const updated: DynatraceDashboard = {
      ...existing,
      ...this.validateInput(input, existing.url),
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
    const existing = dashboards[index];
    if (existing === undefined) return null;

    const validBounds = this.validateBounds(bounds);
    const updated: DynatraceDashboard = {
      ...existing,
      bounds: validBounds,
    };
    dashboards[index] = updated;

    this.writeDashboards(dashboards);
    return updated;
  }

  getBuiltInBounds(id: string): DynatraceDashboardBounds | null {
    return this.readBuiltInBounds()[id] ?? null;
  }

  setBuiltInBounds(id: string, bounds: DynatraceDashboardBounds): void {
    const stored: StoredBuiltInBounds = {
      schemaVersion: SCHEMA_VERSION,
      bounds: { ...this.readBuiltInBounds(), [id]: this.validateBounds(bounds) },
    };
    mkdirSync(this.dataDir, { recursive: true });
    replaceFileDurablySync(
      `${this.builtInBoundsPath}.tmp`,
      this.builtInBoundsPath,
      JSON.stringify(stored, null, 2),
    );
  }

  private readBuiltInBounds(): Record<string, DynatraceDashboardBounds> {
    if (!existsSync(this.builtInBoundsPath)) return {};

    try {
      const stored = JSON.parse(readFileSync(this.builtInBoundsPath, 'utf-8')) as unknown;
      if (
        !isRecord(stored) ||
        stored.schemaVersion !== SCHEMA_VERSION ||
        !isRecord(stored.bounds)
      ) {
        return {};
      }

      const valid: Record<string, DynatraceDashboardBounds> = {};
      for (const [id, value] of Object.entries(stored.bounds)) {
        const bounds = this.parseBounds(value);
        if (bounds) valid[id] = bounds;
      }
      return valid;
    } catch (error) {
      loggers.main.warn('Failed to parse Dynatrace built-in bounds file', {
        path: this.builtInBoundsPath,
        error,
      });
      return {};
    }
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
    replaceFileDurablySync(`${this.filePath}.tmp`, this.filePath, JSON.stringify(stored, null, 2));
  }

  private validateInput(
    input: DynatraceDashboardInput,
    savedUrl?: string,
  ): DynatraceDashboardInput {
    if (typeof input.name !== 'string') throw new Error('Enter a valid dashboard name.');
    if (typeof input.url !== 'string') throw new Error('Enter a valid URL.');

    const url = input.url.trim();
    const error = getDynatraceStartUrlSaveError(url, savedUrl);
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
    if (!this.isIntegerInRange(bounds.width, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE)) return null;
    if (!this.isIntegerInRange(bounds.height, MIN_WINDOW_SIZE, MAX_WINDOW_SIZE)) return null;
    if (
      bounds.x !== undefined &&
      !this.isIntegerInRange(bounds.x, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION)
    ) {
      return null;
    }
    if (
      bounds.y !== undefined &&
      !this.isIntegerInRange(bounds.y, MIN_WINDOW_POSITION, MAX_WINDOW_POSITION)
    ) {
      return null;
    }

    const validBounds: DynatraceDashboardBounds = {
      width: bounds.width,
      height: bounds.height,
    };
    if (typeof bounds.x === 'number') validBounds.x = bounds.x;
    if (typeof bounds.y === 'number') validBounds.y = bounds.y;

    return validBounds;
  }

  private isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  }
}
