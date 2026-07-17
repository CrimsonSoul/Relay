# Role Accounts and Unified Knowledge Workspace Design

**Date:** 2026-07-17
**Status:** Approved design; awaiting written-spec review

## Summary

Relay will remove passwordless operator profiles and the standalone Notes tab. Ordinary Relay use will remain passwordless. Authentication will exist only for the protected Owner, Administrator, and Publisher accounts used to administer Relay and manage the Wiki.

The existing sidebar entries for People and Servers will move into the Knowledge tab. Knowledge will open on a Relay-styled launcher with three equally weighted destinations in this order: **Wiki**, **Contacts**, and **Servers**. The inner Knowledge destination is named **Wiki**. Contacts and Servers will reuse their current production workflows rather than receiving simplified replacements.

The Wiki PDF viewer will support two reading modes: **Continuous** and **Single page**. Continuous mode is the default and scrolls through lazily rendered PDF pages inside the existing viewer. The control can switch modes without reloading the document.

The existing installation will migrate Ryan Bledsoe to Owner and Charles Gibbs to Administrator. Existing credentials, paired-device relationships, and historical name snapshots will be preserved wherever possible. Historical operator names remain visible as read-only text even though the operator roster is removed.

## Relationship to Existing Designs

This design supersedes the operator identity and navigation portions of:

- `2026-07-13-passwordless-operator-profiles-design.md`
- `2026-07-15-privileged-operators-and-knowledge-management-design.md`

The managed Wiki library, upload pipeline, protected device pairing, signed command boundary, PDF security, realtime synchronization, offline PDF cache, and server/client connection model remain in force unless this document changes them explicitly.

## Goals

- Remove the operator picker, operator roster, operator administration, and operator-dependent ordinary workflows.
- Keep Compose, Alerts, On-Call, Problems, Contacts, Servers, Wiki reading, and other ordinary Relay work passwordless.
- Represent protected identities with username, password, display name, and one effective role.
- Maintain exactly one Owner, support multiple Administrators, and permit one designated Publisher account at a time.
- Let the Owner manage Administrators and transfer ownership.
- Let the Owner and Administrators assign or replace the Publisher.
- Preserve Ryan Bledsoe as Owner and Charles Gibbs as Administrator on the existing installation.
- Remove the standalone Notes tab and all of its application entry points.
- Consolidate Wiki, Contacts, and Servers under one sidebar tab named Knowledge.
- Use the approved equal-card launcher with Wiki first.
- Add a genuine continuously scrolling PDF mode while retaining the current single-page reader.
- Preserve historical operator name snapshots without requiring the old roster to render them.

## Non-goals

- Ordinary Relay work will not require a user account or sign-in.
- Protected role accounts will not replace the existing shared Relay connection passphrase, PocketBase app account, discovery, or client-presence model.
- This work will not add email-based account identity, password recovery email, self-service registration, or Internet authentication.
- The Wiki will continue to manage and read PDFs; it will not edit PDF body content, annotations, forms, or attachments.
- Contacts and Servers will not be merged into one data collection. They remain independent destinations inside one Knowledge workspace.
- Removing the standalone Notes feature will not automatically erase previously stored standalone note records.
- Contextual contact/server notes and Dynatrace problem response notes are not the removed Notes tab and will remain available.

## Approved Information Architecture

### Sidebar

The main sidebar will contain these primary destinations:

1. Compose
2. Alerts
3. On-Call
4. Knowledge
5. Status
6. Problems

People, Servers, and Notes will no longer appear as top-level sidebar entries. The operator selector will be removed from the sidebar footer. Client presence, dashboard shortcuts, and Settings remain in the footer.

The shared `TabName` contract, keyboard shortcuts, command palette, header search actions, retained-tab mounting, and tests will be updated so removed tab names cannot be activated accidentally.

### Knowledge home

Opening Knowledge for the first time in an app session shows the launcher. It has three equal, full-width Relay destination cards ordered left to right:

1. Wiki
2. Contacts
3. Servers

Each card shows a concise purpose, a live item count when available, and one clear open action. The surface uses Relay's existing black canvas, red active accent, sharp borders, dense IBM Plex styling, and square control geometry. It must look like part of the existing application shell, not a separate dashboard.

