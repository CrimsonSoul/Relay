# Privileged Pairing Layout Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the workstation-owner selector and Create pairing code button fully contained inside the privileged-access card at every supported width.

**Architecture:** Preserve `PrivilegedAccessPanel` markup and behavior, replacing only the fragile flex sizing in `components.css` with a bounded, shrinkable grid. A source-level CSS regression locks the desktop and 600px layouts without coupling the test to browser geometry.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, Vitest 4

## Global Constraints

- Preserve every option label, selected account state, disabled/loading state, pairing action, and accessibility label.
- Use `width: min(100%, 500px)`, `min-width: 0`, and `grid-template-columns: minmax(0, 1fr) auto` on the desktop action group.
- Keep an 8px gap, bottom-align the controls, and right-align the group with `margin-left: auto`.
- At `@media (max-width: 600px)`, use one full-width column and remove the auto left margin.
- Do not change privileged session behavior, roles, capabilities, IPC, or administration data.

---

## File Structure

- Create `src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts` for the pairing containment CSS contract.
- Modify `src/renderer/src/styles/components.css` for the pairing action grid and 600px layout.
- Leave `src/renderer/src/components/settings/PrivilegedAccessPanel.tsx` unchanged because the existing label, select, and button structure already exposes the required layout hooks.

### Task 1: Pairing Action Grid

**Files:**

- Create: `src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts`
- Modify: `src/renderer/src/styles/components.css:1974-1984`
- Modify: `src/renderer/src/styles/components.css:2420-2424`

**Interfaces:**

- Consumes: `.privileged-access__pairing-actions`, `.privileged-access__field`, and the existing native `<select>` rendered by `PrivilegedAccessPanel`.
- Produces: a two-column desktop grid and one-column 600px grid with no component API changes.

- [ ] **Step 1: Add the failing containment regression**

Create `src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/styles/components.css'),
  'utf8',
);

function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source)?.[1] ?? '';
}

function mediaBody(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  const end = css.indexOf('@media ', start + 1);
  return css.slice(start, end === -1 ? undefined : end);
}

describe('PrivilegedAccessPanel layout', () => {
  it('contains pairing controls in a bounded shrinkable desktop grid', () => {
    const actions = ruleBody(css, '.privileged-access__pairing-actions');
    const field = ruleBody(
      css,
      '.privileged-access__pairing-actions .privileged-access__field',
    );
    const select = ruleBody(css, '.privileged-access__pairing-actions select');

    expect(actions).toContain('display: grid;');
    expect(actions).toContain('width: min(100%, 500px);');
    expect(actions).toContain('min-width: 0;');
    expect(actions).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(actions).toContain('align-items: end;');
    expect(actions).toContain('gap: var(--space-2);');
    expect(actions).toContain('margin-left: auto;');
    expect(actions).not.toContain('min-width: min(100%, 420px);');
    expect(field).toContain('min-width: 0;');
    expect(select).toContain('width: 100%;');
  });

  it('stacks pairing controls at the existing 600px breakpoint', () => {
    const narrowActions = ruleBody(mediaBody(600), '.privileged-access__pairing-actions');

    expect(narrowActions).toContain('width: 100%;');
    expect(narrowActions).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(narrowActions).toContain('margin-left: 0;');
    expect(narrowActions).not.toContain('flex-direction: column;');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm run test:renderer -- src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts
```

Expected: FAIL because the current action group is a flex row with `min-width: min(100%, 420px)` and the narrow rule still uses flex direction.

- [ ] **Step 3: Replace the fragile flex sizing with the approved grid**

Replace the pairing action rules in `src/renderer/src/styles/components.css` with:

```css
.privileged-access__pairing-actions {
  display: grid;
  width: min(100%, 500px);
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--space-2);
  margin-left: auto;
}

.privileged-access__pairing-actions .privileged-access__field {
  min-width: 0;
}

.privileged-access__pairing-actions select {
  width: 100%;
}
```

Replace the `.privileged-access__pairing-actions` rule inside `@media (max-width: 600px)` with:

```css
.privileged-access__pairing-actions {
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  margin-left: 0;
}
```

- [ ] **Step 4: Run focused layout and behavior tests**

Run:

```bash
npm run test:renderer -- src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts src/renderer/src/components/settings/PrivilegedAccessPanel.test.tsx
```

Expected: both files PASS; the existing pairing challenge test continues to submit the selected account ID.

- [ ] **Step 5: Run static checks for the contained change**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
```

Expected: all three commands exit 0.

- [ ] **Step 6: Verify Settings > Access at desktop and narrow widths**

Run Relay:

```bash
npm run dev
```

In the Electron window, open Settings > Access with an active Owner or Administrator session. Verify at desktop width and at or below 600px that:

- the Workstation owner label and selector remain inside the pairing card;
- the Create pairing code button remains fully visible;
- the desktop row ends at the card's right edge;
- the narrow layout stacks the selector above a full-width button;
- selecting an account and creating a pairing code still works.

- [ ] **Step 7: Commit the pairing containment slice**

```bash
git add src/renderer/src/components/settings/PrivilegedAccessPanelStyles.test.ts src/renderer/src/styles/components.css
git commit -m "fix(settings): contain pairing account controls"
```
