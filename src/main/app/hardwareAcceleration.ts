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

type HardwareAccelerationApp = Pick<App, 'disableHardwareAcceleration' | 'commandLine'> & {
  isPackaged: boolean;
};

export function shouldDisableHardwareAcceleration({
  platform,
  isPackaged,
  disableEnv,
}: HardwareAccelerationDecisionOptions): boolean {
  return disableEnv === '1' || (platform === 'win32' && isPackaged);
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
