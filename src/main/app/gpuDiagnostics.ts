import type { ModuleLogger } from '@shared/logging';

type GpuDiagnosticsApp = {
  isHardwareAccelerationEnabled(): boolean;
  getGPUFeatureStatus(): object;
  getGPUInfo(infoType: 'basic'): Promise<unknown>;
};

type GpuDiagnosticsLogger = Pick<ModuleLogger, 'info' | 'warn'>;

const GPU_DIAGNOSTICS_DELAY_MS = 5_000;

const ADAPTER_FIELDS = ['active', 'vendorId', 'deviceId', 'driverVendor', 'driverVersion'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function selectAdapters(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((adapter) => {
    const record = asRecord(adapter);
    if (!record) return [];
    return [
      Object.fromEntries(
        ADAPTER_FIELDS.filter((field) => record[field] !== undefined).map((field) => [
          field,
          record[field],
        ]),
      ),
    ];
  });
}

export async function collectGpuDiagnostics(app: GpuDiagnosticsApp) {
  // Resolving basic GPU information first gives Chromium's GPU process time to
  // publish its feature status before we snapshot it.
  const basic = asRecord(await app.getGPUInfo('basic'));
  const auxAttributes = asRecord(basic?.auxAttributes);

  return {
    hardwareAcceleration: app.isHardwareAccelerationEnabled() ? 'enabled' : 'disabled',
    features: app.getGPUFeatureStatus(),
    adapters: selectAdapters(basic?.gpuDevice),
    renderer: typeof auxAttributes?.glRenderer === 'string' ? auxAttributes.glRenderer : null,
  };
}

export async function logGpuDiagnostics(
  app: GpuDiagnosticsApp,
  logger: GpuDiagnosticsLogger,
): Promise<void> {
  try {
    logger.info('gpu-diagnostics', await collectGpuDiagnostics(app));
  } catch (error) {
    logger.warn('gpu-diagnostics unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function scheduleGpuDiagnostics(
  app: GpuDiagnosticsApp,
  logger: GpuDiagnosticsLogger,
): () => void {
  const timer = setTimeout(() => void logGpuDiagnostics(app, logger), GPU_DIAGNOSTICS_DELAY_MS);
  timer.unref?.();
  return () => clearTimeout(timer);
}
