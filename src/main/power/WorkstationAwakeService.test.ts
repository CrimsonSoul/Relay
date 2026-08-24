import { describe, expect, it, vi } from 'vitest';
import type { WorkstationAwakeState } from '@shared/workstationAwake';
import { WorkstationAwakeService } from './WorkstationAwakeService';

const activeState: WorkstationAwakeState = {
  supported: true,
  enabled: true,
  status: 'active',
};
const disabledState: WorkstationAwakeState = {
  supported: true,
  enabled: false,
  status: 'disabled',
};

describe('WorkstationAwakeService', () => {
  it('enables protection at startup when the default preference is active', () => {
    const enable = vi.fn(() => activeState);
    const service = new WorkstationAwakeService(
      {
        enable,
        disable: vi.fn(() => disabledState),
        getState: vi.fn(() => disabledState),
      },
      { loadEnabled: () => true, saveEnabled: vi.fn() },
    );

    expect(service.initialize()).toEqual(activeState);
    expect(enable).toHaveBeenCalledOnce();
  });

  it('persists an opt-out before disabling active protection', () => {
    const calls: string[] = [];
    const service = new WorkstationAwakeService(
      {
        enable: () => activeState,
        disable: () => {
          calls.push('disable');
          return disabledState;
        },
        getState: () => activeState,
      },
      {
        loadEnabled: () => true,
        saveEnabled: (enabled) => calls.push(`save:${enabled}`),
      },
    );

    expect(service.setEnabled(false)).toEqual(disabledState);
    expect(calls).toEqual(['save:false', 'disable']);
  });

  it('keeps the runtime state unchanged when saving the preference fails', () => {
    const disable = vi.fn(() => disabledState);
    const service = new WorkstationAwakeService(
      {
        enable: () => activeState,
        disable,
        getState: () => activeState,
      },
      {
        loadEnabled: () => true,
        saveEnabled: () => {
          throw new Error('disk unavailable');
        },
      },
    );

    expect(() => service.setEnabled(false)).toThrow('disk unavailable');
    expect(disable).not.toHaveBeenCalled();
  });
});
