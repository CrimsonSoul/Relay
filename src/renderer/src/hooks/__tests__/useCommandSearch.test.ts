import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCommandSearch } from '../useCommandSearch';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import type { Contact, Server, BridgeGroup, OnCallRow } from '@shared/ipc';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';

const FIXTURE_TIMESTAMP = '2026-07-14T12:00:00.000Z';
const FIXTURE_EPOCH_MS = Date.parse(FIXTURE_TIMESTAMP);

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  email: 'alice@example.com',
  name: 'Alice Smith',
  title: 'Engineer',
  phone: '',
  _searchString: 'alice smith engineer alice@example.com',
  raw: {},
  ...overrides,
});

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'Alpha Bridge',
  businessArea: 'Ops',
  lob: 'Network',
  comment: '',
  owner: 'Bob',
  contact: 'bob@example.com',
  os: 'linux',
  _searchString: 'alpha bridge bob ops',
  raw: {},
  ...overrides,
});

const makeGroup = (overrides: Partial<BridgeGroup> = {}): BridgeGroup => ({
  id: 'g1',
  name: 'Group Alpha',
  contacts: [],
  createdAt: FIXTURE_EPOCH_MS,
  updatedAt: FIXTURE_EPOCH_MS,
  ...overrides,
});

const makeKnowledgeDocument = (
  overrides: Partial<KnowledgeDocumentRecord> = {},
): KnowledgeDocumentRecord => ({
  id: 'kb-1',
  sourceKey: 'Operations/Lane recovery.pdf',
  category: 'Operations',
  categoryId: 'category-operations',
  documentType: 'sop',
  title: 'Lane recovery',
  fileName: 'Lane recovery.pdf',
  pdf: 'Lane recovery.pdf',
  cover: null,
  checksum: 'a'.repeat(64),
  byteSize: 1024,
  pageCount: 3,
  outline: [
    { id: 'heading', label: 'Restart the store service', level: 1, pageIndex: 1, top: 700 },
  ],
  outlineSource: 'native',
  sourceModifiedAt: FIXTURE_TIMESTAMP,
  indexedAt: FIXTURE_TIMESTAMP,
  searchIndexState: 'ready',
  searchIndexChecksum: 'b'.repeat(64),
  searchIndexVersion: 1,
  searchIndexedAt: FIXTURE_TIMESTAMP,
  searchIndexError: null,
  lifecycleState: 'active',
  displayTitle: 'Lane recovery',
  revision: 1,
  publishedByAccountId: 'account-ops',
  publishedByName: 'Ops Publisher',
  publishedAt: FIXTURE_TIMESTAMP,
  trashedByAccountId: null,
  trashedByName: null,
  trashedAt: null,
  created: FIXTURE_TIMESTAMP,
  updated: FIXTURE_TIMESTAMP,
  ...overrides,
});

