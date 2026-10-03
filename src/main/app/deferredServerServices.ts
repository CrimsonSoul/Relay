import type { ServerConfig } from '../config/AppConfig';

type DeferredServerServiceDependencies = {
  startDataManagers(): void;
  startPocketBaseServices(config: ServerConfig): void | (() => void);
};

export function createDeferredServerServices(dependencies: DeferredServerServiceDependencies) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleanupPocketBaseServices: (() => void) | null = null;

  const cancelCurrentWork = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    cleanupPocketBaseServices?.();
    cleanupPocketBaseServices = null;
  };

  return {
    schedule(config: ServerConfig): void {
      cancelCurrentWork();
      timer = setTimeout(() => {
        timer = null;
        dependencies.startDataManagers();
        cleanupPocketBaseServices = dependencies.startPocketBaseServices(config) ?? null;
      }, 0);
    },
    cancel(): void {
      cancelCurrentWork();
    },
  };
}