The launcher is the Knowledge home, not an additional top-level tab. The Knowledge workspace provides an explicit `Knowledge home` action from every destination.

### Knowledge destination navigation

The workspace owns an internal destination state:

```ts
type KnowledgeDestination = 'home' | 'wiki' | 'contacts' | 'servers';
```

The destination rail is ordered Wiki, Contacts, Servers. The outer sidebar label always remains Knowledge. The first entry into Knowledge during an app session starts at `home`. After a destination is opened, switching to another main Relay tab and back preserves the current Knowledge destination and its local selection/filter state. Choosing `Knowledge home` explicitly returns to the launcher.

Existing actions that previously opened People or Servers will instead activate Knowledge and request the corresponding internal destination. Examples include command-palette results, header-search results, contact creation flows, and server-related shortcuts. Removed Notes actions and shortcuts will have no replacement.

### Contacts and Servers

The current `DirectoryTab` and `ServersTab` behavior will be hosted inside the Knowledge workspace. Their production capabilities remain intact, including:

- searching, sorting, filtering, keyboard navigation, and virtualized lists;
- contact and server detail panels;
- add, edit, delete, and contextual actions;
- contact-to-server ownership/support relationships;
- Add to Composer from Contacts;
- contextual contact and server notes; and
- existing loading, empty, error, offline, and status states.

The components may be renamed to reflect their new location, but the data services and collection contracts remain independent. Each destination is mounted on first use and retained while the Knowledge tab is mounted so changing destinations does not discard filters, selection, or an in-progress reading position.

## Protected Identity and Role Model

### Product roles

Relay exposes three protected roles:

| Effective role | Quantity | Authority |
| --- | ---: | --- |
| Owner | Exactly one | All Administrator authority, Administrator lifecycle, ownership transfer, Publisher assignment |
| Administrator | Zero or more | Publisher assignment, paired-device administration, protected Relay settings, Wiki management |
| Publisher | Zero or one assigned at a time | Wiki management only |

There is one Publisher role slot and never more than one authoritative Publisher. The slot may be temporarily unassigned during initial setup or recovery. Owner and Administrator accounts cannot simultaneously be the Publisher.

Ordinary passwordless Relay access is not a fourth account role. It is the normal application mode available without authentication.

### Capability matrix

| Capability | Ordinary | Publisher | Administrator | Owner |
| --- | ---: | ---: | ---: | ---: |
| Use ordinary Relay features | Yes | Yes | Yes | Yes |
| Read Wiki | Yes | Yes | Yes | Yes |
| Manage Wiki documents | No | Yes | Yes | Yes |
| Assign/replace Publisher | No | No | Yes | Yes |
| Manage paired privileged devices | No | No | Yes | Yes |
| Manage protected Relay settings | No | No | Yes | Yes |
| Create, deactivate, or reset Administrators | No | No | No | Yes |
| Transfer ownership | No | No | No | Yes |

The current broad `operators.manage` capability will be removed. New narrow capabilities will distinguish `accounts.manage`, `ownership.transfer`, and `publisher.assign`. Server-side authorization is authoritative; hiding controls is not treated as enforcement.

### Account identity

Protected accounts use:

```ts
type RelayRoleAccount = {
  id: string;
  username: string;
  displayName: string;
  storedRole: 'administrator' | 'publisher';
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
  legacyOperatorId?: string;
  created: string;
  updated: string;
};
```

The Owner is the active Administrator account referenced by `ownerAccountId` in the protected singleton state. This keeps ownership transfer authoritative with one state update instead of risking two simultaneous Owner records. Other active `administrator` accounts are Administrators. The `publisherAccountId` pointer identifies the single Publisher account.

Usernames are case-insensitively unique, normalized to lowercase, 3–64 characters, and limited to letters, numbers, `.`, `_`, and `-`. The username is immutable after account creation. Display names are trimmed, whitespace-normalized, required, case-preserving, and limited to 120 characters. Display names may be edited by an authorized role without changing login identity or historical snapshots.

