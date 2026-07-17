# Unified Knowledge Workspace and Notes Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone Notes feature and consolidate Wiki, Contacts, and Servers into one Relay-styled Knowledge workspace whose launcher order is Wiki, Contacts, Servers.

**Architecture:** `App` retains one top-level Knowledge tab. A new `KnowledgeWorkspace` owns the internal `home | wiki | contacts | servers` destination, lazily retains each opened destination, and hosts the existing production Wiki, Contacts, and Servers components. A small navigation event bridge maps command-palette and compatibility requests into that internal state. Standalone Notes code and contracts are removed without deleting existing database rows; contextual contact/server and Dynatrace notes remain.

**Tech Stack:** React 19, TypeScript 6, Electron renderer, existing Relay tab retention, Testing Library, Vitest, Playwright, existing Contacts/Servers/Knowledge services and CSS tokens.

## Global Constraints

- The only top-level sidebar destination for Wiki, Contacts, and Servers is named Knowledge.
- Remove top-level People, Servers, and Notes entries.
- Knowledge home order and keyboard order are exactly Wiki, Contacts, Servers.
- The inner document destination is named Wiki; the outer tab remains Knowledge.
- Reuse the current Contacts and Servers production behavior, including contextual notes.
- Preserve Add to Composer, CRUD, filters, virtualization, detail panels, and relationships.
- First Knowledge entry in an app session opens the launcher; leaving and returning preserves the active internal destination and its local state.
- Remove standalone Notes UI, routes, services, synchronization, import/export, and Data Manager exposure.
- Do not delete existing `standalone_notes` rows automatically.
- Keep the contextual `notes` collection and Dynatrace response notes.
- Match Relay's black canvas, red accent, sharp borders, IBM Plex typography, dense chrome, focus states, and reduced-motion behavior.
- Use TDD for every production behavior and commit each independently testable task.

---

## File Structure

### Create

- `src/renderer/src/features/knowledge/knowledgeWorkspaceNavigation.ts` — internal destination type, event bridge, and legacy-route mapping.
- `src/renderer/src/features/knowledge/__tests__/knowledgeWorkspaceNavigation.test.ts` — event and compatibility behavior.
- `src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx` — home/destination state and retained mounting.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx` — launcher, navigation, retention, and destination tests.
- `src/renderer/src/features/knowledge/KnowledgeHome.tsx` — approved three-destination launcher.
- `src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx` — accessible/visual order, counts, and activation.
- `src/renderer/src/features/knowledge/knowledgeWorkspace.css` — launcher and inner navigation styles.

### Delete

- `src/renderer/src/tabs/NotesTab.tsx`
- `src/renderer/src/tabs/__tests__/NotesTab.test.tsx`
- `src/renderer/src/tabs/notes/NoteCard.tsx`
- `src/renderer/src/tabs/notes/NoteContentRenderer.tsx`
- `src/renderer/src/tabs/notes/NoteEditor.tsx`
- `src/renderer/src/tabs/notes/NoteToolbar.tsx`
- `src/renderer/src/tabs/notes/index.ts`
- `src/renderer/src/tabs/notes/noteContentParser.ts`
- `src/renderer/src/tabs/notes/notes.css`
- `src/renderer/src/tabs/notes/types.ts`
- `src/renderer/src/hooks/useNotepad.ts`
- `src/renderer/src/hooks/__tests__/useNotepad.test.ts`
- `src/renderer/src/hooks/useNoteStorage.ts`
- `src/renderer/src/services/standaloneNoteService.ts`

### Modify

- `src/shared/ipc.ts`, `src/shared/ipcValidation.ts`, and tests — remove Notes/People/Servers top-level tab values and standalone-note contracts.
- `src/main/pocketbase/CollectionBootstrap.ts` and tests — stop provisioning `standalone_notes` without deleting existing collections.
- `src/main/handlers/cacheHandlers.ts`, `offlineMutationHandlers.ts`, and tests — remove standalone-note cache/mutation support.
- `src/renderer/src/services/importExportService.ts`, `useDataManager.ts`, Data Manager components, and tests — remove standalone-note exposure.
- `src/renderer/src/App.tsx` and tests — mount only `KnowledgeWorkspace` for the three destinations and remove Notes/People/Servers panels.
- `src/renderer/src/components/Sidebar.tsx` and tests — approved top-level order.
- `src/renderer/src/hooks/useKeyboardShortcuts.ts` and tests — compact shortcut map matching visible navigation.
- `src/renderer/src/hooks/useCommandSearch.ts` and tests — Contacts/Servers actions target Knowledge destinations.
- `src/renderer/src/components/HeaderSearch.tsx` and tests — internal destination actions and Knowledge filtering.
- `src/renderer/src/components/ShortcutsModal.tsx` and tests — new shortcut labels.
- `src/renderer/src/features/knowledge/KnowledgeTab.tsx` and tests — operate as the Wiki destination and use Wiki-facing copy.
- `src/renderer/src/tabs/DirectoryTab.tsx` and tests — host-safe Contacts destination contract.
- `src/renderer/src/tabs/ServersTab.tsx` and tests — host-safe Servers destination contract.
- `src/renderer/src/styles.css`, `styles/responsive.css`, and relevant component CSS — remove Notes import and support workspace layout.
- `tests/e2e/critical-path.spec.ts` — launcher and all three destination flows.
- `docs/architecture.md` and `docs/DESIGN.md` — final navigation/data boundaries.

---

### Task 1: Define Knowledge Destination Navigation

**Files:**

- Create: `src/renderer/src/features/knowledge/knowledgeWorkspaceNavigation.ts`
- Create: `src/renderer/src/features/knowledge/__tests__/knowledgeWorkspaceNavigation.test.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`

**Interfaces:**

```ts
export type KnowledgeDestination = 'home' | 'wiki' | 'contacts' | 'servers';

