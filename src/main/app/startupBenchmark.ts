import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BENCHMARK_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StartupBenchmarkExitMarkerOptions = {
  environment: Readonly<Record<string, string | undefined>>;
  tempPath: string;
  onExit?: (listener: () => void) => unknown;
  writeMarker?: (markerPath: string) => void;
};

function writeExitMarker(markerPath: string): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, String(process.pid), { encoding: 'utf8', flag: 'wx' });
}

export function installStartupBenchmarkExitMarker({
  environment,
  tempPath,
  onExit = (listener) => process.once('exit', listener),
  writeMarker = writeExitMarker,
}: StartupBenchmarkExitMarkerOptions): string | null {
  const runId = environment.RELAY_BENCHMARK_RUN_ID;
  if (!runId || !BENCHMARK_RUN_ID_PATTERN.test(runId)) return null;

  const markerPath = join(tempPath, 'Relay', 'startup-benchmark', `${runId}.complete`);
  onExit(() => {
    try {
      writeMarker(markerPath);
    } catch {
      // Benchmark instrumentation must never affect normal shutdown.
    }
  });
  return markerPath;
}
