# Compact Shell and Dynatrace Ticket References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Relay usable at roughly half-screen width and allow a timestamped Service Desk ticket reference, a NOC note, or both to satisfy the Dynatrace local-address requirement.

**Architecture:** Use content-driven CSS breakpoints for the compact application shell and Problems reflow. Keep Service Desk identifiers inside Relay's existing append-only Dynatrace note ledger as controlled `Ticket: ` entries so attribution, timestamps, offline queueing, LAN sync, and older-client readability remain unchanged.

**Tech Stack:** Electron, React 19, TypeScript, CSS, PocketBase, Vitest, React Testing Library, Playwright Electron.

## Global Constraints

- Do not add a Technician selector; the currently selected Relay operator remains the attribution source.
- Relay records Service Desk ticket numbers for notation only and never creates, updates, validates, or links to a Service Desk ticket.
- A saved response entry, drafted ticket reference, or drafted note satisfies the local-address requirement; ticket and note may both be supplied.
- Store ticket references through `dynatrace_problem_notes` as `Ticket: <normalized ticket number>` with the existing operator and timestamp metadata.
- Ticket references are trimmed, single-line, non-empty, and at most 120 characters; do not require a Service Desk prefix.
- Save ticket reference, then manual note, then addressed state. A failed history mutation must prevent the addressed mutation.
- Use a `64px` icon rail and hide the clock at `1200px` viewport width or less.
- Stack the Dynatrace Problems queue above the detail panel at `900px` viewport width or less.
- Use fixed `--info` and `--info-bright` tokens for `Addressed locally`; resolved stays green and active severity stays red, amber, or informational.
- Preserve LAN client/server behavior, offline mutation ordering, keyboard access, accessible labels, tooltips, focus visibility, and existing one-year history retention.

---

### Task 1: Ticket-reference notation contract

**Files:**

- Modify: `src/renderer/src/services/dynatraceProblemsService.ts`
- Test: `src/renderer/src/services/dynatraceProblemsService.test.ts`

**Interfaces:**

- Consumes: the existing `addDynatraceProblemNote(problemId, note, attribution)` append-only mutation.
- Produces: `MAX_DYNATRACE_TICKET_REFERENCE_LENGTH`, `DYNATRACE_TICKET_NOTE_PREFIX`, `formatDynatraceTicketReferenceNote(value)`, and `parseDynatraceTicketReferenceNote(note)` for the Problems UI and history renderer.

- [ ] **Step 1: Add failing formatter and parser tests**

Add these imports and cases to `dynatraceProblemsService.test.ts`:

```ts
import {
  DYNATRACE_TICKET_NOTE_PREFIX,
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  formatDynatraceTicketReferenceNote,
  parseDynatraceTicketReferenceNote,
} from './dynatraceProblemsService';

describe('Dynatrace ticket reference notation', () => {
  it('formats a trimmed Service Desk reference as an append-only note', () => {
    expect(formatDynatraceTicketReferenceNote('  INC0012345  ')).toBe('Ticket: INC0012345');
  });

  it.each(['', '   '])('rejects an empty ticket reference %#', (value) => {
    expect(() => formatDynatraceTicketReferenceNote(value)).toThrow(
      'Enter a Service Desk ticket number.',
    );
  });

  it('rejects multiline ticket references', () => {
    expect(() => formatDynatraceTicketReferenceNote('INC001\nCHG002')).toThrow(
      'Ticket numbers must fit on one line.',
    );
  });

  it('rejects ticket references longer than the UI contract', () => {
    expect(() =>
      formatDynatraceTicketReferenceNote('A'.repeat(MAX_DYNATRACE_TICKET_REFERENCE_LENGTH + 1)),
    ).toThrow('Ticket numbers can be up to 120 characters.');
  });

  it('parses only valid Relay ticket-reference notes', () => {
    expect(parseDynatraceTicketReferenceNote(`${DYNATRACE_TICKET_NOTE_PREFIX}INC0012345`)).toBe(
      'INC0012345',
    );
    expect(parseDynatraceTicketReferenceNote('Investigating the service.')).toBeNull();
    expect(parseDynatraceTicketReferenceNote(DYNATRACE_TICKET_NOTE_PREFIX)).toBeNull();
    expect(parseDynatraceTicketReferenceNote('Ticket: INC001\nCHG002')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused service test and confirm RED**

Run:

```bash
npx vitest run src/renderer/src/services/dynatraceProblemsService.test.ts
```

Expected: FAIL because the four ticket-reference exports do not exist.

- [ ] **Step 3: Implement the notation helpers**

Add this contract near `MAX_NOTE_LENGTH` in `dynatraceProblemsService.ts`:

```ts
export const MAX_DYNATRACE_TICKET_REFERENCE_LENGTH = 120;
export const DYNATRACE_TICKET_NOTE_PREFIX = 'Ticket: ';

