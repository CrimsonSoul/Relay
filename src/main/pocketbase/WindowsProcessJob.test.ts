import { describe, expect, it, vi } from 'vitest';
import { bindWindowsKillOnCloseJob } from './WindowsProcessJob';

describe('Windows kill-on-close process job', () => {
  it('sets KILL_ON_JOB_CLOSE and assigns only the requested process handle', () => {
    const createJobObject = vi.fn(() => 11);
    const setInformationJobObject = vi.fn(() => true);
    const openProcess = vi.fn(() => 22);
    const assignProcessToJobObject = vi.fn(() => true);
    const closeHandle = vi.fn((_handle: unknown) => true);
    const job = bindWindowsKillOnCloseJob({
      createJobObject,
      setInformationJobObject,
      openProcess,
      assignProcessToJobObject,
      closeHandle,
      informationSize: 144,
    });

    expect(setInformationJobObject).toHaveBeenCalledWith(
      11,
      9,
      expect.objectContaining({
        BasicLimitInformation: expect.objectContaining({ LimitFlags: 0x2000 }),
      }),
      144,
    );
    expect(job.assign(4321)).toBe(true);
    expect(openProcess).toHaveBeenCalledWith(0x0101, false, 4321);
    expect(assignProcessToJobObject).toHaveBeenCalledWith(11, 22);
    expect(closeHandle).toHaveBeenCalledWith(22);

    job.close();
    job.close();
    expect(closeHandle).toHaveBeenCalledWith(11);
    expect(closeHandle.mock.calls.filter(([handle]) => handle === 11)).toHaveLength(1);
  });

  it('fails closed when the job or its kill-on-close policy cannot be created', () => {
    const closeHandle = vi.fn((_handle: unknown) => true);
    expect(() =>
      bindWindowsKillOnCloseJob({
        createJobObject: () => 0,
        setInformationJobObject: vi.fn(),
        openProcess: vi.fn(),
        assignProcessToJobObject: vi.fn(),
        closeHandle,
        informationSize: 144,
      }),
    ).toThrow('create');

    expect(() =>
      bindWindowsKillOnCloseJob({
        createJobObject: () => 11,
        setInformationJobObject: () => false,
        openProcess: vi.fn(),
        assignProcessToJobObject: vi.fn(),
        closeHandle,
        informationSize: 144,
      }),
    ).toThrow('configure');
    expect(closeHandle).toHaveBeenCalledWith(11);
  });

  it('closes a process handle even when assignment fails', () => {
    const closeHandle = vi.fn((_handle: unknown) => true);
    const job = bindWindowsKillOnCloseJob({
      createJobObject: () => 11,
      setInformationJobObject: () => true,
      openProcess: () => 22,
      assignProcessToJobObject: () => false,
      closeHandle,
      informationSize: 144,
    });

    expect(job.assign(4321)).toBe(false);
    expect(closeHandle).toHaveBeenCalledWith(22);
    job.close();
  });
});
