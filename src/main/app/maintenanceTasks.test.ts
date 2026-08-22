import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupMaintenanceTasks } from './maintenanceTasks';

vi.mock('../logger', () => ({
  loggers: { main: { info: vi.fn(), warn: vi.fn() } },
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('setupMaintenanceTasks', () => {
  it('runs injected cache cleanup on the existing daily maintenance cycle', async () => {
    vi.useFakeTimers();
    const runDailyCleanup = vi.fn(async () => undefined);
    const stop = setupMaintenanceTasks(runDailyCleanup);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);

    expect(runDailyCleanup).toHaveBeenCalledOnce();
    stop();
  });
});
