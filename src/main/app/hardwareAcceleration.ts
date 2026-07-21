import type { App } from 'electron';

type HardwareAccelerationDecisionOptions = {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  disableEnv?: string;
};

type HardwareAccelerationConfigOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

type ElectronPerformancePolicyOptions = {
  platform?: NodeJS.Platform;
};

type HardwareAccelerationApp = Pick<App, 'disableHardwareAcceleration' | 'commandLine'> & {
  isPackaged: boolean;
};

type ElectronPerformancePolicyApp = Pick<App, 'commandLine'>;

/* Hardware acceleration is ON by default everywhere. The env var remains as
   an opt-out for machines with broken GPU drivers (the original reason this
   module exists): set RELAY_DISABLE_HARDWARE_ACCELERATION=1 on that machine. */
export function shouldDisableHardwareAcceleration({
  disableEnv,
}: HardwareAccelerationDecisionOptions): boolean {
  return disableEnv === '1';
}

export function configureHardwareAcceleration(
  app: HardwareAccelerationApp,
  options: HardwareAccelerationConfigOptions = {},
): boolean {
  const disabled = shouldDisableHardwareAcceleration({
    platform: options.platform ?? process.platform,
    isPackaged: app.isPackaged,
    disableEnv: options.env?.RELAY_DISABLE_HARDWARE_ACCELERATION,
  });

  if (disabled) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }

  return disabled;
}

export function configureElectronPerformancePolicy(
  app: ElectronPerformancePolicyApp,
  options: ElectronPerformancePolicyOptions = {},
): void {
  if ((options.platform ?? process.platform) === 'win32') {
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  }
}
