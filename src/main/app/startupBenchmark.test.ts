import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('startup benchmark markers', () => {
  it('writes the renderer timeline to a synchronous benchmark marker', async () => {
    const writeTimelineMarker = vi.fn();
    const { recordStartupBenchmarkTimeline } = await import('./startupBenchmark');
    const timeline = { entry: 0, 'renderer-mounted': 440 };

    recordStartupBenchmarkTimeline({
      environment: {
        RELAY_BENCHMARK_EXIT_AFTER_RENDER: '1',
        RELAY_BENCHMARK_RUN_ID: '5e50ac3a-1bf0-47f5-a653-09bf8a30b364',
      },
      tempPath: 'C:\\RelayBenchmarkTestRoot',
      timeline,
      writeTimelineMarker,
    });

    const markerPath = writeTimelineMarker.mock.calls[0]?.[0];
    expect(markerPath).toMatch(
      /Relay[\\/]startup-benchmark[\\/]5e50ac3a-1bf0-47f5-a653-09bf8a30b364\.timeline\.json$/,
    );
    expect(writeTimelineMarker).toHaveBeenCalledWith(markerPath, JSON.stringify(timeline));
  });

  it('writes a fixed-root completion marker only when the benchmarked process exits', async () => {
    const onExit = vi.fn();
    const writeMarker = vi.fn();
    const writePidMarker = vi.fn();
    const { installStartupBenchmarkExitMarker } = await import('./startupBenchmark');

    const markerPath = installStartupBenchmarkExitMarker({
      environment: {
        RELAY_BENCHMARK_EXIT_AFTER_RENDER: '1',
        RELAY_BENCHMARK_RUN_ID: '5e50ac3a-1bf0-47f5-a653-09bf8a30b364',
      },
      tempPath: 'C:\\RelayBenchmarkTestRoot',
      onExit,
      writeMarker,
      writePidMarker,
    });

    expect(markerPath).toMatch(
      /Relay[\\/]startup-benchmark[\\/]5e50ac3a-1bf0-47f5-a653-09bf8a30b364\.complete$/,
    );
    expect(writeMarker).not.toHaveBeenCalled();
    expect(writePidMarker).toHaveBeenCalledWith(
      expect.stringMatching(/5e50ac3a-1bf0-47f5-a653-09bf8a30b364\.pid$/),
    );
    onExit.mock.calls[0]?.[0](0);
    expect(writeMarker).toHaveBeenCalledWith(markerPath);
  });

  it('does not mark a benchmark complete when Relay exits unsuccessfully', async () => {
    const onExit = vi.fn();
    const writeMarker = vi.fn();
    const writePidMarker = vi.fn();
    const { installStartupBenchmarkExitMarker } = await import('./startupBenchmark');

    installStartupBenchmarkExitMarker({
      environment: {
        RELAY_BENCHMARK_EXIT_AFTER_RENDER: '1',
        RELAY_BENCHMARK_RUN_ID: '5e50ac3a-1bf0-47f5-a653-09bf8a30b364',
      },
      tempPath: 'C:\\RelayBenchmarkTestRoot',
      onExit,
      writeMarker,
      writePidMarker,
    });

    onExit.mock.calls[0]?.[0](1);
    expect(writeMarker).not.toHaveBeenCalled();
  });

  it('installs benchmark markers only in the primary app instance', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
    const lockIndex = source.indexOf('if (gotLock) {');
    const markerIndex = source.indexOf('installStartupBenchmarkExitMarker({');
    const timelineMarkerIndex = source.indexOf('recordStartupBenchmarkTimeline({');
    const benchmarkQuitIndex = source.indexOf("requestAppQuit('startup-benchmark-complete')");

    expect(lockIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeGreaterThan(lockIndex);
    expect(timelineMarkerIndex).toBeGreaterThan(markerIndex);
    expect(benchmarkQuitIndex).toBeGreaterThan(timelineMarkerIndex);
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
        environment: {
          RELAY_BENCHMARK_EXIT_AFTER_RENDER: '1',
          RELAY_BENCHMARK_RUN_ID: '..\\outside',
        },
        tempPath: 'C:\\RelayBenchmarkTestRoot',
        onExit,
      }),
    ).toBeNull();
    expect(
      installStartupBenchmarkExitMarker({
        environment: {
          RELAY_BENCHMARK_RUN_ID: '5e50ac3a-1bf0-47f5-a653-09bf8a30b364',
        },
        tempPath: 'C:\\RelayBenchmarkTestRoot',
        onExit,
      }),
    ).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });
});
