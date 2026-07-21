import type { ServerConfig } from '../config/AppConfig';

type DeferredServerServiceDependencies = {
  startDataManagers(): void;
  startPocketBaseServices(config: ServerConfig): void;
};

export function createDeferredServerServices(dependencies: DeferredServerServiceDependencies) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(config: ServerConfig): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        dependencies.startDataManagers();
        dependencies.startPocketBaseServices(config);
      }, 0);
    },
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