function normalizeDynatraceTicketReference(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('Enter a Service Desk ticket number.');
  if (/\r|\n/.test(normalized)) throw new Error('Ticket numbers must fit on one line.');
  if (normalized.length > MAX_DYNATRACE_TICKET_REFERENCE_LENGTH) {
    throw new Error(
      `Ticket numbers can be up to ${MAX_DYNATRACE_TICKET_REFERENCE_LENGTH.toLocaleString()} characters.`,
    );
  }
  return normalized;
}

export function formatDynatraceTicketReferenceNote(value: string): string {
  return `${DYNATRACE_TICKET_NOTE_PREFIX}${normalizeDynatraceTicketReference(value)}`;
}

export function parseDynatraceTicketReferenceNote(note: string): string | null {
  if (!note.startsWith(DYNATRACE_TICKET_NOTE_PREFIX)) return null;
  try {
    return normalizeDynatraceTicketReference(note.slice(DYNATRACE_TICKET_NOTE_PREFIX.length));
  } catch {
    return null;
  }
}
```

Do not change PocketBase schemas or the `addDynatraceProblemNote` payload.

- [ ] **Step 4: Run the focused service test and confirm GREEN**

Run:

```bash
npx vitest run src/renderer/src/services/dynatraceProblemsService.test.ts
```

Expected: all service tests pass.

- [ ] **Step 5: Commit the notation contract**

```bash
git add src/renderer/src/services/dynatraceProblemsService.ts src/renderer/src/services/dynatraceProblemsService.test.ts
git commit -m "feat(problems): define ticket reference notation"
```

---

### Task 2: Local-response workflow, history, and blue addressed state

**Files:**

- Modify: `src/renderer/src/tabs/DynatraceProblemsTab.tsx`
- Modify: `src/renderer/src/tabs/dynatrace-problems.css`
- Test: `src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx`
- Create: `src/renderer/src/tabs/__tests__/DynatraceProblemsStyles.test.ts`

**Interfaces:**

- Consumes: `formatDynatraceTicketReferenceNote` and `parseDynatraceTicketReferenceNote` from Task 1; existing `addNote`, `setAddressed`, and `requireAttribution` callbacks.
- Produces: a labeled `Service Desk ticket number` input, an `Add ticket reference` action, ticket-aware history, ticket-or-note validation, ordered draft persistence, and informational-blue addressed badges.

- [ ] **Step 1: Add RED tests for ticket-only and combined addressing**

Add these cases to `DynatraceProblemsTab.test.tsx` using the file's existing `mocks`, `render`, `screen`, `fireEvent`, and `waitFor` setup:

```tsx
it('accepts a ticket reference instead of a NOC note and timestamps it before addressing', async () => {
  render(<DynatraceProblemsTab relayMode="client" />);
  await screen.findByRole('heading', { name: openProblem.title });

  const address = screen.getByRole('button', { name: 'Mark addressed locally' });
  fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
    target: { value: '  INC0012345  ' },
  });
  expect(address).toBeEnabled();
  fireEvent.click(address);

  await waitFor(() => {
    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Ticket: INC0012345', {
      operatorId: 'operator-ryan',
      operatorName: 'Ryan Bell',
    });
    expect(mocks.setAddressed).toHaveBeenCalledWith('problem-1', true, {
      operatorId: 'operator-ryan',
      operatorName: 'Ryan Bell',
    });
  });
  expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.setAddressed.mock.invocationCallOrder[0],
  );
});

it('saves ticket then note then local disposition when both drafts exist', async () => {
  render(<DynatraceProblemsTab relayMode="client" />);
  await screen.findByRole('heading', { name: openProblem.title });

  fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
    target: { value: 'INC0099999' },
  });
  fireEvent.change(screen.getByLabelText('Add a note'), {
    target: { value: 'Traffic shifted to the secondary pool.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

  await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(1));
  expect(mocks.addNote.mock.calls.map(([, value]) => value)).toEqual([
    'Ticket: INC0099999',
    'Traffic shifted to the secondary pool.',
  ]);
  expect(mocks.addNote.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.setAddressed.mock.invocationCallOrder[0],
  );
});
```

- [ ] **Step 2: Add RED tests for standalone saving, failure, history, and requirement copy**

Add these cases:

```tsx
it('adds a standalone ticket reference with selected-operator attribution', async () => {
  render(<DynatraceProblemsTab relayMode="client" />);
  await screen.findByRole('heading', { name: openProblem.title });
  fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
    target: { value: 'REQ0042000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add ticket reference' }));

  await waitFor(() =>
    expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Ticket: REQ0042000', {
      operatorId: 'operator-ryan',
      operatorName: 'Ryan Bell',
    }),
  );
});

