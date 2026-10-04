import type { App } from 'electron';

type HardwareAccelerationApp = Pick<App, 'disableHardwareAcceleration' | 'commandLine'>;

/* Hardware acceleration is ON by default everywhere. The env var remains as
   an opt-out for machines with broken GPU drivers (the original reason this
   module exists): set RELAY_DISABLE_HARDWARE_ACCELERATION=1 on that machine. */
export function configureHardwareAcceleration(
  app: HardwareAccelerationApp,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const disabled = env.RELAY_DISABLE_HARDWARE_ACCELERATION === '1';

  if (disabled) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }

  return disabled;
}
