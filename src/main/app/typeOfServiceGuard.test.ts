import { describe, expect, it, vi } from 'vitest';
import { installMacOsTypeOfServiceGuard } from './typeOfServiceGuard';

type TestSocket = {
  setTypeOfService?: (value: number) => TestSocket;
};

function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(`setTypeOfService ${code}`), { code });
}

describe('installMacOsTypeOfServiceGuard', () => {
  it('ignores macOS EINVAL failures from best-effort socket QoS marking', () => {
    const original = vi.fn(function (this: TestSocket) {
      throw errno('EINVAL');
    });
    const socketPrototype: TestSocket = { setTypeOfService: original };

    expect(installMacOsTypeOfServiceGuard(socketPrototype, 'darwin')).toBe(true);
    expect(socketPrototype.setTypeOfService?.(0)).toBe(socketPrototype);
    expect(original).toHaveBeenCalledWith(0);
  });

  it('does not hide unrelated socket failures', () => {
    const socketPrototype: TestSocket = {
      setTypeOfService() {
        throw errno('EBADF');
      },
    };

    expect(installMacOsTypeOfServiceGuard(socketPrototype, 'darwin')).toBe(true);
    expect(() => socketPrototype.setTypeOfService?.(0)).toThrow('setTypeOfService EBADF');
  });

  it('leaves other platforms unchanged', () => {
    const original = vi.fn(function (this: TestSocket) {
      return this;
    });
    const socketPrototype: TestSocket = { setTypeOfService: original };

    expect(installMacOsTypeOfServiceGuard(socketPrototype, 'linux')).toBe(false);
    expect(socketPrototype.setTypeOfService).toBe(original);
  });

  it('does not wrap the socket method more than once', () => {
    const socketPrototype: TestSocket = {
      setTypeOfService() {
        return this;
      },
    };

    expect(installMacOsTypeOfServiceGuard(socketPrototype, 'darwin')).toBe(true);
    const guardedMethod = socketPrototype.setTypeOfService;
    expect(installMacOsTypeOfServiceGuard(socketPrototype, 'darwin')).toBe(false);
    expect(socketPrototype.setTypeOfService).toBe(guardedMethod);
  });
});