export const OPEN_KNOWLEDGE_DESTINATION_EVENT = 'relay:open-knowledge-destination';

export function requestKnowledgeDestinationOpen(
  destination: Exclude<KnowledgeDestination, 'home'>,
): void;

export function normalizeLegacyTabRequest(value: string): {
  tab: TabName;
  knowledgeDestination?: Exclude<KnowledgeDestination, 'home'>;
};
```

- [ ] **Step 1: Write failing destination and compatibility tests**

```ts
it.each([
  ['People', { tab: 'Knowledge', knowledgeDestination: 'contacts' }],
  ['Servers', { tab: 'Knowledge', knowledgeDestination: 'servers' }],
  ['Notes', { tab: 'Compose' }],
])('maps legacy tab %s safely', (legacy, expected) => {
  expect(normalizeLegacyTabRequest(legacy)).toEqual(expected);
});
```

Add an event test proving only `wiki | contacts | servers` can be requested and a stale value cannot dispatch.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/renderer/src/features/knowledge/__tests__/knowledgeWorkspaceNavigation.test.ts \
  src/shared/ipcValidation.test.ts
```

Expected: destination module is missing and `TabName` still contains People, Servers, and Notes.

- [ ] **Step 3: Implement the destination bridge**

Use a typed `CustomEvent` patterned after `knowledgeNavigation.ts`. Keep `requestKnowledgeDocumentOpen()` for document/heading selection; a document request also implies the `wiki` destination when handled by `App`.

```ts
export function requestKnowledgeDestinationOpen(destination: KnowledgeContentDestination): void {
  globalThis.dispatchEvent(
    new CustomEvent<KnowledgeContentDestination>(OPEN_KNOWLEDGE_DESTINATION_EVENT, {
      detail: destination,
    }),
  );
}
```