No user enters or manages an email address. If PocketBase requires an internal auth email field, Relay creates an unreachable implementation-only value. It is never an identity field, never shown in the renderer, never used for recovery, and never included in administration projections.

Password bounds, server-local credential setup/recovery, credential versioning, idle locks, device pairing, signature verification, and token handling retain the current privileged-access security model.

### Login and session behavior

Privileged sign-in asks for username and password directly. It no longer depends on a sidebar operator selection. A protected session exposes only bounded values needed by the renderer:

```ts
type PrivilegedSessionView = {
  state: PrivilegedSessionState;
  accountId: string | null;
  username: string | null;
  displayName: string | null;
  role: 'owner' | 'admin' | 'publisher' | null;
  capabilities: PrivilegedCapability[];
  deviceId: string | null;
  expiresAt: string | null;
};
```

Changing a display name does not invalidate the session. Password reset, deactivation, ownership transfer affecting the current account, Publisher replacement, or device revocation re-evaluates or invalidates affected sessions exactly at the server boundary.

### Administration interface

The current `Operators` administration area is replaced by `Accounts & roles`.

The Owner can:

- create an Administrator account with username and display name;
- edit an Administrator display name;
- deactivate or reactivate an Administrator;
- initiate server-local password setup/reset;
- transfer ownership to an existing active Administrator; and
- perform all Publisher operations.

An Administrator cannot create, edit, deactivate, reset, or promote Owner/Administrator accounts. The Owner cannot deactivate the current Owner account. Ownership transfer requires reauthentication, uses optimistic revision checks, and changes the authoritative `ownerAccountId` before the previous Owner session is re-evaluated. The previous Owner becomes an Administrator.

The Owner and Administrators can create or replace the single Publisher account, edit its display name, deactivate it, and initiate server-local password setup/reset. Publisher replacement immediately removes the previous Publisher's protected authority and revokes its paired sessions. Remote clients may manage the assignment but may not transmit a replacement password to the server.

The administration UI displays role, username, display name, credential readiness, active state, and paired-device count. It never returns password hashes, current passwords, auth tokens, internal email values, private keys, or secret Relay settings.

## Operator Removal and Historical Attribution

### Removed live behavior

The following live operator behavior will be removed:

- `OperatorProvider` and `useOperator`;
- sidebar operator selection and local selected-operator storage;
- the Operators settings page and operator create/rename/activate IPC commands;
- operator roster subscriptions and offline-cache entries;
- `relay_operators` collection provisioning and management;
- operator-dependent login and pairing inputs; and
- prompts that block an ordinary action until an operator is selected.

Privileged code will identify actors by protected account ID and include account display-name snapshots in audit records. Ordinary passwordless actions will not invent a human identity. They will write no new operator ID or operator name. UI that previously required operator attribution will permit the action and render new unattributed history without a fake name.

### Historical display contract

Existing records that already contain `operatorName`, `author`, `addressedBy`, `createdBy`, or another human-readable snapshot continue to render that stored string. Rendering must not resolve the old operator ID against a live roster.

Before retiring the roster, the migration verifies known operator-attributed collections. If a record has a legacy operator ID but lacks its corresponding name snapshot, the migration backfills the snapshot from the existing roster. It never rewrites a non-empty historical name. If a referenced legacy ID cannot be resolved, migration keeps the roster hidden and reports a server-local migration error instead of deleting the only remaining source of that name.

After successful account migration and attribution verification, the server removes the `relay_operators` collection, purges cached roster projections, removes the selected-operator localStorage key, and records the completed identity-migration version. Legacy operator ID strings may remain on historical records as opaque compatibility data; they have no live relationship.

## Existing-Installation Migration

The migration is ordered, idempotent, and server-authoritative:

1. Read the current privileged state, privileged accounts, operator roster, paired devices, and relevant historical attribution records.
2. Preserve each existing privileged auth record ID so password hashes, credential versions, and device relationships remain attached to the same account.
3. Add `username`, `displayName`, and the new account-role fields.
4. Convert the current owner pointer from operator ID to account ID.
5. Convert the current Publisher pointer from operator ID to account ID when a Publisher exists.
6. Convert command, pairing, upload, and audit actor references to account identity for new records while retaining legacy fields for old records.
7. Verify or backfill historical name snapshots.
8. Switch password authentication identity from `operatorId` to `username`.
9. Remove live operator APIs, subscriptions, caches, and selection state.
10. Retire the operator collection only after every required check succeeds.
11. Commit the migration marker so restart cannot repeat account conversion or roster deletion.

