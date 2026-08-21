import { Socket } from 'node:net';

const GUARDED_TYPE_OF_SERVICE = Symbol('relay.guardedTypeOfService');

type TypeOfServiceSocket = {
  setTypeOfService?: TypeOfServiceMethod;
};

type TypeOfServiceMethod = (this: TypeOfServiceSocket, value: number) => TypeOfServiceSocket;

type GuardedTypeOfServiceMethod = TypeOfServiceMethod & {
  [GUARDED_TYPE_OF_SERVICE]?: true;
};

function isInvalidArgumentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EINVAL'
  );
}

/**
 * Guard Electron's embedded Undici against a macOS socket-state race.
 *
 * Undici versions bundled with Electron 42 call setTypeOfService(0) for every
 * HTTP/1.1 request. macOS can reject that best-effort QoS operation with EINVAL
 * while a socket is being reused or torn down, and the synchronous exception
 * escapes outside the fetch promise. Ignore only that platform-specific errno;
 * all other socket failures retain their normal behavior.
 */
export function installMacOsTypeOfServiceGuard(
  socketPrototype: TypeOfServiceSocket = Socket.prototype as TypeOfServiceSocket,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'darwin') return false;

  const original = socketPrototype.setTypeOfService as GuardedTypeOfServiceMethod | undefined;
  if (typeof original !== 'function' || original[GUARDED_TYPE_OF_SERVICE]) return false;

  const guarded: GuardedTypeOfServiceMethod = function (value) {
    try {
      return original.call(this, value);
    } catch (error) {
      if (isInvalidArgumentError(error)) return this;
      throw error;
    }
  };
  Object.defineProperty(guarded, GUARDED_TYPE_OF_SERVICE, { value: true });
  socketPrototype.setTypeOfService = guarded;
  return true;
}
