import { describe, expect, it } from 'vitest';
import type { OnCallRow } from '@shared/ipc';
import { getOnCallRoleLabel, getVacantOnCallTeams, isStaffedOnCallRow } from '../onCallRoles';

const row = (team: string, name: string, contact = '', teamId = team.toLowerCase()): OnCallRow =>
  ({
    id: `${teamId}-${name}`,
    team,
    teamId,
    role: 'Primary',
    name,
    contact,
    timeWindow: '',
  }) as OnCallRow;

describe('getOnCallRoleLabel', () => {
  it('normalises free-text roles to the full role word the board shows', () => {
    expect(getOnCallRoleLabel('primary')).toBe('Primary');
    expect(getOnCallRoleLabel('Secondary')).toBe('Secondary');
    expect(getOnCallRoleLabel('standby')).toBe('Standby');
    expect(getOnCallRoleLabel('Backup/Weekend')).toBe('Backup/Weekend');
    expect(getOnCallRoleLabel('')).toBe('Member');
    expect(getOnCallRoleLabel(' Incident Commander ')).toBe('Incident Commander');
  });
});

describe('getVacantOnCallTeams', () => {
  it('lists teams without a named or numbered row, in board order', () => {
    expect(
      getVacantOnCallTeams([
        row('Network Ops', 'Hedy Lamarr'),
        row('Payments Escalation', ''),
        row('Facilities', '  '),
        row('Facilities', ''),
        row('Database', '', '555-0100'),
      ]),
    ).toEqual(['Payments Escalation', 'Facilities']);
  });

  it('counts a team covered once any of its rows is staffed', () => {
    expect(getVacantOnCallTeams([row('SRE', ''), row('SRE', 'Ada Lovelace')])).toEqual([]);
  });

  it('treats a row as staffed by name or number', () => {
    expect(isStaffedOnCallRow({ name: 'Ada', contact: '' })).toBe(true);
    expect(isStaffedOnCallRow({ name: ' ', contact: '555' })).toBe(true);
    expect(isStaffedOnCallRow({ name: ' ', contact: '' })).toBe(false);
  });
});