it('retains ticket and note drafts and does not address when ticket persistence fails', async () => {
  mocks.addNote.mockRejectedValueOnce(new Error('Unable to queue the ticket reference.'));
  render(<DynatraceProblemsTab relayMode="client" />);
  await screen.findByRole('heading', { name: openProblem.title });
  fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
    target: { value: 'INC0012345' },
  });
  fireEvent.change(screen.getByLabelText('Add a note'), {
    target: { value: 'Keep this draft for retry.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

  await waitFor(() =>
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Unable to queue the ticket reference.',
      'error',
    ),
  );
  expect(mocks.setAddressed).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Service Desk ticket number')).toHaveValue('INC0012345');
  expect(screen.getByLabelText('Add a note')).toHaveValue('Keep this draft for retry.');
});

it('queues ticket then note then addressed state in order while offline', async () => {
  mocks.connectionState = 'offline';
  let finishTicket: (() => void) | undefined;
  mocks.addNote.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishTicket = () => resolve({});
      }),
  );
  render(<DynatraceProblemsTab relayMode="client" />);
  await screen.findByRole('heading', { name: openProblem.title });
  fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
    target: { value: 'INC0012345' },
  });
  fireEvent.change(screen.getByLabelText('Add a note'), {
    target: { value: 'Queued NOC context.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

  await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1));
  expect(mocks.setAddressed).not.toHaveBeenCalled();
  finishTicket?.();
  await waitFor(() => {
    expect(mocks.addNote).toHaveBeenCalledTimes(2);
    expect(mocks.setAddressed).toHaveBeenCalledTimes(1);
  });
  expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.addNote.mock.invocationCallOrder[1],
  );
  expect(mocks.addNote.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.setAddressed.mock.invocationCallOrder[0],
  );
});

it('renders Relay ticket notes as timestamped Service Desk references', async () => {
  mocks.hookValue = {
    ...mocks.hookValue,
    notesByProblemId: new Map([
      [
        'problem-1',
        [
          {
            id: 'ticket-1',
            problemId: 'problem-1',
            note: 'Ticket: INC0012345',
            operatorId: 'operator-ryan',
            author: 'Ryan Bell',
            created: '2026-07-15T12:30:00.000Z',
          },
        ],
      ],
    ]),
  };
  render(<DynatraceProblemsTab relayMode="client" />);
  const ticketValue = await screen.findByText('INC0012345');
  const ticketEntry = ticketValue.closest('article');
  expect(ticketEntry).not.toBeNull();
  expect(within(ticketEntry!).getByText('Service Desk ticket')).toBeVisible();
  expect(within(ticketEntry!).getByText('Ryan Bell')).toBeVisible();
});

