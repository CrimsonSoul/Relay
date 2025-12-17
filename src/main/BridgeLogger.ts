import fs from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface BridgeEvent {
  timestamp: number;
  groups: string[];
}

export interface MetricsData {
  bridgesLast7d: number;
  bridgesLast30d: number;
  bridgesLast6m: number;
  bridgesLast1y: number;
  topGroups: { name: string; count: number }[];
}

// Maximum number of events to keep in history (prevents unbounded growth)
const MAX_HISTORY_EVENTS = 1000;
// Cache TTL for metrics (1 minute)
const METRICS_CACHE_TTL = 60 * 1000;

export class BridgeLogger {
  private historyPath: string;
  private events: BridgeEvent[] = [];
  private isLoaded = false;
  private savePromise: Promise<void> | null = null;

  // Metrics cache
  private metricsCache: MetricsData | null = null;
  private metricsCacheTimestamp = 0;

  constructor(dataRoot: string) {
    this.historyPath = join(dataRoot, 'history.json');
    this.loadAsync();
  }

  private async loadAsync() {
    try {
      if (existsSync(this.historyPath)) {
        const raw = await fs.readFile(this.historyPath, 'utf-8');
        this.events = JSON.parse(raw);
        // Trim to max size on load if needed
        if (this.events.length > MAX_HISTORY_EVENTS) {
          this.events = this.events.slice(-MAX_HISTORY_EVENTS);
          this.saveAsync(); // Save trimmed version
        }
      }
      this.isLoaded = true;
    } catch (e) {
      console.error('[BridgeLogger] Failed to load history:', e);
      this.events = [];
      this.isLoaded = true;
    }
  }

  private async saveAsync(): Promise<void> {
    // Coalesce multiple saves into one
    if (this.savePromise) {
      return this.savePromise;
    }

    this.savePromise = (async () => {
      try {
        await fs.writeFile(this.historyPath, JSON.stringify(this.events, null, 2));
      } catch (e) {
        console.error('[BridgeLogger] Failed to save history:', e);
      } finally {
        this.savePromise = null;
      }
    })();

    return this.savePromise;
  }

  public logBridge(groups: string[]) {
    this.events.push({
      timestamp: Date.now(),
      groups
    });

    // Enforce max history size (keep most recent events)
    if (this.events.length > MAX_HISTORY_EVENTS) {
      this.events = this.events.slice(-MAX_HISTORY_EVENTS);
    }

    // Invalidate metrics cache
    this.metricsCache = null;

    // Save asynchronously (non-blocking)
    this.saveAsync();
  }

  public async reset(): Promise<boolean> {
    try {
      this.events = [];
      this.metricsCache = null;
      await this.saveAsync();
      return true;
    } catch (e) {
      console.error('[BridgeLogger] Failed to reset history:', e);
      return false;
    }
  }

  public getMetrics(): MetricsData {
    const now = Date.now();

    // Return cached metrics if still valid
    if (this.metricsCache && (now - this.metricsCacheTimestamp) < METRICS_CACHE_TTL) {
      return this.metricsCache;
    }

    const oneDay = 24 * 60 * 60 * 1000;

    // Single pass through events to calculate all metrics
    const cutoffs = {
      days7: now - (7 * oneDay),
      days30: now - (30 * oneDay),
      days180: now - (180 * oneDay),
      days365: now - (365 * oneDay)
    };

    let bridgesLast7d = 0;
    let bridgesLast30d = 0;
    let bridgesLast6m = 0;
    let bridgesLast1y = 0;
    const groupCounts: Record<string, number> = {};

    // Single pass through all events
    for (const event of this.events) {
      if (event.timestamp >= cutoffs.days365) {
        bridgesLast1y++;
        if (event.timestamp >= cutoffs.days180) {
          bridgesLast6m++;
          if (event.timestamp >= cutoffs.days30) {
            bridgesLast30d++;
            if (event.timestamp >= cutoffs.days7) {
              bridgesLast7d++;
            }
          }
        }
      }

      // Count groups
      for (const g of event.groups) {
        if (g !== 'Default') {
          groupCounts[g] = (groupCounts[g] || 0) + 1;
        }
      }
    }

    const topGroups = Object.entries(groupCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Cache the result
    this.metricsCache = {
      bridgesLast7d,
      bridgesLast30d,
      bridgesLast6m,
      bridgesLast1y,
      topGroups
    };
    this.metricsCacheTimestamp = now;

    return this.metricsCache;
  }
}
