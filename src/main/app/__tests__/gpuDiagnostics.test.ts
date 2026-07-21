import { describe, expect, it, vi } from 'vitest';
import { collectGpuDiagnostics, logGpuDiagnostics } from '../gpuDiagnostics';

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
});