Reduce `TabName` to actual main tabs. Keep legacy mapping in this module for one compatibility release rather than retaining invalid names in the union.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: event and fallback mappings pass; shared validation rejects removed top-level tab names.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/knowledge/knowledgeWorkspaceNavigation.ts src/renderer/src/features/knowledge/__tests__/knowledgeWorkspaceNavigation.test.ts src/shared/ipc.ts src/shared/ipcValidation.ts src/shared/ipcValidation.test.ts
git commit -m "refactor(navigation): define Knowledge workspace destinations"
```

---

### Task 2: Build the Approved Knowledge Home

**Files:**

- Create: `src/renderer/src/features/knowledge/KnowledgeHome.tsx`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx`
- Create: `src/renderer/src/features/knowledge/knowledgeWorkspace.css`

**Interfaces:**

```ts
type KnowledgeHomeProps = {
  wikiCount: number | null;
  contactCount: number | null;
  serverCount: number | null;
  onOpen: (destination: 'wiki' | 'contacts' | 'servers') => void;
};
```

- [ ] **Step 1: Write failing launcher tests**

```tsx
it('renders Wiki, Contacts, Servers in DOM and focus order', async () => {
  render(<KnowledgeHome wikiCount={24} contactCount={6} serverCount={3} onOpen={onOpen} />);
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    expect.stringContaining('Wiki'),
    expect.stringContaining('Contacts'),
    expect.stringContaining('Servers'),
  ]);
  await user.click(screen.getByRole('button', { name: /Wiki/ }));
  expect(onOpen).toHaveBeenCalledWith('wiki');
});
```

Add tests for singular/plural/unknown counts, unique accessible names, visible focus class contract, and no generic `Knowledge Base` label inside the document card.

- [ ] **Step 2: Run launcher tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs KnowledgeHome.test.tsx
```

Expected: component and styles do not exist.

- [ ] **Step 3: Implement the semantic launcher**

Use one heading and three real buttons in DOM order. Reuse the existing Knowledge, People/Contacts, and Server icon vocabulary. Use the approved copy and live count labels. Do not use CSS `order` to fake the sequence.

```tsx
const destinations = [
  { id: 'wiki', title: 'Wiki', count: wikiCount, noun: 'document' },
  { id: 'contacts', title: 'Contacts', count: contactCount, noun: 'contact' },
  { id: 'servers', title: 'Servers', count: serverCount, noun: 'server' },
] as const;
```

- [ ] **Step 4: Implement Relay-native responsive styling**

Use a three-column grid at normal desktop width, two columns only when needed, and one column at the narrowest supported layout. Preserve sharp borders and one red active/focus treatment. Do not add rounded SaaS cards, decorative shadows, gradients, or entrance choreography. Add reduced-motion handling for hover/selection transitions.

- [ ] **Step 5: Run launcher tests and style checks**

```bash
node scripts/run-renderer-tests.mjs KnowledgeHome.test.tsx
npx eslint src/renderer/src/features/knowledge/KnowledgeHome.tsx
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/knowledge/KnowledgeHome.tsx src/renderer/src/features/knowledge/__tests__/KnowledgeHome.test.tsx src/renderer/src/features/knowledge/knowledgeWorkspace.css
git commit -m "feat(knowledge): add Wiki-first workspace launcher"
```

---

### Task 3: Host Wiki, Contacts, and Servers in One Retained Workspace

**Files:**

- Create: `src/renderer/src/features/knowledge/KnowledgeWorkspace.tsx`
- Create: `src/renderer/src/features/knowledge/__tests__/KnowledgeWorkspace.test.tsx`
- Modify: `src/renderer/src/features/knowledge/KnowledgeTab.tsx`
- Modify: `src/renderer/src/features/knowledge/__tests__/KnowledgeTab.test.tsx`
- Modify: `src/renderer/src/tabs/DirectoryTab.tsx`
- Modify: `src/renderer/src/tabs/ServersTab.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`
- Modify: `src/renderer/src/features/knowledge/knowledgeWorkspace.css`

**Interfaces:**

```ts
type KnowledgeWorkspaceProps = {
  active: boolean;
  contacts: Contact[];
  groups: BridgeGroup[];
  servers: Server[];
  relayMode?: PublicRelayConfig['mode'];
  onAddToAssembler: (contact: Contact) => void;
};
```

- [ ] **Step 1: Write failing workspace tests**

Test initial home, card activation, inner destination buttons, `Knowledge home`, retained destination state, external destination events, document-open requests forcing Wiki, and props passed to Contacts/Servers.

```tsx
it('retains Contacts selection after visiting Wiki', async () => {
  renderWorkspace();
  await user.click(screen.getByRole('button', { name: /Contacts/ }));
  await user.click(screen.getByText('Ada Lovelace'));
  await user.click(screen.getByRole('button', { name: 'Wiki' }));
  await user.click(screen.getByRole('button', { name: 'Contacts' }));
  expect(screen.getByText('Ada Lovelace')).toHaveAttribute('aria-selected', 'true');
});
```

- [ ] **Step 2: Run workspace tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs KnowledgeWorkspace.test.tsx KnowledgeTab.test.tsx App.test.tsx
```

