import type { RadarSnapshot } from '@shared/ipc';
import { loggers } from '../../logger';
import { emptyRadarSnapshot, fetchRadarSnapshot } from './fetchRadar';

/** The dashboard refreshes itself on a 60s meta-refresh; Relay matches it. */
export const RADAR_REFRESH_INTERVAL_MS = 60_000;

type FetchSnapshot = (previous: RadarSnapshot) => Promise<RadarSnapshot>;
type Listener = (snapshot: RadarSnapshot) => void;

export class RadarManager {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<RadarSnapshot> | null = null;
  private snapshot: RadarSnapshot = emptyRadarSnapshot();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly fetchSnapshot: FetchSnapshot = fetchRadarSnapshot) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.refresh();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getSnapshot(): RadarSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Coalesces concurrent callers onto one request, so a manual refresh landing
   * next to a scheduled tick does not double up on the dashboard.
   */
  refresh(): Promise<RadarSnapshot> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
      if (this.active) this.scheduleNext();
    });
    return this.inFlight;
  }

  private async performRefresh(): Promise<RadarSnapshot> {
    try {
      const next = await this.fetchSnapshot(this.snapshot);
      this.snapshot = next;
      this.emit(next);
      return next;
    } catch (error) {
      // fetchRadarSnapshot already folds failures into the snapshot, so
      // reaching here means the injected fetcher itself threw.
      loggers.main.error('Failed to refresh Radar snapshot', { error });
      const next: RadarSnapshot = {
        ...this.snapshot,
        error: error instanceof Error ? error.message : String(error),
      };
      this.snapshot = next;
      this.emit(next);
      return next;
    }
  }

  private emit(snapshot: RadarSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        loggers.main.warn('Radar snapshot listener threw', { error });
      }
    }
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), RADAR_REFRESH_INTERVAL_MS);
  }
}
