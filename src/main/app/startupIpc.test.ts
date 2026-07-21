import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStartupStateController } from './startupState';
import { createStartupTimeline } from './startupTimeline';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
  removeListener: vi.fn(),
  trusted: vi.fn(() => true),
  broadcast: vi.fn(),
  info: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
    on: mocks.on,
    removeHandler: mocks.removeHandler,
    removeListener: mocks.removeListener,
  },
}));

vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.trusted,
}));

vi.mock('../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcast,
}));

vi.mock('../logger', () => ({
  loggers: { main: { info: mocks.info } },
}));

describe('setupStartupIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.trusted.mockReturnValue(true);
  });

  it('serves snapshots, broadcasts transitions, records renderer mount, and cleans up', async () => {
    const controller = createStartupStateController();
    const timeline = createStartupTimeline(() => 100);
    const { setupStartupIpc } = await import('./startupIpc');
    const cleanup = setupStartupIpc(controller, timeline);
    const getHandler = mocks.handle.mock.calls.find(
      ([channel]) => channel === 'startup:getState',
    )?.[1] as (event: unknown) => unknown;
    const mountedHandler = mocks.on.mock.calls.find(
      ([channel]) => channel === 'startup:rendererMounted',
    )?.[1] as (event: unknown) => void;

    const generation = controller.beginGeneration();
    controller.transition(generation, 'preparing-data');
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      'startup:stateChanged',
      controller.getSnapshot(),
    );
    expect(getHandler({})).toEqual(controller.getSnapshot());

    mountedHandler({});
    mountedHandler({});
    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining('renderer-mounted'));

    cleanup();
    expect(mocks.removeHandler).toHaveBeenCalledWith('startup:getState');
    expect(mocks.removeListener).toHaveBeenCalledWith('startup:rendererMounted', mountedHandler);
  });

  it('rejects untrusted snapshot requests and renderer milestones', async () => {
    mocks.trusted.mockReturnValue(false);
    const { setupStartupIpc } = await import('./startupIpc');
    setupStartupIpc(
      createStartupStateController(),
      createStartupTimeline(() => 100),
    );
    const getHandler = mocks.handle.mock.calls.find(
      ([channel]) => channel === 'startup:getState',
    )?.[1] as (event: unknown) => unknown;
    const mountedHandler = mocks.on.mock.calls.find(
      ([channel]) => channel === 'startup:rendererMounted',
    )?.[1] as (event: unknown) => void;

    expect(() => getHandler({})).toThrow('Untrusted startup state request.');
    mountedHandler({});
    expect(mocks.info).not.toHaveBeenCalled();
  });
});
