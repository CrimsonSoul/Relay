import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as SidebarIcons from '../../sidebar/SidebarIcons';

const {
  ComposeIcon,
  PersonnelIcon,
  PeopleIcon,
  ServersIcon,
  StatusIcon,
  ProblemsIcon,
  SettingsIcon,
  AppIcon,
} = SidebarIcons;

describe('SidebarIcons', () => {
  const icons20 = [
    { name: 'ComposeIcon', Component: ComposeIcon },
    { name: 'PersonnelIcon', Component: PersonnelIcon },
    { name: 'PeopleIcon', Component: PeopleIcon },
    { name: 'ServersIcon', Component: ServersIcon },
    { name: 'StatusIcon', Component: StatusIcon },
    { name: 'ProblemsIcon', Component: ProblemsIcon },
    { name: 'SettingsIcon', Component: SettingsIcon },
  ];

  for (const { name, Component } of icons20) {
    it(`${name} renders an SVG with width/height 20`, () => {
      const { container } = render(<Component />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
    });
  }

  it('AppIcon renders an SVG with width/height 32', () => {
    const { container } = render(<AppIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });

  it('does not export the retired standalone Notes sidebar icon', () => {
    expect(SidebarIcons).not.toHaveProperty('NotesIcon');
  });
});
