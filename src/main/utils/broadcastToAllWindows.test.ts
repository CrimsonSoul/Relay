import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { broadcastToAllWindows } from './broadcastToAllWindows';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
}));

function createWindow(isDestroyed: boolean) {
  return {
    isDestroyed: vi.fn(() => isDestroyed),
    webContents: {
      send: vi.fn(),
    },
  };
}

describe('broadcastToAllWindows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the message and arguments to each open BrowserWindow', () => {
    const openWindow = createWindow(false);
    const destroyedWindow = createWindow(true);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      openWindow,
      destroyedWindow,
    ] as unknown as BrowserWindow[]);

    broadcastToAllWindows('relay:test', { ok: true }, 42);

    expect(openWindow.webContents.send).toHaveBeenCalledWith('relay:test', { ok: true }, 42);
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
  });
});
