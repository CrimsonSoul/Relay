# Relay Search Record Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Relay header search state its action explicitly, open contacts and servers at their exact Knowledge records, and require a separate deliberate action to add a contact to Compose.

**Architecture:** A small Knowledge record-navigation module defines stable contact/server keys and one-shot request types. `HeaderSearch` emits an open target, `App` stamps it with a monotonically increasing request ID and routes to Knowledge, and the retained Knowledge workspace passes it to the matching directory surface. Contacts and Servers clear only their local search/filter state, select and focus the exact virtual row, and report a missing record without changing Compose.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, react-window, Relay renderer CSS.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-05-relay-tab-operator-workflows-design.md`.
- Contact Enter/click means `Open contact`; it never mutates Compose.
- `Add to bridge` remains a separate inline contact action; groups keep the explicit `Add group to bridge` primary action.
- Use existing record IDs from `raw.id` when present, with normalized email/name compatibility keys for existing imported records without IDs.
- Navigation requests are one-shot and must not replay when retained tabs remount or become active again.
- No PocketBase schema, shared-record, authentication, offline, or protocol changes.
- Preserve the search query after contact/server lookup so a missing-record recovery never loses the operator's context; keep existing clearing for Wiki, navigation commands, groups, and explicit bridge actions.
- Relay Desktop and Relay Web use the same renderer behavior.

---

### Task 1: Stable Knowledge record request contract

**Files:**
- Create: `src/renderer/src/features/knowledge/knowledgeRecordNavigation.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/knowledgeRecordNavigation.test.ts`

**Interfaces:**
- Consumes: `Contact` and `Server` from `@shared/ipc`.
- Produces: `KnowledgeRecordTarget`, `KnowledgeRecordOpenRequest`, `contactRecordKey(contact)`, and `serverRecordKey(server)`.

- [ ] **Step 1: Write the failing key and request-type tests**

```ts
import type { Contact, Server } from '@shared/ipc';
import { describe, expect, it } from 'vitest';
import {
  contactRecordKey,
  serverRecordKey,
  type KnowledgeRecordOpenRequest,
} from '../knowledgeRecordNavigation';

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  name: 'Alex Operator',
  email: 'alex@example.com',
  phone: '',
  title: '',
  _searchString: 'alex operator alex@example.com',
  raw: {},
  ...overrides,
});

const makeServer = (overrides: Partial<Server> = {}): Server => ({
  name: 'web-01',
  businessArea: '',
  lob: '',
  comment: '',
  owner: '',
  contact: '',
  os: '',
  _searchString: 'web-01',
  raw: {},
  ...overrides,
});

it('prefers PocketBase record IDs and falls back to normalized compatibility keys', () => {
  expect(contactRecordKey(makeContact({ raw: { id: 'contact_1' } }))).toBe('id:contact_1');
  expect(contactRecordKey(makeContact({ email: ' OPS@Example.com ', raw: {} }))).toBe(
    'email:ops@example.com',
  );
  expect(serverRecordKey(makeServer({ raw: { id: 'server_1' } }))).toBe('id:server_1');
  expect(serverRecordKey(makeServer({ name: ' WEB-01 ', raw: {} }))).toBe('name:web-01');
});

