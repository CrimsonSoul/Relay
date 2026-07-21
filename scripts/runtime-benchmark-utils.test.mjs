import { describe, expect, it } from 'vitest';

import {
  collectRuntimeResources,
  selectGpuDiagnostics,
  summarizeProcessSamples,
} from './runtime-benchmark-utils.mjs';

describe('summarizeProcessSamples', () => {
  it('reports average CPU and median working set by process', () => {
    expect(
      summarizeProcessSamples([
        [
          { type: 'Browser', name: 'Relay', cpu: 0.2, workingSetMB: 80 },
          { type: 'GPU', name: '', cpu: 0.8, workingSetMB: 120 },
        ],
        [
          { type: 'Browser', name: 'Relay', cpu: 0.4, workingSetMB: 84 },
          { type: 'GPU', name: '', cpu: 0.4, workingSetMB: 110 },
        ],
        [
          { type: 'Browser', name: 'Relay', cpu: 0.3, workingSetMB: 82 },
          { type: 'GPU', name: '', cpu: 0.6, workingSetMB: 115 },
        ],
      ]),
    ).toEqual({
      GPU: { cpuAverage: 0.6, workingSetMedianMB: 115 },
      Relay: { cpuAverage: 0.3, workingSetMedianMB: 82 },
    });
  });
});

describe('collectRuntimeResources', () => {
  it('collects unique JavaScript and CSS resource basenames from all frames', () => {
    const frameTree = {
      resources: [
        { url: 'file:///dist/renderer/index.html' },
        { url: 'file:///dist/renderer/assets/index-abc.js' },
        { url: 'file:///dist/renderer/assets/index-def.css' },
      ],
      childFrames: [
        {
          resources: [
            { url: 'file:///dist/renderer/assets/index-abc.js' },
            { url: 'file:///dist/renderer/assets/SettingsModal-123.js' },
          ],
        },
      ],
    };

    expect(collectRuntimeResources(frameTree)).toEqual([
      'SettingsModal-123.js',
      'index-abc.js',
      'index-def.css',
    ]);
  });
});

describe('selectGpuDiagnostics', () => {
  it('keeps acceleration state, feature status, and non-sensitive adapter fields', () => {
    expect(
      selectGpuDiagnostics({
        accelerated: true,
        features: { gpu_compositing: 'enabled', webgl: 'enabled' },
        basic: {
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
          auxAttributes: { glRenderer: 'Renderer name', machineModelName: 'private' },
        },
      }),
    ).toEqual({
      accelerated: true,
      features: { gpu_compositing: 'enabled', webgl: 'enabled' },
      adapters: [
        {
          active: true,
          vendorId: 0x10de,
          deviceId: 0x1234,
          driverVendor: 'NVIDIA',
          driverVersion: '42.0',
        },
      ],
      renderer: 'Renderer name',
    });
  });
});
