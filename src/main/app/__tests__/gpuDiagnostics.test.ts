import { describe, expect, it, vi } from 'vitest';
import {
  collectGpuDiagnostics,
  logGpuDiagnostics,
  scheduleGpuDiagnostics,
} from '../gpuDiagnostics';

function createApp() {
  return {
    isHardwareAccelerationEnabled: vi.fn(() => true),
    getGPUFeatureStatus: vi.fn(() => ({
      gpu_compositing: 'enabled',
      rasterization: 'enabled',
      webgl: 'enabled',
    })),
    getGPUInfo: vi.fn(async () => ({
      gpuDevice: [
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x1234,
          driverVendor: 'NVIDIA',
          driverVersion: '42.0',
          cudaComputeCapabilityMajor: 8,
        },
      ],
      auxAttributes: {
        glRenderer: 'ANGLE renderer',
        machineModelName: 'private machine name',
      },
    })),
  };
}

describe('gpuDiagnostics', () => {
  it('collects acceleration and curated adapter data without machine metadata', async () => {
    await expect(collectGpuDiagnostics(createApp())).resolves.toEqual({
      hardwareAcceleration: 'enabled',
      features: {
        gpu_compositing: 'enabled',
        rasterization: 'enabled',
        webgl: 'enabled',
      },
      adapters: [
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x1234,
          driverVendor: 'NVIDIA',
          driverVersion: '42.0',
        },
      ],
      renderer: 'ANGLE renderer',
    });
  });

  it('logs a warning instead of rejecting when Electron cannot provide GPU info', async () => {
    const app = createApp();
    app.getGPUInfo.mockRejectedValueOnce(new Error('GPU process unavailable'));
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(logGpuDiagnostics(app, logger)).resolves.toBeUndefined();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('gpu-diagnostics unavailable', {
      error: 'GPU process unavailable',
    });
  });

  it('defers collection beyond renderer mount and can cancel pending work', async () => {
    vi.useFakeTimers();
    const app = createApp();
    const logger = { info: vi.fn(), warn: vi.fn() };

    try {
      const cancel = scheduleGpuDiagnostics(app, logger);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(app.getGPUInfo).not.toHaveBeenCalled();

      cancel();
      await vi.runAllTimersAsync();
      expect(app.getGPUInfo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects diagnostics after the deferred idle window', async () => {
    vi.useFakeTimers();
    const app = createApp();
    const logger = { info: vi.fn(), warn: vi.fn() };

    try {
      scheduleGpuDiagnostics(app, logger);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(app.getGPUInfo).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith('gpu-diagnostics', expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });
});
