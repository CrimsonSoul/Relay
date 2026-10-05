import { EventEmitter } from 'node:events';
import type { App, BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerShutdownHandlers, settleShutdownTask } from '../shutdown';

describe('shutdown lifecycle', () => {
  it('cleans up on Windows session end without before-quit, once across windows', () => {
    const app = new EventEmitter();
    const existing = new EventEmitter();
    const later = new EventEmitter();
    const cleanup = vi.fn();
    registerShutdownHandlers({
      app: app as App,
      windows: [existing as BrowserWindow],
      cleanup,
      platform: 'win32',
    });
    app.emit('browser-window-created', {}, later);
    later.emit('session-end');
    expect(cleanup).toHaveBeenCalledOnce();
    existing.emit('session-end');
    app.emit('before-quit');
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('retains ordinary quit cleanup on every platform', () => {
    const app = new EventEmitter();
    const cleanup = vi.fn();
    registerShutdownHandlers({
      app: app as App,
      windows: [],
      cleanup,
      platform: 'darwin',
    });
    app.emit('before-quit');
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('reports a shutdown task that rejects instead of leaving it unhandled', async () => {
    const failure = new Error('PocketBase is gone');
    const reported = new Promise<[string, unknown]>((resolve) => {
      settleShutdownTask('relay-web', undefined, (name, error) => resolve([name, error]));
      settleShutdownTask('privileged-access', Promise.reject(failure), (name, error) =>
        resolve([name, error]),
      );
    });
    expect(await reported).toEqual(['privileged-access', failure]);
  });
});
