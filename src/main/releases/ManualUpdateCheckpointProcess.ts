export type ManualUpdateCheckpointProcessOptions = {
  whenReady: () => Promise<unknown>;
  runCheckpoint: () => Promise<void>;
  exit: (code: number) => void;
  reportFailure: (error: unknown) => void;
  timeoutMs: number;
};

export function startManualUpdateCheckpointProcess(
  options: ManualUpdateCheckpointProcessOptions,
): void {
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const finish = (code: number, error?: unknown) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (error !== undefined) options.reportFailure(error);
    options.exit(code);
  };
  timeout = setTimeout(
    () => finish(1, new Error('Manual update checkpoint timed out')),
    options.timeoutMs,
  );

  void options
    .whenReady()
    .then(options.runCheckpoint)
    .then(
      () => finish(0),
      (error: unknown) => finish(1, error),
    );
}