For the existing Relay installation:

- Ryan Bledsoe's existing privileged account becomes username `ryan` and the authoritative Owner.
- Charles Gibbs's existing privileged account becomes username `charles` and remains an Administrator.
- Existing active/configured credential state is preserved; migration does not silently replace passwords.
- Existing paired devices remain associated with their account IDs.
- An existing Publisher keeps its display name and account ID and receives a deterministic unique username derived from the existing display name.

If the current database contradicts the verified Ryan/Charles assignment, migration stops before authority changes and reports the mismatch on the server PC. It does not guess between duplicate names or silently create a second Owner.

Fresh installations create pending local credentials for `ryan` as Owner and `charles` as Administrator. The server PC must complete password setup before either account can use protected features.

## Standalone Notes Removal

The removed feature is the standalone Notes board represented by the `Notes` tab and `standalone_notes` collection.

Application removal includes:

- the Notes sidebar item and `TabName` value;
- Notes keyboard shortcut and command-palette/search routing;
- `NotesTab`, its board/editor/card components, drag-and-drop integration, styles, hooks, and standalone-note service;
- standalone note types and application contracts;
- `standalone_notes` from offline mutation, cache, import/export, and Data Manager allowlists; and
- new collection provisioning for `standalone_notes`.

Existing standalone note records are not automatically deleted. The old collection is left as an inert data archive in upgraded databases so this UI removal cannot destroy user-authored content. Relay no longer reads, synchronizes, displays, imports, exports, edits, or writes those records. A later explicit data-retention request may delete the archive.

The `notes` collection used for notes attached to a Contact or Server remains active. `NotesProvider`, `NotesModal`, contact/server note filters, and detail-panel note actions remain because they are part of Contacts and Servers. Dynatrace problem response notes also remain.

## Wiki and PDF Reader

### Naming

The outer sidebar and breadcrumb use **Knowledge**. Inside the Knowledge workspace, the document destination and heading use **Wiki**. Existing internal class/file names may keep `knowledge` where renaming would create noise, but user-facing copy follows this rule consistently.

### Reader modes

```ts
type KnowledgePdfViewMode = 'continuous' | 'single';
```

The toolbar exposes one mode control whose visible state reads `View: Continuous` or `View: Single page`. It uses `aria-pressed` or an equivalent explicit selection contract and has a visible keyboard focus state.

Continuous is the default for users without a saved preference. The selected mode is stored locally per workstation and is not synchronized. Changing mode keeps the same document and current page:

- Single page to Continuous scrolls the current page into view.
- Continuous to Single page opens the page with the greatest visible intersection.

### Continuous rendering architecture

The existing single-page rendering work is extracted into a reusable PDF page unit responsible for:

- canvas rendering at the current scale and device pixel ratio;
- selectable text layer;
- internal and external link layer;
- render-task cancellation and cleanup; and
- page-specific loading/error state.

Continuous mode creates lightweight page shells for the document but renders canvases only for visible pages and a small overscan range. An `IntersectionObserver` rooted on the PDF viewport identifies the current page and pages that should render. Offscreen page shells retain measured dimensions so scroll position stays stable; expensive canvas/text/link resources outside the overscan range are released.

The PDF document is loaded once and shared across modes. Page dimensions are cached for the active scale. Zooming or fitting recalculates shell dimensions and rerenders visible pages without loading the source PDF again. The viewer remains bounded and scrolls internally; it must not expand the Relay application shell.

Previous/next-page controls remain available. In Continuous mode they scroll to the adjacent page; in Single mode they replace the displayed page. The live page status updates from the most visible page. Outline and authored PDF-link destinations select the target document, scroll the target page into view, and apply the existing top-offset behavior.

### Reader resilience

