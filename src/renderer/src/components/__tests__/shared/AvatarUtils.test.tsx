import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Avatar, getInitials, GroupPill } from '../../shared/AvatarUtils';

describe('getInitials', () => {
  it('uses the first letter of the first two words', () => {
    expect(getInitials('Ada Lovelace', 'ada@example.com')).toBe('AL');
  });

  // Regression: `name.trim().split(' ')` keeps the empty segments produced by
  // repeated separators, so `parts[1][0]` was `undefined` and string
  // concatenation rendered the literal initials "JUNDEFINED".
  it.each([
    ['John  Doe', 'JD'],
    ['John   Doe', 'JD'],
    ['  Grace   Brewster   Hopper  ', 'GB'],
  ])('skips empty name segments for %j', (name, expected) => {
    expect(getInitials(name, 'someone@example.com')).toBe(expected);
  });

  it('never emits the string "UNDEFINED"', () => {
    expect(getInitials('John  Doe', 'j@example.com')).not.toContain('UNDEFINED');
  });

  it('falls back to the first two characters for a single-word name', () => {
    expect(getInitials('Prince', 'prince@example.com')).toBe('PR');
  });

  it('falls back to the email initial when the name has no letters', () => {
    expect(getInitials('. - _', 'zoe@example.com')).toBe('Z');
    expect(getInitials('', 'zoe@example.com')).toBe('Z');
  });

  it('returns a placeholder when neither name nor email is usable', () => {
    expect(getInitials('', '')).toBe('?');
  });
});

describe('Avatar', () => {
  it('renders the computed initials', () => {
    render(<Avatar name="Ada  Lovelace" email="ada@example.com" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});

describe('GroupPill', () => {
  it('renders the group name in upper case', () => {
    render(<GroupPill group="platform" />);
    expect(screen.getByText('PLATFORM')).toBeInTheDocument();
  });
});
