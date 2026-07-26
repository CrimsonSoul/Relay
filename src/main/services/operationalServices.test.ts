import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeImage } from 'electron';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrandAssetService, createOperationalServices } from './operationalServices';

const { mockBridgeLogger } = vi.hoisted(() => ({
  mockBridgeLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  nativeImage: {
    createFromDataURL: vi.fn(),
  },
}));

vi.mock('../logger', () => ({
  loggers: {
    bridge: mockBridgeLogger,
    cloudStatus: {
      error: vi.fn(),
    },
  },
}));

describe('operational services security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps each browser-authored message in one physical log record', () => {
    const services = createOperationalServices({
      getCloudStatusManager: () => null,
      getDynatraceWindowManager: () => null,
      getDynatraceProblemsManager: () => null,
      getAppConfig: () => null,
      getDataRoot: async () => '/unused',
    });

    services.log({
      level: 'INFO',
      module: 'audit\r\nforged',
      message: 'first\r\nsecond\nthird\rfourth\u0085fifth\u2028sixth\u2029seventh',
    });

    expect(mockBridgeLogger.info).toHaveBeenCalledWith(
      '[web:auditforged] first\\r\\nsecond\\nthird\\rfourth\\u0085fifth\\u2028sixth\\u2029seventh',
    );
  });

  it('rejects a logo above the decoded pixel budget before persistence', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'relay-brand-service-'));
    try {
      const oversized = await sharp({
        create: {
          width: 2_001,
          height: 2_000,
          channels: 4,
          background: { r: 20, g: 30, b: 40, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      vi.mocked(nativeImage.createFromDataURL).mockReturnValue({
        isEmpty: () => false,
        getSize: () => ({ width: 2_001, height: 2_000 }),
        resize: () => ({
          toPNG: () => Buffer.from('unsafe-decoded-output'),
        }),
      } as never);

      const service = new BrandAssetService(async () => dataRoot);
      const result = await service.save(
        'company',
        `data:image/png;base64,${oversized.toString('base64')}`,
      );

      expect(result).toEqual({ success: false, error: 'Invalid or oversized image' });
      await expect(readFile(join(dataRoot, 'assets', 'company-logo.png'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('preserves a valid wide logo through a bounded resize', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'relay-brand-service-'));
    try {
      const source = await sharp({
        create: {
          width: 800,
          height: 200,
          channels: 4,
          background: { r: 20, g: 30, b: 40, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const expected = await sharp(source)
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      vi.mocked(nativeImage.createFromDataURL).mockReturnValue({
        isEmpty: () => false,
        getSize: () => ({ width: 800, height: 200 }),
        resize: () => ({
          toPNG: () => expected,
        }),
      } as never);

      const service = new BrandAssetService(async () => dataRoot);
      const result = await service.save(
        'company',
        `data:image/png;base64,${source.toString('base64')}`,
      );
      const metadata = await sharp(
        await readFile(join(dataRoot, 'assets', 'company-logo.png')),
      ).metadata();

      expect(result.success).toBe(true);
      expect(metadata).toMatchObject({ width: 400, height: 100, format: 'png' });
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
