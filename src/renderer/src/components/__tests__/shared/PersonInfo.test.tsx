import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PersonInfo, getPlatformColor } from '../../shared/PersonInfo';
import type { Contact } from '@shared/ipc';

// Minimal mock for Tooltip to avoid portal complexity
vi.mock('../../Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeContact = (name: string, id: string): Contact => ({
  id,
  name,
  title: '',
  email: '',
  phone: '',
  callSign: '',
  groups: [],
  servers: [],
});

describe('getPlatformColor', () => {
  it('returns WINDOWS colors for windows OS', () => {
    const c = getPlatformColor('Windows 10');
    expect(c.label).toBe('WINDOWS');
    expect(c.text).toBe('#FBBF24');
  });

  it('returns LINUX colors for linux OS', () => {
    const c = getPlatformColor('Ubuntu 22.04');
    expect(c.label).toBe('LINUX');
    expect(c.text).toBe('#FB923C');
  });

  it('returns LINUX colors for RHEL', () => {
    const c = getPlatformColor('RHEL 8');
    expect(c.label).toBe('LINUX');
  });

  it('returns VMWARE colors for vmware OS', () => {
    const c = getPlatformColor('VMware ESX 7');
    expect(c.label).toBe('VMWARE');
    expect(c.text).toBe('#A78BFA');
  });

  it('returns default colors for unknown OS', () => {
    const c = getPlatformColor('Solaris');
    expect(c.label).toBe('SOLARIS');
  });

  it('returns UNKNOWN label for empty string', () => {
    const c = getPlatformColor('');
    expect(c.label).toBe('UNKNOWN');
  });

  it('returns default when no argument passed', () => {
    const c = getPlatformColor();
    expect(c.label).toBe('UNKNOWN');
  });
});

describe('PersonInfo', () => {
  it('renders empty state when value is empty string', () => {
    render(<PersonInfo label="Primary" value="" contactLookup={new Map()} />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders empty state when value is dash', () => {
    render(<PersonInfo label="Secondary" value="-" contactLookup={new Map()} />);
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders empty state when value is "0"', () => {
    render(<PersonInfo label="Tech" value="0" contactLookup={new Map()} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders display name for a found contact', () => {
    const contact = makeContact('Alice Smith', '1');
    const lookup = new Map([['alice smith', contact]]);
    render(<PersonInfo label="Tech" value="Alice Smith" contactLookup={lookup} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders raw value when contact is not found', () => {
    render(<PersonInfo label="Lead" value="Bob Jones" contactLookup={new Map()} />);
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('renders overflow count for multiple contacts', () => {
    const c1 = makeContact('Alice', '1');
    const c2 = makeContact('Bob', '2');
    const lookup = new Map([
      ['alice', c1],
      ['bob', c2],
    ]);
    render(<PersonInfo label="Team" value="Alice; Bob" contactLookup={lookup} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows avatar initials from display name', () => {
    const contact = makeContact('Charlie Brown', '3');
    const lookup = new Map([['charlie brown', contact]]);
    render(<PersonInfo label="Lead" value="Charlie Brown" contactLookup={lookup} />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });
});