Expected: `KnowledgeWorkspace` is missing and App still mounts three top-level panels.

- [ ] **Step 3: Implement retained internal destination mounting**

Use a `Set<KnowledgeDestination>` patterned after App's retained tabs. Mount a destination on first open and use React `Activity` or the existing retained-panel pattern to hide it without destroying state.

```tsx
const [destination, setDestination] = useState<KnowledgeDestination>('home');
const [mounted, setMounted] = useState(() => new Set<KnowledgeDestination>(['home']));

const open = useCallback((next: KnowledgeDestination) => {
  setMounted((current) => new Set(current).add(next));
  setDestination(next);
}, []);
```

Render one inner navigation row for non-home destinations with `Knowledge home`, Wiki, Contacts, Servers. Use `aria-current="page"` on the active destination.

- [ ] **Step 4: Convert App to one Knowledge panel**

Remove lazy `DirectoryTab`, `ServersTab`, and `NotesTab` main panels. Lazy-load `KnowledgeWorkspace` and pass current data plus `handleAddToAssembler`. Keep top-level active tab `Knowledge` while internal events select a destination.

- [ ] **Step 5: Make Wiki-facing copy consistent**

Inside `KnowledgeTab`, change user-facing `Knowledge Base`/`Focus reader` destination labels to Wiki where they identify the document library. Preserve protected management terminology where `Knowledge management` describes the broader server subsystem. Ensure the outer App breadcrumb remains `Relay / Knowledge`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command plus Contacts/Servers tests. Expected: all three destinations work under one tab and retain state.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/knowledge src/renderer/src/tabs/DirectoryTab.tsx src/renderer/src/tabs/ServersTab.tsx src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx
git commit -m "feat(knowledge): unify Wiki contacts and servers"
```

---

### Task 4: Update Sidebar, Search, and Keyboard Routing

**Files:**

- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/hooks/useKeyboardShortcuts.ts`
- Create: `src/renderer/src/hooks/__tests__/useKeyboardShortcuts.test.ts`
- Modify: `src/renderer/src/hooks/useCommandSearch.ts`
- Modify: `src/renderer/src/hooks/__tests__/useCommandSearch.test.ts`
- Modify: `src/renderer/src/components/HeaderSearch.tsx`
- Modify: `src/renderer/src/components/__tests__/HeaderSearch.test.tsx`
- Modify: `src/renderer/src/components/ShortcutsModal.tsx`
- Modify: `src/renderer/src/components/__tests__/ShortcutsModal.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/__tests__/App.test.tsx`

**Interfaces:**

- Consumes `requestKnowledgeDestinationOpen()` from Task 1.
- Header search action adds `onOpenKnowledgeDestination(destination)`.

- [ ] **Step 1: Write failing navigation tests**

Assert the sidebar order is Compose, Alerts, On-Call, Knowledge, Status, Problems. Assert shortcuts `1`–`6` follow that order. Assert `Go to Contacts` and server results activate Knowledge plus the internal destination. Assert Knowledge document results open Wiki.

