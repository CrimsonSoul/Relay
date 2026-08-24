import { describe, expect, it } from 'vitest';
import { parseRecoveryLaunchIntent } from './RecoveryLaunchIntent';

describe('parseRecoveryLaunchIntent', () => {
  it('accepts one exact recovery-center argument only for packaged Windows', () => {
    expect(parseRecoveryLaunchIntent(['Relay.exe', '--relay-recovery-center'], 'win32', true)).toBe(
      'recovery',
    );
    expect(
      parseRecoveryLaunchIntent(
        ['Relay.exe', '--relay-recovery-center', '--relay-recovery-center'],
        'win32',
        true,
      ),
    ).toBeNull();
    expect(
      parseRecoveryLaunchIntent(['Relay.exe', '--relay-recovery-center=other'], 'win32', true),
    ).toBeNull();
    expect(
      parseRecoveryLaunchIntent(['Relay.exe', '--relay-recovery-center'], 'darwin', true),
    ).toBeNull();
    expect(
      parseRecoveryLaunchIntent(['Relay.exe', '--relay-recovery-center'], 'win32', false),
    ).toBeNull();
  });
});
