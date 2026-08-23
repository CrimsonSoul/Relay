import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkstationAwakeManager } from './WorkstationAwakeManager';

describe('WorkstationAwakeManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the display awake and resets Windows idle activity every 30 seconds', () => {
    let blockerStarted = false;
    let pulseCount = 0;
    const manager = new WorkstationAwakeManager({
      platform: 'win32',
      powerSaveBlocker: {
        start: (type) => {
          expect(type).toBe('prevent-display-sleep');
          blockerStarted = true;
          return 41;
        },
        stop: () => {
          blockerStarted = false;
          return true;
        },
        isStarted: () => blockerStarted,
      },
      pulseInput: () => {
        pulseCount += 1;
        return true;
      },
    });

    expect(manager.enable()).toEqual({
      supported: true,
      enabled: true,
      status: 'active',
    });
    expect(pulseCount).toBe(1);

    vi.advanceTimersByTime(29_999);
    expect(pulseCount).toBe(1);
    vi.advanceTimersByTime(1);
    expect(pulseCount).toBe(2);
    expect(manager.getState().status).toBe('active');
  });

  it('releases the display blocker and stops idle pulses when disabled', () => {
    let blockerStarted = false;
    let pulseCount = 0;
    const manager = new WorkstationAwakeManager({
      platform: 'win32',
      powerSaveBlocker: {
        start: () => {
          blockerStarted = true;
          return 72;
        },
        stop: (id) => {
          expect(id).toBe(72);
          blockerStarted = false;
          return true;
        },
        isStarted: () => blockerStarted,
      },
      pulseInput: () => {
        pulseCount += 1;
        return true;
      },
    });

    manager.enable();
    expect(pulseCount).toBe(1);
    expect(manager.disable()).toEqual({
      supported: true,
      enabled: false,
      status: 'disabled',
    });
    vi.advanceTimersByTime(60_000);

    expect(blockerStarted).toBe(false);
    expect(pulseCount).toBe(1);
  });

  it('reports degraded protection when Windows rejects the synthetic input pulse', () => {
    const manager = new WorkstationAwakeManager({
      platform: 'win32',
      powerSaveBlocker: {
        start: () => 9,
        stop: () => true,
        isStarted: () => true,
      },
      pulseInput: () => false,
    });

    manager.enable();

    expect(manager.getState()).toEqual({
      supported: true,
      enabled: true,
      status: 'degraded',
      error: 'input-pulse-failed',
    });
  });

  it('continues idle pulses while reporting a failed display blocker', () => {
    let pulseCount = 0;
    const manager = new WorkstationAwakeManager({
      platform: 'win32',
      powerSaveBlocker: {
        start: () => {
          throw new Error('blocker unavailable');
        },
        stop: () => false,
        isStarted: () => false,
      },
      pulseInput: () => {
        pulseCount += 1;
        return true;
      },
    });

    expect(manager.enable()).toEqual({
      supported: true,
      enabled: true,
      status: 'degraded',
      error: 'display-blocker-failed',
    });
    expect(pulseCount).toBe(1);
  });

  it('recovers active status after a transient input pulse failure', () => {
    let pulseSucceeds = false;
    const manager = new WorkstationAwakeManager({
      platform: 'win32',
      powerSaveBlocker: {
        start: () => 8,
        stop: () => true,
        isStarted: () => true,
      },
      pulseInput: () => pulseSucceeds,
    });

    manager.enable();
    expect(manager.getState().status).toBe('degraded');

    pulseSucceeds = true;
    vi.advanceTimersByTime(30_000);
    expect(manager.getState()).toEqual({
      supported: true,
      enabled: true,
      status: 'active',
    });
  });
});