```ts
expect(useCommandSearch('', contacts, servers, groups).find(({ id }) => id === 'action-contacts')).toMatchObject({
  title: 'Go to Contacts',
  data: { action: 'open-knowledge', destination: 'contacts' },
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node scripts/run-renderer-tests.mjs \
  Sidebar.test.tsx \
  useKeyboardShortcuts.test.ts \
  useCommandSearch.test.ts \
  HeaderSearch.test.tsx \
  ShortcutsModal.test.tsx \
  App.test.tsx
```

Expected: People/Servers/Notes routes and old shortcut numbers still exist.

- [ ] **Step 3: Implement visible navigation order**

Remove People, Servers, and Notes icons/items only from main navigation. Keep People/Server icons used by launcher/search. Update shortcut help and handler to the six actual main destinations.

- [ ] **Step 4: Route search/actions into Knowledge**

Add `open-knowledge` action data. Server results call `onOpenKnowledgeDestination('servers')`. The Contacts navigation action calls `contacts`. Knowledge documents call `requestKnowledgeDocumentOpen()` then request/open `wiki`. Preserve existing contact-result Add to Composer behavior unless the result is the explicit Contacts navigation action.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all visible and keyboard navigation matches the approved information architecture.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components src/renderer/src/hooks src/renderer/src/App.tsx src/renderer/src/__tests__/App.test.tsx
git commit -m "refactor(navigation): route directories through Knowledge"
```

---

### Task 5: Remove the Standalone Notes Feature Without Deleting Data

**Files:**

- Delete all files listed under **Delete**.
- Modify: `src/renderer/src/styles.css`
- Modify: `src/shared/ipc.ts`
- Modify: `src/shared/ipcValidation.ts`
- Modify: `src/shared/ipcValidation.test.ts`
- Modify: `src/main/pocketbase/CollectionBootstrap.ts`
- Modify: `src/main/pocketbase/__tests__/CollectionBootstrap.test.ts`
- Modify: `src/main/handlers/cacheHandlers.ts`
- Modify: `src/main/handlers/cacheHandlers.test.ts`
- Modify: `src/main/handlers/offlineMutationHandlers.ts`
- Modify: `src/main/handlers/offlineMutationHandlers.test.ts`
- Modify: `src/renderer/src/services/importExportService.ts`
- Modify: `src/renderer/src/services/importExportService.test.ts`
- Modify: `src/renderer/src/hooks/useDataManager.ts`
- Modify: `src/renderer/src/hooks/__tests__/useDataManager.test.ts`
- Modify: `src/renderer/src/hooks/useDataManager.test.ts`
- Modify: `src/renderer/src/components/data-manager/SharedComponents.tsx`
- Modify: `src/renderer/src/components/__tests__/DataManagerModal.test.tsx`
- Modify: `src/renderer/src/components/data-manager/__tests__/DataManagerSubcomponents.test.tsx`

**Interfaces:**

- Removes the `StandaloneNote`, `NoteColor`, and `standalone_notes` application contracts.
- Preserves `NotesProvider`, `useNotes`, `NotesModal`, and the contextual `notes` collection.

- [ ] **Step 1: Write failing absence and data-preservation tests**

Add tests that managed collection definitions no longer include `standalone_notes`, bootstrap does not call delete for an existing unmanaged `standalone_notes` collection, cache/offline/import/export allowlists reject it, and Data Manager has no Standalone Notes option.

```ts
it('leaves an existing standalone_notes collection untouched but unmanaged', async () => {
  const pb = pocketBaseWithExistingCollection('standalone_notes');
  await ensureCollections(pb);
  expect(pb.collections.delete).not.toHaveBeenCalledWith('standalone_notes');
  expect(managedCollectionNames()).not.toContain('standalone_notes');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run \
  src/main/pocketbase/__tests__/CollectionBootstrap.test.ts \
  src/main/handlers/cacheHandlers.test.ts \
  src/main/handlers/offlineMutationHandlers.test.ts \
  src/shared/ipcValidation.test.ts
node scripts/run-renderer-tests.mjs \
  DataManagerModal.test.tsx \
  DataManagerSubcomponents.test.tsx \
  useDataManager.test.ts \
  importExportService.test.ts \
  App.test.tsx
```

Expected: standalone notes remain a live managed/synchronized feature.

- [ ] **Step 3: Remove contracts and allowlists**

Remove the standalone collection from managed schemas, IPC mutation/cache unions, import/export, Data Manager, and renderer collection stores. Do not add a collection deletion migration.

- [ ] **Step 4: Delete renderer feature code and CSS**

Delete the exact standalone Notes files, remove `notes.css` import, and remove now-unused standalone types. Preserve contextual note modules and any shared icon still used by contact/server detail panels.

- [ ] **Step 5: Prove the boundary**

Run:

```bash
rg -n "NotesTab|useNotepad|useNoteStorage|standaloneNoteService|standalone_notes|tabs/notes" src
```

Expected: no live application matches. Then run:

```bash
rg -n "NotesProvider|NotesModal|useNotesContext|name: 'notes'|DYNATRACE_PROBLEM_NOTES_COLLECTION" src
```

Expected: contextual contact/server and Dynatrace note paths remain.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command plus contextual Notes tests:

```bash
node scripts/run-renderer-tests.mjs NotesContext.test.tsx NotesModal.test.tsx DirectoryTab.test.tsx ServersTab.test.tsx
```

Expected: removed feature tests/contracts are gone and contextual notes pass.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "refactor(notes): remove the standalone Notes feature"
```

---

### Task 6: Polish and Verify the Unified Workspace

**Files:**

- Modify: `src/renderer/src/features/knowledge/knowledgeWorkspace.css`
- Modify: `src/renderer/src/styles/responsive.css`
- Modify: `tests/e2e/critical-path.spec.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/DESIGN.md`

**Interfaces:**

- Produces the browser-verified approved launcher and final responsive/focus behavior.

- [ ] **Step 1: Add failing E2E expectations**

Cover sidebar absence, launcher order, Wiki/Contacts/Servers activation, home return, Contacts Add to Composer, Servers detail selection, contextual notes, retained state, and stale legacy-route fallbacks.

- [ ] **Step 2: Run the focused E2E slice and verify RED**

Run the existing Relay Electron/browser test command filtered to the Knowledge workspace cases. Expected: any missing focus/order/responsive behavior fails before polish.

- [ ] **Step 3: Apply final responsive and interaction polish**

Verify 3/2/1 launcher columns, no text overflow, destination rail overflow handling, visible focus, consistent 150–250 ms state transitions, reduced-motion behavior, and no nested scrolling around Contacts/Servers. Use the existing theme tokens and component vocabulary.

- [ ] **Step 4: Update architecture and design documentation**

Document one top-level Knowledge tab, internal destinations, retained mounting, destination events, contextual Notes boundary, and inert standalone-note archive.

- [ ] **Step 5: Run complete phase verification**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then verify visually at normal desktop width and the narrow supported viewport:

```text
Sidebar: Compose, Alerts, On-Call, Knowledge, Status, Problems
Launcher: Wiki, Contacts, Servers
Inner label: Wiki
Removed: Notes, People, Servers top-level entries
Preserved: contact/server notes and Dynatrace response notes
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/features/knowledge/knowledgeWorkspace.css src/renderer/src/styles/responsive.css tests/e2e/critical-path.spec.ts docs/architecture.md docs/DESIGN.md
git commit -m "test(knowledge): verify the unified workspace"
```

---

## Phase Completion Gate

Do not begin the Continuous PDF plan until:

- Knowledge is the only top-level Wiki/Contacts/Servers entry;
- launcher DOM, visual, and focus order is Wiki, Contacts, Servers;
- all three destinations preserve their existing production behavior;
- the standalone Notes feature is absent without deleting existing rows;
- contextual notes pass regressions;
- focused/full tests and build pass; and
- browser verification matches the approved full-size review artifact.
