import { beforeEach, describe, expect, it, vi } from 'vitest';
import recoveryTiming from '../../../build/windows/recovery-timing.json';
import type { ManualUpdateCheckpointProcessOptions } from './ManualUpdateCheckpointProcess';
import { startProductionManualUpdateCheckpointProcess } from './productionManualUpdateCheckpointProcess';

const TRANSACTION_ID = '11111111-2222-4333-8444-555555555555';
const mocks = vi.hoisted(() => ({
  whenReady: vi.fn(async () => undefined),
  exit: vi.fn(),
  reportFailure: vi.fn(),
  runCheckpoint: vi.fn(async () => undefined),
  startProcess: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    whenReady: mocks.whenReady,
    exit: mocks.exit,
  },
}));

vi.mock('../logger', () => ({
  loggers: { main: { error: mocks.reportFailure } },
}));

vi.mock('./ManualUpdateCheckpointProcess', () => ({
  startManualUpdateCheckpointProcess: mocks.startProcess,
}));

vi.mock('./productionManualUpdateCheckpoint', () => ({
  runProductionManualUpdateCheckpoint: mocks.runCheckpoint,
}));

describe('productionManualUpdateCheckpointProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wires the bounded checkpoint process to Electron and production recovery', async () => {
    startProductionManualUpdateCheckpointProcess(TRANSACTION_ID);

    expect(mocks.startProcess).toHaveBeenCalledOnce();
    const options = mocks.startProcess.mock.calls[0]?.[0] as ManualUpdateCheckpointProcessOptions;

    await options.whenReady();
    await options.runCheckpoint();
    options.exit(1);
    const failure = new Error('checkpoint failed');
    options.reportFailure(failure);

    expect(mocks.whenReady).toHaveBeenCalledOnce();
    expect(mocks.runCheckpoint).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(mocks.exit).toHaveBeenCalledWith(1);
    expect(mocks.reportFailure).toHaveBeenCalledWith('Manual update checkpoint failed', {
      error: failure,
    });
    expect(options.timeoutMs).toBe(recoveryTiming.supervisorTimeoutMs);
  });
});