it('keeps destination, key, and request identity together', () => {
  const request: KnowledgeRecordOpenRequest = {
    requestId: 4,
    destination: 'servers',
    recordKey: 'id:server_1',
  };
  expect(request).toEqual({ requestId: 4, destination: 'servers', recordKey: 'id:server_1' });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/knowledgeRecordNavigation.test.ts`

Expected: FAIL because `knowledgeRecordNavigation.ts` does not exist.

- [ ] **Step 3: Add the stable-key helpers and discriminated request types**

```ts
import type { Contact, Server } from '@shared/ipc';

export type KnowledgeRecordDestination = 'contacts' | 'servers';

export type KnowledgeRecordTarget = {
  destination: KnowledgeRecordDestination;
  recordKey: string;
};

export type KnowledgeRecordOpenRequest = KnowledgeRecordTarget & {
  requestId: number;
};

export function contactRecordKey(contact: Contact): string {
  const id = contact.raw.id?.trim();
  return id ? `id:${id}` : `email:${contact.email.trim().toLowerCase()}`;
}

export function serverRecordKey(server: Server): string {
  const id = server.raw.id?.trim();
  return id ? `id:${id}` : `name:${server.name.trim().toLowerCase()}`;
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npm run test:renderer -- src/renderer/src/features/knowledge/__tests__/knowledgeRecordNavigation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the record-navigation contract**

```bash
git add src/renderer/src/features/knowledge/knowledgeRecordNavigation.ts src/renderer/src/features/knowledge/__tests__/knowledgeRecordNavigation.test.ts
git commit -m "feat: define Knowledge record navigation requests"
```

### Task 2: Explicit search verbs and separate bridge mutation

**Files:**
- Modify: `src/renderer/src/components/HeaderSearch.tsx`
- Modify: `src/renderer/src/components/__tests__/HeaderSearch.test.tsx`
- Modify: `src/renderer/src/styles/modals.css`

**Interfaces:**
- Consumes: `KnowledgeRecordTarget`, `contactRecordKey`, and `serverRecordKey` from Task 1.
- Produces: `HeaderSearchActions.onOpenKnowledgeRecord(target: KnowledgeRecordTarget): void`; primary result activation always performs the displayed verb.

- [ ] **Step 1: Replace contact-mutation expectations with explicit-verb failing tests**

```tsx
it('opens a contact on Enter and exposes bridge mutation as a separate inline action', async () => {
  const actions = { ...defaultActions, onOpenKnowledgeRecord: vi.fn() };
  mockSearchContext.query = 'alex';
  mockSearchContext.isSearchFocused = true;
  mockSearchResults.push({
    id: 'contact-alex@example.com',
    type: 'contact',
    title: 'Alex',
    subtitle: 'alex@example.com',
    iconType: 'contact',
    data: makeContact({ raw: { id: 'contact_1' } }),
  });
  render(<HeaderSearch {...defaultProps} actions={actions} />);

  expect(screen.getByText('Open contact')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

  expect(actions.onOpenKnowledgeRecord).toHaveBeenCalledWith({
    destination: 'contacts',
    recordKey: 'id:contact_1',
  });
  expect(actions.onAddContactToBridge).not.toHaveBeenCalled();
  expect(mockSearchContext.clearSearch).not.toHaveBeenCalled();
});

it('adds a contact only from its inline Add to bridge action', async () => {
  const actions = { ...defaultActions, onOpenKnowledgeRecord: vi.fn() };
  mockSearchContext.query = 'alex';
  mockSearchContext.isSearchFocused = true;
  mockSearchResults.push({
    id: 'contact-alex@example.com',
    type: 'contact',
    title: 'Alex',
    iconType: 'contact',
    data: makeContact(),
  });
  render(<HeaderSearch {...defaultProps} actions={actions} />);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Add Alex to bridge' }));
  expect(actions.onAddContactToBridge).toHaveBeenCalledWith('alex@example.com');
  expect(actions.onOpenKnowledgeRecord).not.toHaveBeenCalled();
});

it.each([
  ['server', 'Open server', makeServer()],
  ['knowledge', 'Open document', { document: { id: 'kb-1', outline: [] } }],
  ['group', 'Add group to bridge', { id: 'group-1' }],
] as const)('shows the activation verb for a %s result', (type, verb, data) => {
  mockSearchContext.query = 'result';
  mockSearchContext.isSearchFocused = true;
  mockSearchResults.push({ id: `${type}-1`, type, title: 'Result', iconType: type, data });
  render(<HeaderSearch {...defaultProps} />);
  expect(screen.getByText(verb)).toBeVisible();
});
```

Add the exact `makeContact` and `makeServer` factories from Task 1 to `HeaderSearch.test.tsx`; the minimal Knowledge/group objects above are sufficient because this test asserts rendering rather than activation.

Extend the test fixture at the same time so every existing test receives the new required action:

```tsx
const defaultActions: HeaderSearchActions = {
  onAddContactToBridge: vi.fn(),
  onToggleGroup: vi.fn(),
  onNavigateToTab: vi.fn(),
  onOpenKnowledgeDestination: vi.fn(),
  onOpenKnowledgeRecord: vi.fn(),
  onOpenAddContact: vi.fn(),
  onOpenKnowledgeDocument: vi.fn(),
};
```

- [ ] **Step 2: Run HeaderSearch tests to verify the new assertions fail**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx`

Expected: FAIL because contact primary activation still calls `onAddContactToBridge` and result verbs are absent.

- [ ] **Step 3: Add the record-open action and verb mapping**

```ts
export type HeaderSearchActions = {
  onAddContactToBridge: (email: string) => void;
  onToggleGroup: (groupId: string) => void;
  onNavigateToTab: (tab: string) => void;
  onOpenKnowledgeDestination: (destination: KnowledgeContentDestination) => void;
  onOpenAddContact: (email?: string) => void;
  onOpenKnowledgeDocument: (request: KnowledgeOpenRequest) => void;
  onOpenKnowledgeRecord: (target: KnowledgeRecordTarget) => void;
};

function primaryVerb(result: SearchResult): string {
  if (result.source === 'wiki-passage' || result.type === 'knowledge') return 'Open document';
  if (result.type === 'contact') return 'Open contact';
  if (result.type === 'server') return 'Open server';
  if (result.type === 'group') return 'Add group to bridge';
  return result.title;
}
```

Change contact and server cases in `handleSelect` to call `onOpenKnowledgeRecord` with the Task 1 keys, blur the search input, and return before `clearSearch()`. Keep group, Wiki, navigation command, and explicit `add-manual` clearing behavior unchanged.

- [ ] **Step 4: Render the primary hitbox and contact secondary action as sibling buttons**

Add `onSecondarySelect?: (result: SearchResult) => void` to `SearchResultItemProps`. In `HeaderSearch`, implement it by reading the contact email, calling `onAddContactToBridge`, then calling `clearSearch()` and blurring `searchInputRef`; pass it to immediate result rows only. Wiki passage rows omit the optional prop and therefore have no secondary action.

```tsx
<div className="search-dropdown-result-row">
  <button
    type="button"
    data-index={index}
    id={`search-result-${index}`}
    className="search-dropdown-hitbox"
    onMouseDown={(event) => {
      event.preventDefault();
      onSelect(result);
    }}
    onMouseEnter={() => onHover(index)}
  >
    <div className="search-dropdown-result-icon">
      <RenderIcon result={result} />
    </div>
    <div className="search-dropdown-result-info">
      <div className="search-dropdown-result-title">{result.title}</div>
      {passage ? (
        <>
          <div className="search-dropdown-result-meta">
            <span>Page {passage.pageIndex + 1}</span>
            <span>{passage.category}</span>
            {passage.heading && <span>{passage.heading}</span>}
            {passage.matchKind === 'fuzzy' && (
              <span className="search-dropdown-close-match">Close match</span>
            )}
          </div>
          <div className="search-dropdown-result-subtitle">{passage.excerpt}</div>
        </>
      ) : (
        result.subtitle && (
          <div className="search-dropdown-result-subtitle">{result.subtitle}</div>
        )
      )}
    </div>
    <span className="search-dropdown-result-verb">{primaryVerb(result)}</span>
  </button>
  {result.type === 'contact' && onSecondarySelect && (
    <button
      type="button"
      className="search-dropdown-secondary-action"
      aria-label={`Add ${result.title} to bridge`}
      onMouseDown={(event) => {
        event.preventDefault();
        onSecondarySelect(result);
      }}
    >
      Add to bridge
    </button>
  )}
</div>
```

Keep the two actions as sibling buttons; never nest the bridge mutation inside the primary record-open button. Enter continues to invoke only `handleSelect`, so keyboard activation remains the context-preserving primary verb.

- [ ] **Step 5: Style the verb and inline action without increasing the dropdown footprint**

```css
.search-dropdown-result-row {
  display: flex;
  align-items: stretch;
}

.search-dropdown-result-row .search-dropdown-hitbox {
  min-width: 0;
  flex: 1;
}

.search-dropdown-result-verb,
.search-dropdown-secondary-action {
  white-space: nowrap;
  font-size: var(--text-2xs);
  font-weight: 800;
}
```

Use the existing accent, border, hover, and focus tokens for the secondary action and selected row.

- [ ] **Step 6: Run HeaderSearch tests to verify the behavior passes**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit explicit search actions**

```bash
git add src/renderer/src/components/HeaderSearch.tsx src/renderer/src/components/__tests__/HeaderSearch.test.tsx src/renderer/src/styles/modals.css
git commit -m "feat: make search result actions explicit"
```

### Task 3: App-owned one-shot routing into Knowledge

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx`

**Interfaces:**
- Consumes: `KnowledgeRecordTarget` from Task 1 and `HeaderSearchActions.onOpenKnowledgeRecord` from Task 2.
- Produces: `KnowledgeWorkspaceProps.recordOpenRequest?: KnowledgeRecordOpenRequest | null` and `onRecordUnavailable(request): void`.

- [ ] **Step 1: Add failing App tests for non-mutating exact routing and missing-record feedback**

```tsx
it('routes a contact search result to an exact one-shot Knowledge request without changing Compose', () => {
  renderApp();
  fireEvent.click(screen.getByText('open-contact-record'));

  expect(lastKnowledgeWorkspaceProps?.recordOpenRequest).toMatchObject({
    destination: 'contacts',
    recordKey: 'id:contact_1',
  });
  expect(mockHandleAddManual).not.toHaveBeenCalled();
});

it('keeps the request identity stable across unrelated App rerenders', () => {
  const { rerender } = renderApp();
  fireEvent.click(screen.getByText('open-server-record'));
  const request = lastKnowledgeWorkspaceProps?.recordOpenRequest;
  rerender(<MainApp />);
  expect(lastKnowledgeWorkspaceProps?.recordOpenRequest).toBe(request);
});

it('reports a missing exact record without changing Compose', () => {
  renderApp();
  fireEvent.click(screen.getByText('open-contact-record'));
  const request = lastKnowledgeWorkspaceProps?.recordOpenRequest;
  expect(request).not.toBeNull();
  if (!request) throw new Error('Expected a Knowledge record-open request');
  act(() => lastKnowledgeWorkspaceProps?.onRecordUnavailable?.(request));
  expect(mockShowToast).toHaveBeenCalledWith('That contact is no longer available.', 'info');
  expect(mockHandleAddManual).not.toHaveBeenCalled();
});
```

Extend the existing `HeaderSearch` mock with `open-contact-record` and `open-server-record` buttons that call the new action, and extend the captured `lastKnowledgeWorkspaceProps` type with the request and unavailable callback.

- [ ] **Step 2: Run the App and workspace tests to verify they fail**

Run: `npm run test:renderer -- src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx`

Expected: FAIL because neither component accepts a record-open request.

- [ ] **Step 3: Stamp and route requests in App**

```tsx
const nextKnowledgeRecordRequestId = useRef(0);
const [knowledgeRecordOpenRequest, setKnowledgeRecordOpenRequest] =
  useState<KnowledgeRecordOpenRequest | null>(null);

const handleOpenKnowledgeRecord = useCallback((target: KnowledgeRecordTarget) => {
  nextKnowledgeRecordRequestId.current += 1;
  setKnowledgeRecordOpenRequest({ ...target, requestId: nextKnowledgeRecordRequestId.current });
  handleOpenKnowledgeDestination(target.destination);
}, [handleOpenKnowledgeDestination]);
```

Wire it into `HeaderSearch`, pass the request into `KnowledgeWorkspace`, and pass an unavailable callback that calls `showToast('That contact is no longer available.', 'info')` or `showToast('That server is no longer available.', 'info')` based on the request destination.

- [ ] **Step 4: Forward only the matching request from KnowledgeWorkspace**

```tsx
export type KnowledgeWorkspaceProps = Readonly<{
  active: boolean;
  contacts: Contact[];
  groups: BridgeGroup[];
  servers: Server[];
  relayMode?: PublicRelayConfig['mode'];
  onAddToAssembler: (contact: Contact) => void;
  onDestinationChange?: (destination: KnowledgeDestination) => void;
  recordOpenRequest?: KnowledgeRecordOpenRequest | null;
  onRecordUnavailable?: (request: KnowledgeRecordOpenRequest) => void;
}>;

<ContactsSurface
  contacts={contacts}
  groups={groups}
  servers={servers}
  onAddToAssembler={onAddToAssembler}
  selectionRequest={recordOpenRequest?.destination === 'contacts' ? recordOpenRequest : null}
  onSelectionUnavailable={onRecordUnavailable}
/>

<ServersSurface
  servers={servers}
  contacts={contacts}
  selectionRequest={recordOpenRequest?.destination === 'servers' ? recordOpenRequest : null}
  onSelectionUnavailable={onRecordUnavailable}
/>
```

The workspace continues using its existing destination event mechanism; the record request is renderer state, not a global event or persisted value.

- [ ] **Step 5: Run App and KnowledgeWorkspace tests to verify routing passes**

Run: `npm run test:renderer -- src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit one-shot App routing**

```bash
git add src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx
git commit -m "feat: route search to exact Knowledge records"
```

### Task 4: Consume and focus record requests in virtual directories

**Files:**
- Modify: `src/renderer/src/tabs/DirectoryTab.tsx`
- Modify: `src/renderer/src/tabs/ServersTab.tsx`
- Modify: `src/renderer/src/components/directory/VirtualRow.tsx`
- Modify: `src/renderer/src/components/ContactCard.tsx`
- Modify: `src/renderer/src/components/ServerCard.tsx`
- Modify: `src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx`
- Modify: `src/renderer/src/tabs/__tests__/ServersTab.test.tsx`
- Modify: `src/renderer/src/components/__tests__/ContactCard.test.tsx`
- Modify: `src/renderer/src/components/__tests__/ServerCard.test.tsx`

**Interfaces:**
- Consumes: `selectionRequest` and `onSelectionUnavailable` from Task 3; stable-key helpers from Task 1.
- Produces: one consumption per `requestId`, selected detail, virtual-list scroll, and DOM focus on the exact row.

- [ ] **Step 1: Add failing tests for reveal, select, focus, and one-shot consumption**

```tsx
it('clears local filters, reveals, selects, scrolls to, and focuses a requested contact once', async () => {
  const first = makeContact({ name: 'First Contact', email: 'first@example.com', raw: { id: 'contact_1' } });
  const second = makeContact({ name: 'Second Contact', email: 'second@example.com', raw: { id: 'contact_2' } });
  const clearAll = vi.fn();
  function useStatefulDirectoryMock() {
    const [focusedIndex, setFocusedIndex] = React.useState(0);
    return {
      ...makeDefaultDirectoryReturn(),
      filtered: [first, second],
      focusedIndex,
      setFocusedIndex,
    };
  }
  mockUseDirectory.mockImplementation(useStatefulDirectoryMock);
  mockUseListFilters.mockReturnValue(
    makeDefaultListFiltersReturn({ filteredItems: [first, second], clearAll }),
  );
  const request = { requestId: 7, destination: 'contacts' as const, recordKey: 'id:contact_2' };
  const { rerender } = render(
    <DirectoryTab
      contacts={[first, second]}
      groups={[]}
      onAddToAssembler={vi.fn()}
      selectionRequest={request}
    />,
  );

  await waitFor(() => expect(mockScrollToRow).toHaveBeenCalledWith({ index: 1, align: 'smart' }));
  expect(screen.getByRole('button', { name: /second contact/i })).toHaveFocus();
  expect(screen.getByTestId('contact-detail')).toHaveTextContent('Second Contact');
  expect(clearAll).toHaveBeenCalledOnce();

  mockScrollToRow.mockClear();
  rerender(
    <DirectoryTab
      contacts={[first, second]}
      groups={[]}
      onAddToAssembler={vi.fn()}
      selectionRequest={request}
    />,
  );
  expect(mockScrollToRow).not.toHaveBeenCalled();
});

it('reports a deleted requested server without selecting another record', async () => {
  const onSelectionUnavailable = vi.fn();
  render(
    <ServersTab
      servers={[makeServer({ name: 'Different Server', raw: { id: 'server_1' } })]}
      contacts={[]}
      selectionRequest={{ requestId: 8, destination: 'servers', recordKey: 'id:deleted' }}
      onSelectionUnavailable={onSelectionUnavailable}
    />,
  );
  await waitFor(() => expect(onSelectionUnavailable).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId('server-detail')).not.toBeInTheDocument();
  expect(screen.getByText('Select a server')).toBeVisible();
});
```

Replace the directory test's `react-window` stub with its existing row-rendering form and return a stable imperative ref:

```tsx
const { mockScrollToRow } = vi.hoisted(() => ({ mockScrollToRow: vi.fn() }));

vi.mock('react-window', () => ({
  List: ({
    rowCount,
    rowHeight,
    rowComponent: RowComponent,
    rowProps,
  }: {
    rowCount: number;
    rowHeight: number;
    rowComponent: React.ComponentType<Record<string, unknown>>;
    rowProps: Record<string, unknown>;
  }) => (
    <div data-testid="virtual-list" data-row-count={rowCount} data-row-height={rowHeight}>
      {Array.from({ length: rowCount }, (_unused, index) => (
        <RowComponent key={index} index={index} style={{}} {...rowProps} />
      ))}
    </div>
  ),
  useListRef: () => ({ current: { scrollToRow: mockScrollToRow } }),
}));
```

Replace the directory `VirtualRow` mock with:

```tsx
vi.mock('../../components/directory/VirtualRow', () => ({
  VirtualRow: ({
    index,
    filtered,
    focusedIndex,
    onRowClick,
  }: {
    index: number;
    filtered: Contact[];
    focusedIndex: number;
    onRowClick: (index: number) => void;
  }) => {
    const contact = filtered[index];
    if (!contact) return null;
    return (
      <button
        type="button"
        aria-label={contact.name}
        data-record-key={contact.raw.id ? `id:${contact.raw.id}` : `email:${contact.email}`}
        data-selected={index === focusedIndex}
        onClick={() => onRowClick(index)}
      >
        {contact.name}
      </button>
    );
  },
}));
```

In `ServersTab.test.tsx`, keep its row-rendering `List` mock, add the same `mockScrollToRow` imperative ref, and replace the `ServerCard` mock with:

```tsx
vi.mock('../../components/ServerCard', () => ({
  ServerCard: ({
    server,
    recordKey,
    selected,
    onRowClick,
  }: {
    server: Server;
    recordKey: string;
    selected: boolean;
    onRowClick: () => void;
  }) => (
    <button
      type="button"
      aria-label={server.name}
      data-record-key={recordKey}
      data-selected={selected}
      onClick={onRowClick}
    >
      {server.name}
    </button>
  ),
}));
```

Reset `mockScrollToRow` in each `beforeEach`. The focused-row assertion then exercises the tab's request effect, while the focused `ContactCard` and `ServerCard` tests below verify that production rows expose the same key.

- [ ] **Step 2: Run directory tests to verify the new cases fail**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/ServersTab.test.tsx`

Expected: FAIL because the selection props and record-row attributes do not exist.

- [ ] **Step 3: Put stable record keys on interactive virtual rows**

Add `recordKey?: string` to `ContactCard` and `ServerCard`, render it as `data-record-key`, and pass `contactRecordKey(contact)` / `serverRecordKey(server)` from each virtual row.

```tsx
<button type="button" data-record-key={recordKey} className="contact-entry" />
<button type="button" data-record-key={recordKey} className="server-card server-card--interactive" />
```

- [ ] **Step 4: Add one-shot selection effects to DirectoryTab and ServersTab**

Use `lastConsumedRequestIdRef` plus a pending request state. On a new request:

1. Mark the request ID consumed.
2. Find the record in the unfiltered source array by stable key.
3. If missing, clear explicit selection and call `onSelectionUnavailable(request)` once. Because both tabs currently treat `null` as "select the first displayed record," use an explicit no-match sentinel (`selectedEmail = ''` plus `focusedIndex = -1`, or `selectedServerName = ''`) so a deleted request cannot silently select the first row.
4. If present, clear the local search query and `filters.clearAll()`.
5. After the displayed array contains the target, set its selected key/index, call `scrollToRow({ index, align: 'smart' })`, then use `requestAnimationFrame` to find the matching `[data-record-key]` element by `dataset.recordKey` and call `focus()`.

```ts
function focusRenderedRecord(container: HTMLElement | null, recordKey: string): void {
  const row = [...(container?.querySelectorAll<HTMLElement>('[data-record-key]') ?? [])].find(
    (node) => node.dataset.recordKey === recordKey,
  );
  row?.focus();
}
```

Do not call `onAddToAssembler`, `handleAddWrapper`, edit, delete, or context-menu handlers from this effect.

- [ ] **Step 5: Run card and directory tests to verify exact selection passes**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/ContactCard.test.tsx src/renderer/src/components/__tests__/ServerCard.test.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/ServersTab.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the complete search-navigation regression slice**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/ServersTab.test.tsx`

Expected: PASS with no Compose mutation from primary contact activation.

- [ ] **Step 7: Commit exact directory selection**

```bash
git add src/renderer/src/tabs/DirectoryTab.tsx src/renderer/src/tabs/ServersTab.tsx src/renderer/src/components/directory/VirtualRow.tsx src/renderer/src/components/ContactCard.tsx src/renderer/src/components/ServerCard.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/ServersTab.test.tsx src/renderer/src/components/__tests__/ContactCard.test.tsx src/renderer/src/components/__tests__/ServerCard.test.tsx
git commit -m "feat: focus exact Knowledge search records"
```

### Task 5: Document exact Knowledge lookup behavior

**Files:**
- Modify: `docs/DESIGN.md`

**Interfaces:**
- Consumes: completed search and Knowledge record-navigation behavior.
- Produces: canonical design guidance for context-preserving exact lookup.

- [ ] **Step 1: Add the exact-lookup rule to Knowledge retained destinations**

Add this paragraph after the current retained-destinations paragraph:

```md
Header search labels the action each result will perform. Contact and server primary actions open
and focus the exact record in the retained Knowledge destination while preserving the lookup query;
adding a contact to Compose is a separate explicit action. An exact lookup may clear that
destination's local filters to reveal the requested record, but it never changes bridge recipients.
```

- [ ] **Step 2: Check the edited canonical document**

Run: `npx prettier --check docs/DESIGN.md && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Commit the Knowledge design update**

```bash
git add docs/DESIGN.md
git commit -m "docs: describe exact Knowledge lookup"
```

### Task 6: Search-navigation readiness gate

**Files:**
- Modify only files required by failures attributable to Tasks 1-4.

**Interfaces:**
- Consumes: the completed search-navigation slice.
- Produces: verified search/Knowledge behavior ready to combine with the other Relay tab plans.

- [ ] **Step 1: Run targeted renderer coverage**

Run: `npm run test:renderer -- src/renderer/src/components/__tests__/HeaderSearch.test.tsx src/renderer/src/__tests__/App.test.tsx src/renderer/src/features/knowledge/__tests__/knowledgeRecordNavigation.test.ts src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx src/renderer/src/tabs/__tests__/DirectoryTab.test.tsx src/renderer/src/tabs/__tests__/ServersTab.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run static gates for the slice**

Run: `npm run typecheck && npm run lint && npm run format:check && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Inspect whether verification changed files**

Run: `git status --short`

Expected: no new changes. If an attributable repair was required, return to that task's explicit file list, rerun its focused test, and commit those named files with `fix: harden exact search navigation`. Do not create an empty commit.