it('explains that either a ticket number or NOC note is required', async () => {
  render(<DynatraceProblemsTab relayMode="client" />);
  expect(
    await screen.findByText(
      'Add a Service Desk ticket number or NOC note before marking this problem addressed locally.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Relay records the ticket number for notation only/i)).toBeVisible();
});
```

Create `DynatraceProblemsStyles.test.ts` with the explicit semantic-color contract:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/tabs/dynatrace-problems.css'),
  'utf8',
);

describe('Dynatrace local disposition styling', () => {
  it('uses informational blue for Addressed locally', () => {
    const block = /\.dt-problem-badge--addressed\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(block).toContain('border-color: var(--info)');
    expect(block).toContain('var(--info) 12%');
    expect(block).toContain('color: var(--info-bright)');
  });
});
```

- [ ] **Step 3: Run the tab test and confirm RED**

Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsStyles.test.ts
```

Expected: FAIL because the ticket input/action/history, revised requirement copy, and informational addressed color are absent.

- [ ] **Step 4: Implement ticket drafts and ordered save behavior**

In `DynatraceProblemsTab.tsx`:

```tsx
import type { OperatorAttribution } from '@shared/operators';
import {
  MAX_DYNATRACE_TICKET_REFERENCE_LENGTH,
  formatDynatraceTicketReferenceNote,
  parseDynatraceTicketReferenceNote,
} from '../services/dynatraceProblemsService';
```

Add `ticketDraft`, reset it with selection changes, and extend `ProblemDetailProps` and its call site with:

```ts
ticketDraft: string;
onTicketDraftChange: (value: string) => void;
onSaveTicketReference: () => void;
```

Extend both `savingAction` unions with `'ticket'`. Replace the note-only requirement with:

```ts
const responseRequirementMet =
  notes.length > 0 || ticketDraft.trim().length > 0 || noteDraft.trim().length > 0;
```

Use this helper inside the tab component so drafts clear only after their own mutation succeeds:

```ts
const saveDraftedResponses = async (problemId: string, attribution: OperatorAttribution) => {
  if (ticketDraft.trim()) {
    await addNote(problemId, formatDynatraceTicketReferenceNote(ticketDraft), attribution);
    setTicketDraft('');
  }
  if (noteDraft.trim()) {
    await addNote(problemId, noteDraft, attribution);
    setNoteDraft('');
  }
};
```

Call `await saveDraftedResponses(...)` before `await setAddressed(...)`. Add `handleSaveTicketReference` that obtains attribution, formats the value, awaits `addNote`, clears only `ticketDraft`, and uses the existing toast/error/finally pattern.

Change the unmet-requirement copy to exactly:

```text
Add a Service Desk ticket number or NOC note before marking this problem addressed locally.
```

- [ ] **Step 5: Render the ticket control and ticket-aware history**

Add this labeled control before the NOC note textarea:

```tsx
<div className="dt-problem-ticket-composer">
  <label htmlFor="dt-problem-ticket-number">Service Desk ticket number</label>
  <div className="dt-problem-ticket-composer__control">
    <input
      id="dt-problem-ticket-number"
      type="text"
      value={ticketDraft}
      onChange={(event) => onTicketDraftChange(event.target.value)}
      maxLength={MAX_DYNATRACE_TICKET_REFERENCE_LENGTH}
      disabled={!mutationsEnabled || savingAction !== null}
      placeholder="INC, REQ, CHG, or other ticket number"
    />
    <button
      type="button"
      onClick={onSaveTicketReference}
      disabled={!mutationsEnabled || !ticketDraft.trim() || savingAction !== null}
    >
      {savingAction === 'ticket' ? 'Adding…' : 'Add ticket reference'}
    </button>
  </div>
  <small>Relay records the ticket number for notation only. It does not create or update a Service Desk ticket.</small>
</div>
```

In each history article, branch on:

```tsx
const ticketReference = parseDynatraceTicketReferenceNote(note.note);
```

Render a `.dt-problem-note__ticket` block with label `Service Desk ticket` and the parsed value when present; otherwise keep the existing `<p>{note.note}</p>` output.

- [ ] **Step 6: Add compact control and informational badge styles**

In `dynatrace-problems.css`, replace the existing `.dt-problem-badge--addressed` block and add:

```css
.dt-problem-badge--addressed {
  border-color: var(--info);
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info-bright);
}

.dt-problem-ticket-composer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.dt-problem-ticket-composer > label,
.dt-problem-ticket-composer__control + small {
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
}

.dt-problem-ticket-composer__control {
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
}

.dt-problem-ticket-composer__control input {
  min-width: 0;
  min-height: 40px;
  flex: 1;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  outline: 0;
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font: inherit;
}

.dt-problem-ticket-composer__control button {
  min-height: 40px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.dt-problem-note__ticket {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--color-text-secondary);
}

.dt-problem-note__ticket > span {
  color: var(--info-bright);
  font-size: var(--text-2xs);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
}

.dt-problem-note__ticket > strong {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
}
```

At the existing narrow Problems breakpoint, stack `.dt-problem-ticket-composer__control` and make its button full width.

Add the ticket input and button to the existing Problems focus, hover, and disabled selector groups so they receive the same visible focus and interaction states as the note composer controls.

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run src/renderer/src/services/dynatraceProblemsService.test.ts
node scripts/run-renderer-tests.mjs src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsStyles.test.ts
```

Expected: both files pass, including existing note-only, offline, attribution, and historical-record cases.

- [ ] **Step 8: Commit the local-response workflow**

```bash
git add src/renderer/src/tabs/DynatraceProblemsTab.tsx src/renderer/src/tabs/dynatrace-problems.css src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsStyles.test.ts
git commit -m "feat(problems): accept ticket references for local response"
```

---

### Task 3: Responsive compact shell and Problems reflow

**Files:**

- Modify: `src/renderer/src/components/sidebar/sidebar.css`
- Modify: `src/renderer/src/styles/responsive.css`
- Modify: `src/renderer/src/tabs/dynatrace-problems.css`
- Modify: `docs/DESIGN.md`
- Create: `src/renderer/src/__tests__/responsiveShell.test.ts`

**Interfaces:**

- Consumes: existing sidebar buttons with `aria-label`, existing Tooltip wrappers, `--sidebar-width-collapsed`, and the current `860px` Problems media query.
- Produces: the `1200px` icon-rail/clock breakpoint and the `900px` Problems stack contract.

- [ ] **Step 1: Add a RED stylesheet contract test**

Create `responsiveShell.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readCss = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), 'src/renderer/src', relativePath), 'utf8');

describe('compact Relay shell', () => {
  it('uses a content-driven icon rail and hides the clock at 1200px', () => {
    const responsive = readCss('styles/responsive.css');
    expect(responsive).toContain('@media (max-width: 1200px)');
    expect(responsive).toMatch(/--sidebar-width-collapsed:\s*64px/);
    expect(responsive).toMatch(/\.world-clock-container\s*{[^}]*display:\s*none/s);
    expect(responsive).toMatch(/\.sidebar-button-label\s*{[^}]*display:\s*none/s);
  });

  it('stacks the Problems workspace at 900px', () => {
    const problems = readCss('tabs/dynatrace-problems.css');
    expect(problems).toContain('@media (max-width: 900px)');
    expect(problems).toMatch(/\.dt-problems__workspace\s*{[^}]*grid-template-columns:\s*1fr/s);
  });
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/__tests__/responsiveShell.test.ts
```

Expected: FAIL because the shell has no `1200px` compact rule and Problems still stacks at `860px`.

- [ ] **Step 3: Implement the compact icon rail and hidden clock**

Add this content-driven block to `responsive.css`:

```css
@media (max-width: 1200px) {
  :root {
    --sidebar-width-collapsed: 64px;
  }

  .sidebar-app-icon {
    align-items: center;
    padding-right: 0;
    padding-left: 0;
  }

  .sidebar-app-icon-label {
    font-size: 0;
  }

  .sidebar-app-icon-label::before {
    content: 'r';
    color: var(--color-text-primary);
    font-size: var(--text-lg);
  }

  .sidebar-app-icon-label::after {
    font-size: var(--text-lg);
  }

  .sidebar-nav,
  .sidebar-footer {
    width: 100%;
  }

  .sidebar-footer {
    padding-right: 0;
    padding-left: 0;
  }

  .sidebar-button {
    --sidebar-button-width: 64px;

    align-items: center;
    padding-right: 0;
    padding-left: 0;
  }

  .sidebar-button-icon {
    width: 100%;
  }

  .sidebar-button-label {
    display: none;
  }

  .world-clock-container {
    display: none;
  }

  .header-search-container {
    padding-right: var(--space-3);
    padding-left: var(--space-3);
  }
}
```

Keep the component markup, Tooltip wrappers, and `aria-label` values unchanged. Verify the active left rail remains visible within the 64px button.

- [ ] **Step 4: Move the Problems structural breakpoint to 900px**

Change the existing rule in `dynatrace-problems.css` from:

```css
@media (max-width: 860px) {
```

to:

```css
@media (max-width: 900px) {
```

Keep the existing one-column workspace, queue/detail border handoff, and vertical scrolling behavior. Add the ticket-control stacking rule from Task 2 inside this block.

- [ ] **Step 5: Document the compact shell contract**

Add a `Compact Window Behavior` subsection to `docs/DESIGN.md` containing the exact `1200px`, `64px`, and `900px` values, the content-driven rationale, and the requirement that labels remain available through `aria-label` and Tooltip.

- [ ] **Step 6: Run focused shell and sidebar regressions**

Run:

```bash
node scripts/run-renderer-tests.mjs src/renderer/src/__tests__/responsiveShell.test.ts src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx src/renderer/src/components/__tests__/WorldClock.test.tsx
```

Expected: all tests pass; full-width component behavior remains unchanged.

- [ ] **Step 7: Commit the responsive shell**

```bash
git add src/renderer/src/components/sidebar/sidebar.css src/renderer/src/styles/responsive.css src/renderer/src/tabs/dynatrace-problems.css src/renderer/src/__tests__/responsiveShell.test.ts docs/DESIGN.md
git commit -m "feat(ui): adapt Relay shell for compact windows"
```

---

### Task 4: Electron integration, visual QA, and final verification

**Files:**

- Modify: `tests/e2e/critical-path.spec.ts`
- Verify: all files changed by Tasks 1-3

**Interfaces:**

- Consumes: the ticket notation and compact CSS contracts from Tasks 1-3.
- Produces: a real server/client sync regression for a ticket-only local response and evidence that the shell remains unclipped at the three approved viewport sizes.

- [ ] **Step 1: Convert the online Dynatrace attribution E2E case to ticket-only response**

In the existing `new Dynatrace Problems sync Ryan Bell attribution to a connected client` case, define:

```ts
const ticketNumber = `INC-${uniqueSuffix()}`;
const ticketNote = `Ticket: ${ticketNumber}`;
```

Replace the note fill with:

```ts
await window.getByLabel('Service Desk ticket number').fill(ticketNumber);
await expect(addressedAction).toBeEnabled();
await addressedAction.click();
```

Pass `ticketNote` to `getDynatraceAttribution`, and replace the synced-note assertion with:

```ts
const syncedTicket = clientDetail.locator('.dt-problem-note', { hasText: ticketNumber });
await expect(syncedTicket).toContainText('Service Desk ticket');
await expect(syncedTicket).toContainText(RYAN_BELL);
```

Keep the separate offline note case unchanged so both ticket-only online sync and note-only offline queueing remain covered.

- [ ] **Step 2: Run the targeted Electron critical path and confirm GREEN**

Run the repository's Electron test command with the existing critical-path suite:

```bash
npm run test:electron -- --grep "new Dynatrace Problems sync Ryan Bell attribution"
```

Expected: the server stores the `Ticket: ` note and addressed state with the same operator ID/name, and the connected client renders the timestamped ticket reference.

If the script does not forward Playwright grep arguments, run `npm run test:electron` and record the full result instead of changing the package script.

- [ ] **Step 3: Capture and inspect the three approved viewport states**

Launch Relay against deterministic Dynatrace demo data and capture the Problems tab at:

```text
1920x1080
960x1000
840x1000
```

For each viewport, inspect and record:

```text
- no horizontal document overflow
- no clipped sidebar, queue, detail, ticket, note, or address controls
- 1920px: labeled 136px sidebar and visible clock
- 960px and 840px: 64px icon rail and hidden clock
- 960px: usable master-detail layout
- 840px: queue stacked above detail
- red active/severity, blue Addressed locally, and green Resolved remain distinguishable
- keyboard focus and Tooltip access remain visible on compact sidebar icons
```

Use browser/computer inspection plus screenshots; do not approve based only on DOM tests.

- [ ] **Step 4: Run focused and full automated gates**

Run:

```bash
npx vitest run src/renderer/src/services/dynatraceProblemsService.test.ts
node scripts/run-renderer-tests.mjs src/renderer/src/tabs/__tests__/DynatraceProblemsTab.test.tsx src/renderer/src/tabs/__tests__/DynatraceProblemsStyles.test.ts src/renderer/src/__tests__/responsiveShell.test.ts src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx src/renderer/src/components/__tests__/WorldClock.test.tsx
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:electron
git diff --check
```

Expected: every command exits `0`; no existing client/server, offline, Knowledge Base, operator attribution, or Dynatrace regression fails.

- [ ] **Step 5: Review the complete feature diff**

Review from spec commit `0f10d955` through the implementation tip:

```bash
git diff --check 0f10d955..HEAD
git diff --stat 0f10d955..HEAD
git diff 0f10d955..HEAD -- src/renderer/src/services/dynatraceProblemsService.ts src/renderer/src/tabs/DynatraceProblemsTab.tsx src/renderer/src/tabs/dynatrace-problems.css src/renderer/src/styles/responsive.css src/renderer/src/components/sidebar/sidebar.css tests/e2e/critical-path.spec.ts
```

Confirm the diff contains no new Service Desk network call, no new operator selector, no PocketBase schema mutation, and no change to client/server connection behavior.

- [ ] **Step 6: Commit the integration regression**

```bash
git add tests/e2e/critical-path.spec.ts
git commit -m "test(problems): cover ticket reference sync"
```

- [ ] **Step 7: Verify committed-tree cleanliness**

Run:

```bash
git status --short --branch
git diff --check
git log -5 --oneline
```

Expected: clean `codex/knowledge-base` worktree with the Task 1-4 commits at the tip. Do not push or merge without a separate user request.