- A failed page shows a page-local retry state without discarding successfully rendered pages.
- A failed document load retains the current document-level recovery UI.
- Rapid mode, zoom, document, or outline changes cancel stale render tasks.
- Offline reading continues to use the existing cached PDF transport.
- Continuous mode avoids rendering every page simultaneously, including large documents.
- Reduced-motion preferences replace smooth scrolling with immediate positioning.

## Component and Data Boundaries

The implementation should preserve focused responsibilities:

- `App` owns only the main Relay tab and passes a destination request into Knowledge.
- `KnowledgeWorkspace` owns `home | wiki | contacts | servers`, launcher counts, retained destination mounting, and the inner navigation.
- Existing Contacts and Servers components own their list/detail behavior.
- `KnowledgeTab`/Wiki owns library selection, outline state, management entry, and PDF destination requests.
- `KnowledgePdfViewer` owns mode, document-level controls, current-page synchronization, and the shared PDF document.
- `KnowledgePdfPage` owns one page's canvas, text, and links.
- Shared protected-access types describe account identity and capabilities without renderer access to secrets.
- Server managers own account lifecycle, ownership, Publisher assignment, migration, and authorization.

No renderer component writes protected account/state records directly. No normal Relay client writes the authoritative Wiki library directly.

## Error Handling and Recovery

- Invalid username/password responses remain generic and do not reveal whether an account exists.
- Username conflicts are validated case-insensitively on the server and reported inline.
- A stale account, ownership, Publisher, device, or setting change returns a conflict and offers refresh.
- Owner transfer cannot target an inactive, Publisher, or missing account.
- The current Owner cannot be deactivated, and migration cannot leave Relay without an Owner.
- Administrator actions against Owner/Administrator lifecycle are rejected even if a client submits a forged command.
- Publisher reassignment may recover through an unassigned state but never authorizes two Publishers.
- An identity migration failure leaves the old roster hidden but intact until the server can retry safely.
- A removed Notes route or stale stored tab value falls back to Knowledge home or Compose instead of rendering a blank panel.
- A removed People/Servers route maps to the matching Knowledge destination during one compatibility release.
- Continuous PDF page failures remain isolated to their page and provide retry.

## Accessibility and Interaction Requirements

- Launcher cards and inner destination controls are semantic buttons with unique accessible names.
- Focus order follows Wiki, Contacts, Servers, matching visual order.
- Contacts and Servers retain their existing keyboard navigation.
- The PDF mode control is keyboard operable and announces the active mode.
- Current PDF page status remains an `aria-live` update without announcing every scroll pixel.
- Viewer scroll, zoom, page, and outline actions preserve predictable focus.
- Text and controls meet Relay's high-contrast dark-theme standards.
- Motion is limited to short state transitions and respects `prefers-reduced-motion`.

## Testing Strategy

### Account and migration tests

- Existing Ryan Bledsoe and Charles Gibbs account IDs migrate to Owner `ryan` and Administrator `charles` exactly once.
- Existing password/credential state and paired-device account references are preserved.
- Duplicate or invalid usernames fail without partial migration.
- A duplicate/missing Ryan or Charles assignment stops before authority changes.
- Exactly one Owner remains authoritative after bootstrap and transfer.
- Multiple Administrators are supported within the existing bounded maximum.
- There is never more than one authoritative Publisher.
- Owner transfer demotes the previous Owner to Administrator and invalidates/re-evaluates affected sessions.
- Administrator lifecycle commands are Owner-only.
- Owner and Administrator can assign Publisher; Publisher cannot.
- Password auth uses username and never exposes internal email.
- Migration backfills only missing historical snapshots and never overwrites existing names.
- The roster collection is retired only after account and attribution verification succeeds.
- Re-running bootstrap after completion is a no-op.

### Operator-removal regressions

- Sidebar has no operator selector.
- Settings has no Operators roster or operator mutation actions.
- Ordinary actions no longer open an operator picker or fail for missing attribution.
- Historical operator names render from stored snapshots with no roster lookup.
- Operator IPC channels, preload methods, cache keys, and selected-operator storage are absent.
- Privileged login accepts username/password independently of ordinary app state.