describe('useCommandSearch', () => {
  describe('SDP search', () => {
    it('offers an SDP-wide ticket search for typed text on the desktop only', () => {
      const original = globalThis.api;
      try {
        globalThis.api = { runtime: ELECTRON_RUNTIME } as typeof globalThis.api;
        const { result } = renderHook(() => useCommandSearch('  vpn down ', [], [], []));
        expect(result.current.find((item) => item.id === 'action-search-sdp')).toMatchObject({
          title: 'Search SDP for "vpn down"',
          data: { action: 'search-sdp', value: 'vpn down' },
        });
        globalThis.api = { runtime: WEB_RUNTIME } as typeof globalThis.api;
        const web = renderHook(() => useCommandSearch('vpn down', [], [], []));
        expect(web.result.current.some((item) => item.id === 'action-search-sdp')).toBe(false);
      } finally {
        globalThis.api = original;
      }
    });
  });
  describe('empty query', () => {
    it('returns 17 default action items when query is empty', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));
      expect(result.current).toHaveLength(17);
      expect(result.current.every((r) => r.type === 'action')).toBe(true);
    });

    it('returns the default actions with correct ids', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));
      const ids = result.current.map((r) => r.id);
      expect(ids).toContain('action-compose');
      expect(ids).toContain('action-personnel');
      expect(ids).toContain('action-contacts');
      expect(ids).toContain('action-wiki');
      expect(ids).toContain('action-servers');
      expect(ids).toContain('action-alerts');
      expect(ids).toContain('action-problems');
      expect(ids).toContain('action-create-contact');
      expect(ids).toContain('action-status');
      expect(ids).toContain('action-radar');
      expect(ids).toContain('action-tickets');
      expect(ids).toContain('action-settings');
      expect(ids).toContain('command-copy-all-on-call');
      expect(ids).toContain('command-add-all-on-call-to-bridge');
      expect(ids).toContain('command-clear-bridge');
      expect(ids).toContain('command-reset-alert');
      expect(ids).toContain('action-open-help');
    });

    it('routes the Contacts action through the Knowledge workspace', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));

      expect(result.current.find((item) => item.id === 'action-contacts')).toMatchObject({
        title: 'Go to Contacts',
        data: { action: 'open-knowledge', destination: 'contacts' },
      });
    });

    it('routes the Wiki action through the Knowledge workspace with its own icon', () => {
      const { result } = renderHook(() => useCommandSearch('', [], [], []));

      expect(result.current.find((item) => item.id === 'action-wiki')).toMatchObject({
        title: 'Go to Wiki',
        iconType: 'wiki',
        data: { action: 'open-knowledge', destination: 'wiki' },
      });
      expect(result.current.find((item) => item.id === 'action-problems')).toMatchObject({
        iconType: 'problems',
      });
      expect(result.current.find((item) => item.id === 'action-servers')).toMatchObject({
        title: 'Go to Servers',
        iconType: 'servers',
        data: { action: 'open-knowledge', destination: 'servers' },
      });
      expect(result.current.find((item) => item.id === 'action-alerts')).toMatchObject({
        title: 'Go to Alerts',
        iconType: 'alerts',
        data: { action: 'navigate', tab: 'Alerts' },
      });
    });

    it('returns empty results for whitespace-only query', () => {
      const { result } = renderHook(() => useCommandSearch('   ', [], [], []));
      // whitespace trims to empty → returns default actions
      expect(result.current).toHaveLength(17);
    });
  });

  describe('navigation action search', () => {
    it.each([
      ['alerts', 'action-alerts'],
      ['servers', 'action-servers'],
      ['wiki', 'action-wiki'],
      ['dynatrace', 'action-problems'],
      ['status', 'action-status'],
      ['radar', 'action-radar'],
      ['tickets', 'action-tickets'],
      ['settings', 'action-settings'],
    ])('keeps the %s navigation action searchable', (query, actionId) => {
      const { result } = renderHook(() => useCommandSearch(query, [], [], []));

      expect(result.current.map(({ id }) => id)).toContain(actionId);
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
      expect(result.current[0]?.type).toBe('contact');
      expect(result.current[0]?.id).toBe('contact-alice@example.com');
    });

    it('uses email as title when name is empty', () => {
      const contact = makeContact({
        name: '',
        email: 'noname@x.com',
        _searchString: 'noname@x.com',
      });
      const { result } = renderHook(() => useCommandSearch('noname', [contact], [], []));
      expect(result.current[0]?.title).toBe('noname@x.com');
    });

    it('uses name as title and email as subtitle when name present', () => {
      const contact = makeContact({ name: 'Alice', email: 'alice@x.com', _searchString: 'alice' });
      const { result } = renderHook(() => useCommandSearch('alice', [contact], [], []));
      expect(result.current[0]?.title).toBe('Alice');
      expect(result.current[0]?.subtitle).toBe('alice@x.com');
    });

    it('uses title as subtitle when name is absent', () => {
      const contact = makeContact({
        name: '',
        title: 'Director',
        email: 'x@x.com',
        _searchString: 'director',
      });
      const { result } = renderHook(() => useCommandSearch('director', [contact], [], []));
      expect(result.current[0]?.subtitle).toBe('Director');
    });
  });

  describe('server search', () => {
    it('finds servers by search string', () => {
      const server = makeServer({ _searchString: 'alpha bridge bob ops' });
      const { result } = renderHook(() => useCommandSearch('alpha', [], [server], []));
      expect(result.current).toHaveLength(1);
      expect(result.current[0]?.type).toBe('server');
      expect(result.current[0]?.title).toBe('Alpha Bridge');
    });

    it('uses businessArea as subtitle', () => {
      const server = makeServer({ businessArea: 'Ops', owner: 'Bob', _searchString: 'bridge' });
      const { result } = renderHook(() => useCommandSearch('bridge', [], [server], []));
      expect(result.current[0]?.subtitle).toBe('Ops');
    });

    it('falls back to owner when businessArea is absent', () => {
      const server = makeServer({ businessArea: '', owner: 'Bob', _searchString: 'bridge' });
      const { result } = renderHook(() => useCommandSearch('bridge', [], [server], []));
      expect(result.current[0]?.subtitle).toBe('Bob');
    });
  });

  describe('group search', () => {
    it('finds groups by name', () => {
      const group = makeGroup({ name: 'Incident Team' });
      const { result } = renderHook(() => useCommandSearch('incident', [], [], [group]));
      expect(result.current).toHaveLength(1);
      expect(result.current[0]?.type).toBe('group');
      expect(result.current[0]?.id).toBe('group-g1');
    });

    it('shows correct member count in subtitle', () => {
      const group = makeGroup({
        name: 'Team',
        contacts: [makeContact().email, makeContact({ email: 'b@b.com' }).email],
      });
      const { result } = renderHook(() => useCommandSearch('team', [], [], [group]));
      expect(result.current[0]?.subtitle).toBe('2 members');
    });

    it('uses singular "member" for 1 contact', () => {
      const group = makeGroup({ name: 'Solo', contacts: [makeContact().email] });
      const { result } = renderHook(() => useCommandSearch('solo', [], [], [group]));
      expect(result.current[0]?.subtitle).toBe('1 member');
    });
  });

  describe('result limiting', () => {
    it('returns all immediate candidates so the header can rank before capping', () => {
      const contacts: Contact[] = Array.from({ length: 20 }, (_, i) =>
        makeContact({ email: `user${i}@x.com`, _searchString: `user${i} user` }),
      );
      const { result } = renderHook(() => useCommandSearch('user', contacts, [], []));
      expect(result.current).toHaveLength(20);
    });
  });

  describe('knowledge search', () => {
    it('finds a document by extracted heading and preserves the document for navigation', () => {
      const guide = makeKnowledgeDocument();
      const { result } = renderHook(() => useCommandSearch('store service', [], [], [], [guide]));

      expect(result.current).toEqual([
        expect.objectContaining({
          id: 'knowledge-kb-1',
          type: 'knowledge',
          title: 'Lane recovery',
          subtitle: 'Operations · Restart the store service',
          data: { document: guide, headingId: 'heading' },
        }),
      ]);
    });
  });

  describe('case-insensitive search', () => {
    it('matches uppercase query against lowercase search string', () => {
      const contact = makeContact({ _searchString: 'alice smith' });
      const { result } = renderHook(() => useCommandSearch('ALICE', [contact], [], []));
      expect(result.current).toHaveLength(1);
    });
  });

  describe('on-call teams', () => {
    const row = (overrides: Partial<OnCallRow>): OnCallRow => ({
      id: 'r1',
      team: 'Network Ops',
      teamId: 'network',
      role: 'Primary',
      name: 'Alice',
      contact: '',
      ...overrides,
    });

    it('finds a team by name once and names who is on call', () => {
      const onCall = [
        row({}),
        row({ id: 'r2', role: 'Backup', name: 'Bob' }),
        row({ id: 'r3', team: 'Database', teamId: 'db', name: 'Cara' }),
      ];
      const { result } = renderHook(() => useCommandSearch('network', [], [], [], [], { onCall }));

      expect(result.current.filter((item) => item.type === 'team')).toEqual([
        {
          id: 'team-network',
          type: 'team',
          title: 'Network Ops',
          subtitle: 'Alice (Primary) · Bob (Backup)',
          iconType: 'personnel',
          data: { teamId: 'network', team: 'Network Ops' },
        },
      ]);
    });

    it('says No coverage when nobody is named and caps the preview', () => {
      const vacant = renderHook(() =>
        useCommandSearch('network', [], [], [], [], { onCall: [row({ name: ' ' })] }),
      );
      expect(vacant.result.current[0]?.subtitle).toBe('No coverage');

      const onCall = ['A', 'B', 'C', 'D', 'E'].map((name, index) =>
        row({ id: `r${index}`, name, role: '' }),
      );
      const crowded = renderHook(() => useCommandSearch('network', [], [], [], [], { onCall }));
      expect(crowded.result.current[0]?.subtitle).toBe('A · B · C · +2 more');
    });
  });

  describe('Dynatrace problems', () => {
    const problem = {
      id: 'rec-1',
      problemId: 'p-internal-1',
      displayId: 'P-1001',
      title: 'Database unavailable',
      status: 'OPEN',
    } as DynatraceProblemRecord;

    it.each(['P-1001', '1001', 'database'])('finds an open problem by "%s"', (query) => {
      const { result } = renderHook(() =>
        useCommandSearch(query, [], [], [], [], { problems: [problem] }),
      );

      expect(result.current[0]).toEqual({
        id: 'problem-p-internal-1',
        type: 'problem',
        title: 'P-1001 · Database unavailable',
        subtitle: 'Dynatrace problem · currently open',
        iconType: 'problems',
        data: { problemId: 'p-internal-1' },
      });
    });

    it('ignores problems that do not match', () => {
      const { result } = renderHook(() =>
        useCommandSearch('P-2002', [], [], [], [], { problems: [problem] }),
      );
      expect(result.current.some((item) => item.type === 'problem')).toBe(false);
    });
  });

  describe('tab commands', () => {
    it.each([
      ['copy all', 'command-copy-all-on-call', 'Personnel', 'copy-all-on-call'],
      [
        'add all on call',
        'command-add-all-on-call-to-bridge',
        'Personnel',
        'add-all-on-call-to-bridge',
      ],
      ['clear bridge', 'command-clear-bridge', 'Compose', 'clear-bridge'],
      ['reset alert', 'command-reset-alert', 'Alerts', 'reset-alert'],
    ])('"%s" finds %s on its owning tab', (query, id, tab, command) => {
      const { result } = renderHook(() => useCommandSearch(query, [], [], []));

      expect(result.current.find((item) => item.id === id)).toMatchObject({
        type: 'action',
        data: { action: 'tab-command', tab, command },
      });
    });

    it('finds Open Help', () => {
      const { result } = renderHook(() => useCommandSearch('help', [], [], []));
      expect(result.current.find((item) => item.id === 'action-open-help')).toMatchObject({
        title: 'Open Help',
        data: { action: 'open-help' },
      });
    });
  });
});
