export const E2E_DESKTOP_SIDE_EFFECTS_FLAG = 'RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS';

type ActivationPolicyApplication = {
  setActivationPolicy: (policy: 'accessory') => void;
};

export function shouldSuppressDesktopSideEffects(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV === 'test' && environment[E2E_DESKTOP_SIDE_EFFECTS_FLAG] === '1';
}

/** Prevent a macOS E2E process from becoming a foreground desktop application. */
export function configureE2EDesktopIsolation(
  application: ActivationPolicyApplication,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform !== 'darwin' || !shouldSuppressDesktopSideEffects(environment)) return false;
  application.setActivationPolicy('accessory');
  return true;
}
