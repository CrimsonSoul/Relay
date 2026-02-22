import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCommandSearch } from '../useCommandSearch';
import type { Contact, Server, BridgeGroup } from '@shared/ipc';

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  email: 'alice@example.com',
  name: 'Alice Smith',
  title: 'Engineer',
  phone: '',
  groups: [],
  onCallSchedules: [],
  _searchString: 'alice smith engineer alice@example.com',
  ...overrides,
});

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'Alpha Bridge',
  dialIn: '',
  accessCode: '',
  owner: 'Bob',
  businessArea: 'Ops',
  notes: '',
  groups: [],
  _searchString: 'alpha bridge bob ops',
  ...overrides,
});

const makeGroup = (overrides: Partial<BridgeGroup> = {}): BridgeGroup => ({
  id: 'g1',
  name: 'Group Alpha',
  contacts: [],
  ...overrides,
});

describe('useCommandSearch', () => {
  describe('empty query', () => {
    it('returns 5 default action items when query is empty', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));
      expect(result.current).toHaveLength(5);
      expect(result.current.every((r) => r.type === 'action')).toBe(true);
    });

    it('returns the 5 navigation actions with correct ids', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));
      const ids = result.current.map((r) => r.id);
      expect(ids).toContain('action-compose');
      expect(ids).toContain('action-personnel');
      expect(ids).toContain('action-people');
      expect(ids).toContain('action-weather');
      expect(ids).toContain('action-create-contact');
    });

    it('returns empty results for whitespace-only query', () => {
      const { result } = renderHook(() => useCommandSearch('   ', [], [], []));
      // whitespace trims to empty → returns default actions
      expect(result.current).toHaveLength(5);
    });
  });

  describe('email query', () => {
    it('adds add-manual action for valid email', () => {
      const { result } = renderHook(() => useCommandSearch('test@example.com', [], [], []));
      expect(result.current.some((r) => r.id === 'action-add-manual')).toBe(true);
    });

    it('includes create-contact-email when email does not exist in contacts', () => {
      const { result } = renderHook(() => useCommandSearch('new@example.com', [], [], []));
      expect(result.current.some((r) => r.id === 'action-create-contact-email')).toBe(true);
    });

    it('does NOT include create-contact-email when email already exists', () => {
      const contact = makeContact({ email: 'alice@example.com' });
      const { result } = renderHook(() => useCommandSearch('alice@example.com', [contact], [], []));
      expect(result.current.some((r) => r.id === 'action-create-contact-email')).toBe(false);
      expect(result.current.some((r) => r.id === 'action-add-manual')).toBe(true);
    });

    it('does not treat non-email queries as email', () => {
      const { result } = renderHook(() => useCommandSearch('notanemail', [], [], []));
      expect(result.current.some((r) => r.id === 'action-add-manual')).toBe(false);
    });
  });

  describe('contact search', () => {
    it('finds contacts matching search string', () => {
      const contact = makeContact({ _searchString: 'alice smith alice@example.com' });
      const { result } = renderHook(() => useCommandSearch('alice', [contact], [], []));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('contact');
      expect(result.current[0].id).toBe('contact-alice@example.com');
    });

    it('uses email as title when name is empty', () => {
      const contact = makeContact({
        name: '',
        email: 'noname@x.com',
        _searchString: 'noname@x.com',
      });
      const { result } = renderHook(() => useCommandSearch('noname', [contact], [], []));
      expect(result.current[0].title).toBe('noname@x.com');
    });

    it('uses name as title and email as subtitle when name present', () => {
      const contact = makeContact({ name: 'Alice', email: 'alice@x.com', _searchString: 'alice' });
      const { result } = renderHook(() => useCommandSearch('alice', [contact], [], []));
      expect(result.current[0].title).toBe('Alice');
      expect(result.current[0].subtitle).toBe('alice@x.com');
    });

    it('uses title as subtitle when name is absent', () => {
      const contact = makeContact({
        name: '',
        title: 'Director',
        email: 'x@x.com',
        _searchString: 'director',
      });
      const { result } = renderHook(() => useCommandSearch('director', [contact], [], []));
      expect(result.current[0].subtitle).toBe('Director');
    });
  });

  describe('server search', () => {
    it('finds servers by search string', () => {
      const server = makeServer({ _searchString: 'alpha bridge bob ops' });
      const { result } = renderHook(() => useCommandSearch('alpha', [], [server], []));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('server');
      expect(result.current[0].title).toBe('Alpha Bridge');
    });

    it('uses businessArea as subtitle', () => {
      const server = makeServer({ businessArea: 'Ops', owner: 'Bob', _searchString: 'bridge' });
      const { result } = renderHook(() => useCommandSearch('bridge', [], [server], []));
      expect(result.current[0].subtitle).toBe('Ops');
    });

    it('falls back to owner when businessArea is absent', () => {
      const server = makeServer({ businessArea: '', owner: 'Bob', _searchString: 'bridge' });
      const { result } = renderHook(() => useCommandSearch('bridge', [], [server], []));
      expect(result.current[0].subtitle).toBe('Bob');
    });
  });

  describe('group search', () => {
    it('finds groups by name', () => {
      const group = makeGroup({ name: 'Incident Team' });
      const { result } = renderHook(() => useCommandSearch('incident', [], [], [group]));
      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('group');
      expect(result.current[0].id).toBe('group-g1');
    });

    it('shows correct member count in subtitle', () => {
      const group = makeGroup({
        name: 'Team',
        contacts: [makeContact(), makeContact({ email: 'b@b.com' })],
      });
      const { result } = renderHook(() => useCommandSearch('team', [], [], [group]));
      expect(result.current[0].subtitle).toBe('2 members');
    });

    it('uses singular "member" for 1 contact', () => {
      const group = makeGroup({ name: 'Solo', contacts: [makeContact()] });
      const { result } = renderHook(() => useCommandSearch('solo', [], [], [group]));
      expect(result.current[0].subtitle).toBe('1 member');
    });
  });

  describe('result limiting', () => {
    it('limits results to 15', () => {
      const contacts: Contact[] = Array.from({ length: 20 }, (_, i) =>
        makeContact({ email: `user${i}@x.com`, _searchString: `user${i} user` }),
      );
      const { result } = renderHook(() => useCommandSearch('user', contacts, [], []));
      expect(result.current.length).toBeLessThanOrEqual(15);
    });
  });

  describe('case-insensitive search', () => {
    it('matches uppercase query against lowercase search string', () => {
      const contact = makeContact({ _searchString: 'alice smith' });
      const { result } = renderHook(() => useCommandSearch('ALICE', [contact], [], []));
      expect(result.current).toHaveLength(1);
    });
  });
});