### Notes removal regressions

- Sidebar, keyboard shortcuts, command palette, `TabName`, and app panels contain no standalone Notes destination.
- Standalone Notes code and CSS are not included in the renderer build.
- Data Manager, import/export, cache, and offline mutation contracts do not expose `standalone_notes`.
- Existing standalone-note rows are not deleted during upgrade.
- Contact notes, server notes, their filters/modals, and Dynatrace response notes continue to work.

### Knowledge workspace tests

- Knowledge home renders Wiki, Contacts, Servers in visual and keyboard order.
- Each launcher card opens the correct destination.
- `Knowledge home` returns to the launcher.
- Leaving and returning to Knowledge preserves the current destination and local state.
- Former People and Servers navigation requests map to Contacts and Servers inside Knowledge.
- Wiki remains the user-facing document label while the sidebar remains Knowledge.
- Contacts retains Add to Composer, CRUD, filters, detail panel, relationships, and notes.
- Servers retains CRUD, filters, detail panel, owner/support resolution, and notes.
- Loading, empty, offline, and error states are destination-specific.

### Continuous PDF tests

- A new workstation defaults to Continuous mode.
- The mode preference persists locally.
- Continuous mode has an internally scrollable viewport and multiple page shells.
- Only visible/overscan pages own rendered canvases and text/link layers.
- The current page status follows the most visible page.
- Previous/next controls scroll in Continuous mode and replace the page in Single mode.
- Switching modes preserves the current page.
- Zoom, fit, outline navigation, internal PDF links, external links, retries, and document replacement retain existing behavior.
- Stale render tasks are cancelled during rapid navigation.
- Large PDFs do not render every page at once.
- Offline cached PDFs work in both modes.

### Required gates

- Focused unit and renderer tests for each changed boundary.
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Browser verification of launcher order, all three destinations, mode switching, actual PDF viewport scrolling, keyboard focus, and empty/error states.
- Server/client smoke test for username sign-in, Ryan Owner authority, Charles Administrator authority, Publisher assignment, ordinary passwordless use, Wiki reading, and rejected unauthorized commands.
- Upgrade smoke test against a copy of the existing installation data before applying the migration to the real installation.

## Rollout Order

1. Add new account fields, bounded projections, username auth support, and migration tests while legacy fields still exist.
2. Migrate Ryan/Charles and any existing Publisher on a copied database; verify credentials and device relationships.
3. Change protected session/login and authorization to account identity.
4. Remove operator dependencies from ordinary renderer workflows and historical rendering.
5. Complete roster retirement only after migration verification.
6. Remove the standalone Notes application surface and contracts without deleting old rows.
7. Introduce the unified Knowledge workspace and compatibility routing.
8. Add Continuous PDF mode and retain Single page.
9. Run full tests, build, browser verification, and server/client upgrade smoke tests.
10. Apply the verified migration to the existing installation and confirm Ryan, Charles, Publisher state, paired devices, and historical names.

## Acceptance Criteria

- Relay starts and ordinary operations work without choosing or signing in as an operator.
- No live operator picker, roster, management surface, API, cache, or collection remains after successful migration.
- Ryan Bledsoe is the sole Owner with username `ryan`.
- Charles Gibbs is an Administrator with username `charles`.
- The Owner can manage Administrators and transfer ownership safely.
- The Owner and Administrators can assign or replace the single Publisher.
- Protected accounts use username, password, and display name; no email appears in the product.
- Historical operator names continue to render unchanged as read-only text.
- The standalone Notes tab and its application feature are absent, while existing rows are not silently deleted.
- Contact/server notes and Dynatrace response notes still work.
- Knowledge is the only top-level destination for Wiki, Contacts, and Servers.
- Knowledge home presents Wiki, Contacts, Servers in that order using the approved Relay-styled equal launcher.
- The inner document destination is labeled Wiki.
- Contacts and Servers retain their existing production behavior.
- The Wiki PDF viewer defaults to a genuinely scrollable Continuous mode and can switch to Single page without reloading or losing the current page.
- Existing managed Wiki, offline reading, upload, security, pairing, and server/client behaviors remain intact.
