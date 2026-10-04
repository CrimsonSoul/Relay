import { describe, it, expect } from 'vitest';
import { getPlatformLabel } from '../platformLabel';

describe('getPlatformLabel', () => {
  it.each([
    ['Windows 10', 'WINDOWS'],
    ['Win2019', 'WINDOWS'],
    ['Microsoft Windows Server', 'WINDOWS'],
    ['Darwin 23.1', 'DARWIN 23.1'],
    ['Ubuntu 22.04', 'LINUX'],
    ['RHEL 8', 'LINUX'],
    ['VMware ESX 7', 'VMWARE'],
    ['Solaris', 'SOLARIS'],
    ['', 'UNKNOWN'],
  ])('labels %j as %s', (os, label) => {
    expect(getPlatformLabel(os)).toBe(label);
  });

  it('returns UNKNOWN when no argument passed', () => {
    expect(getPlatformLabel()).toBe('UNKNOWN');
  });
});
