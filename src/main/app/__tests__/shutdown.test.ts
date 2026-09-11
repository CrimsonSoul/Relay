import { EventEmitter } from 'node:events';
import type { App, BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerShutdownHandlers } from '../shutdown';

describe('shutdown lifecycle', () => {
  it('records and cleans up on Windows session end without before-quit, once across windows', () => {
    const app = new EventEmitter();
    const existing = new EventEmitter();
    const later = new EventEmitter();
    const cleanup = vi.fn();
    const recordExit = vi.fn();
    registerShutdownHandlers({
      app: app as App,
      windows: [existing as BrowserWindow],
      cleanup,
      recordExit,
      platform: 'win32',
    });
    app.emit('browser-window-created', {}, later);
    later.emit('session-end');
    expect(recordExit).toHaveBeenCalledWith('session-end');
    expect(cleanup).toHaveBeenCalledOnce();
    existing.emit('session-end');
    app.emit('before-quit');
    expect(recordExit).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('retains ordinary quit cleanup on every platform', () => {
    const app = new EventEmitter();
    const cleanup = vi.fn();
    const recordExit = vi.fn();
    registerShutdownHandlers({
      app: app as App,
      windows: [],
      cleanup,
      recordExit,
      platform: 'darwin',
    });
    app.emit('before-quit');
    expect(recordExit).toHaveBeenCalledWith('before-quit');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
