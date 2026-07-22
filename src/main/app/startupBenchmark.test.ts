import { describe, expect, it, vi } from 'vitest';

describe('installStartupBenchmarkExitMarker', () => {
  it('writes a fixed-root completion marker only when the benchmarked process exits', async () => {
    const onExit = vi.fn();
    const writeMarker = vi.fn();
    const { installStartupBenchmarkExitMarker } = await import('./startupBenchmark');

    const markerPath = installStartupBenchmarkExitMarker({
      environment: {
        RELAY_BENCHMARK_RUN_ID: '5e50ac3a-1bf0-47f5-a653-09bf8a30b364',
      },
      tempPath: 'C:\\RelayBenchmarkTestRoot',
      onExit,
      writeMarker,
    });

    expect(markerPath).toMatch(
      /Relay[\\/]startup-benchmark[\\/]5e50ac3a-1bf0-47f5-a653-09bf8a30b364\.complete$/,
    );
    expect(writeMarker).not.toHaveBeenCalled();
    onExit.mock.calls[0]?.[0]();
    expect(writeMarker).toHaveBeenCalledWith(markerPath);
  });

  it('ignores absent or unsafe benchmark IDs', async () => {
    const onExit = vi.fn();
    const { installStartupBenchmarkExitMarker } = await import('./startupBenchmark');

    expect(
      installStartupBenchmarkExitMarker({
        environment: {},
        tempPath: 'C:\\RelayBenchmarkTestRoot',
        onExit,
      }),
    ).toBeNull();
    expect(
      installStartupBenchmarkExitMarker({
        environment: { RELAY_BENCHMARK_RUN_ID: '..\\outside' },
        tempPath: 'C:\\RelayBenchmarkTestRoot',
        onExit,
      }),
    ).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });
});
