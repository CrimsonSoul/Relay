export const E2E_DESKTOP_SIDE_EFFECTS_FLAG = 'RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS';

export function shouldSuppressDesktopSideEffects(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV === 'test' && environment[E2E_DESKTOP_SIDE_EFFECTS_FLAG] === '1';
}
