# Signal Sans Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Relay's UI from dark+amber to "Signal Sans" — new font, red accent, two-line contact entries, status bars, and removal of dot patterns — across all tabs except alert-specific components.

**Architecture:** Theme tokens are centralized in `theme.css` so most color/font/spacing changes propagate automatically. Component-level changes focus on ContactCard (two-line layout), TactileButton (sizing), and a new StatusBar component. Each tab gets targeted CSS updates and the new StatusBar.

**Tech Stack:** React 19, TypeScript, vanilla CSS with custom properties, react-window (virtualization), Electron, fontsource for web fonts.

**Spec:** `docs/superpowers/specs/2026-03-27-signal-sans-redesign-design.md`

**Mockups:** `.superpowers/design-mockups/signal-hybrid.html` (Compose), `.superpowers/design-mockups/signal-sans-tabs.html` (other tabs)

---

### Task 1: Install Instrument Sans Font

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `package.json`

- [ ] **Step 1: Install the font package**

```bash
cd /Users/ryan/Apps/Relay
npm install @fontsource-variable/instrument-sans
```

- [ ] **Step 2: Add the import to main.tsx**

In `src/renderer/src/main.tsx`, add this import alongside the existing font imports:

```typescript
import '@fontsource-variable/instrument-sans';
```

Place it right after `import '@fontsource-variable/space-grotesk';`.

- [ ] **Step 3: Verify the app still boots**

```bash
npm run dev
```

Expected: App launches without errors. No visual change yet (font not referenced in CSS).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx
git commit -m "feat: install Instrument Sans font package"
```

---

### Task 2: Update Theme Tokens — Typography & Colors

**Files:**
- Modify: `src/renderer/src/styles/theme.css`

This is the highest-leverage change — most of the app's visual identity flows from these tokens.

- [ ] **Step 1: Update font family token**

In `src/renderer/src/styles/theme.css`, find the `--font-family-base` declaration and change it:

```css
--font-family-base: 'Instrument Sans Variable', 'Instrument Sans', sans-serif;
```

- [ ] **Step 2: Update color tokens — backgrounds**

Find the background color section and replace the values:

```css
--color-bg-app: #070810;
--color-bg-surface: #0c0e15;
--color-bg-surface-2: #10131b;
--color-bg-surface-3: #151821;
--color-bg-card: #0c0e15;
--color-bg-card-hover: #10131b;
--color-bg-surface-elevated: #151821;
--color-bg-sidebar: #0c0e15;
```

- [ ] **Step 3: Update color tokens — text**

```css
--color-text-primary: #eef0f6;
--color-text-secondary: #6e7a90;
--color-text-tertiary: #374058;
```

- [ ] **Step 4: Update color tokens — accent (amber → signal red)**

Replace the amber accent block with signal red:

```css
--color-accent: #e11d48;
--color-accent-hover: #be123c;
--color-accent-text: #fb7185;
--color-accent-dim: rgba(225, 29, 72, 0.10);
--color-accent-subtle: rgba(225, 29, 72, 0.05);
```

Keep `--color-accent-green`, `--color-accent-secondary` (cyan), and `--color-danger` as they are.

- [ ] **Step 5: Add group color tokens**

Add these new tokens after the accent section (these are used for tags, avatars, team cards):

```css
/* Group / category accent colors */
--color-group-blue: #38bdf8;
--color-group-blue-dim: rgba(56, 189, 248, 0.10);
--color-group-purple: #c084fc;
--color-group-purple-dim: rgba(192, 132, 252, 0.10);
--color-group-orange: #fb923c;
--color-group-orange-dim: rgba(251, 146, 60, 0.10);
--color-group-cyan: #22d3ee;
--color-group-cyan-dim: rgba(34, 211, 238, 0.10);
--color-group-green: #10b981;
--color-group-green-dim: rgba(16, 185, 129, 0.10);
--color-group-warn: #eab308;
--color-group-warn-text: #fbbf24;
--color-group-warn-dim: rgba(234, 179, 8, 0.10);
```

- [ ] **Step 6: Update border tokens**

```css
--border-default: rgba(255, 255, 255, 0.055);
--border-subtle: rgba(255, 255, 255, 0.03);
```

- [ ] **Step 7: Update border-radius tokens**

```css
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 14px;
```

- [ ] **Step 8: Remove dot pattern tokens**

Find and delete the `--chrome-pattern`, `--chrome-pattern-size`, `--chrome-pattern-position`, `--surface-pattern`, `--surface-pattern-size`, `--surface-pattern-position` declarations. Leave the lines blank or remove them entirely.

- [ ] **Step 9: Update shadow tokens**

Find `--shadow-modal` and remove any amber/accent glow component from it. Replace with:

```css
--shadow-modal: 0 24px 80px rgba(0, 0, 0, 0.5);
```

- [ ] **Step 10: Verify the app renders with new theme**

```bash
npm run dev
```

Expected: App renders with red accent, Instrument Sans font, darker backgrounds. Some things will look broken (dot patterns referenced in CSS, amber hardcoded colors) — that's expected, we'll fix those in subsequent tasks.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/styles/theme.css
git commit -m "feat: update theme tokens — Signal Sans typography, colors, radii"
```

---

### Task 3: Remove Dot Patterns from Surfaces

**Files:**
- Modify: `src/renderer/src/styles/utilities.css`
- Modify: `src/renderer/src/styles/components.css`

The `.card-surface` class and anywhere that references `--surface-pattern` or `--chrome-pattern` needs to be cleaned up.

- [ ] **Step 1: Update `.card-surface` in utilities.css**

In `src/renderer/src/styles/utilities.css`, find the `.card-surface` class and remove the `background-image`, `background-size`, and `background-position` properties that reference pattern tokens. Keep the `background-color`, `border`, and `border-radius` properties. The result should look like:

```css
.card-surface {
  background-color: var(--color-bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
```

- [ ] **Step 2: Remove pattern references from components.css**

Search `src/renderer/src/styles/components.css` for any references to `--surface-pattern`, `--chrome-pattern`, `surface-pattern`, or `chrome-pattern` and remove those `background-image`, `background-size`, `background-position` lines.

- [ ] **Step 3: Remove pattern references from modals.css**

Search `src/renderer/src/styles/modals.css` for pattern references and remove them.

- [ ] **Step 4: Remove pattern references from all tab CSS files**

Search and remove pattern references from:
- `src/renderer/src/tabs/assembler/assembler.css`
- `src/renderer/src/components/directory/directory.css`
- `src/renderer/src/components/oncall/oncall.css`
- `src/renderer/src/components/sidebar/sidebar.css`
- `src/renderer/src/tabs/cloud-status.css`
- `src/renderer/src/tabs/notes/notes.css`

For each file, remove any `background-image` lines referencing pattern tokens, along with their paired `background-size` and `background-position` lines.

- [ ] **Step 5: Verify no dot patterns remain**

```bash
cd /Users/ryan/Apps/Relay
grep -r "surface-pattern\|chrome-pattern" src/renderer/src/styles/ src/renderer/src/tabs/ src/renderer/src/components/ --include="*.css"
```

Expected: No matches.

- [ ] **Step 6: Verify app renders cleanly**

```bash
npm run dev
```

Expected: All surfaces are flat/clean — no amber dot textures anywhere.

- [ ] **Step 7: Commit**

```bash
git add -A src/renderer/src/styles/ src/renderer/src/tabs/ src/renderer/src/components/
git commit -m "refactor: remove dot scatter patterns from all surfaces"
```

---

### Task 4: Update Hardcoded Amber Colors

**Files:**
- Modify: `src/renderer/src/utils/colors.ts`
- Modify: `src/renderer/src/styles/components.css`
- Modify: `src/renderer/src/components/sidebar/sidebar.css`

Some amber values are hardcoded (not using CSS variables). These need to be updated to signal red or to use the CSS variable.

- [ ] **Step 1: Update the AMBER constant in colors.ts**

In `src/renderer/src/utils/colors.ts`, update the `AMBER` export to use signal red:

```typescript
export const AMBER: ColorScheme = {
  bg: 'rgba(225, 29, 72, 0.15)',
  border: 'rgba(225, 29, 72, 0.3)',
  text: '#fb7185',
  fill: '#e11d48',
};
```

Note: Keep the variable name as `AMBER` to avoid a rename cascade — it's the "primary accent" color scheme regardless of the actual hue.

- [ ] **Step 2: Search for hardcoded amber hex values in CSS**

```bash
cd /Users/ryan/Apps/Relay
grep -rn "#f59e0b\|#fbbf24\|#fcd34d\|245, 158, 11\|245,158,11" src/renderer/src/styles/ src/renderer/src/components/ src/renderer/src/tabs/ --include="*.css" | grep -v "alerts"
```

For each match found (excluding alerts CSS), replace:
- `#f59e0b` → `var(--color-accent)` or `#e11d48` where CSS vars aren't supported
- `#fbbf24` → `var(--color-accent-hover)` or `#be123c`
- `#fcd34d` → `var(--color-accent-text)` or `#fb7185`
- `rgba(245, 158, 11, ...)` → use the appropriate `--color-accent-dim` or `--color-accent-subtle` token

**Do NOT modify** any file under `src/renderer/src/tabs/alerts.css` or alert-specific component CSS.

- [ ] **Step 3: Update sidebar accent colors**

In `src/renderer/src/components/sidebar/sidebar.css`, replace any hardcoded amber references with `var(--color-accent)` equivalents.

- [ ] **Step 4: Verify no hardcoded amber remains (outside alerts)**

```bash
grep -rn "#f59e0b\|#fbbf24\|#fcd34d\|245, 158, 11\|245,158,11" src/renderer/src/styles/ src/renderer/src/components/ src/renderer/src/tabs/ --include="*.css" | grep -v "alerts"
```

Expected: No matches.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/colors.ts src/renderer/src/styles/ src/renderer/src/components/ src/renderer/src/tabs/
git commit -m "refactor: replace hardcoded amber values with signal red accent"
```

---

### Task 5: Update TactileButton Sizing

**Files:**
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Update button styles for TV readability**

In `src/renderer/src/styles/components.css`, find the `.tactile-button` styles and update:

```css
.tactile-button {
  font-family: var(--font-family-base);
  font-size: 14px;
  font-weight: 600;
  padding: 9px 20px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  /* keep existing transition, cursor, display, etc. */
}

.tactile-button--sm {
  padding: 7px 16px;
  font-size: 13px;
}
```

Make sure the primary variant uses `var(--color-accent)` for background and border (it likely already references the token).

- [ ] **Step 2: Verify buttons render correctly**

```bash
npm run dev
```

Check that buttons across tabs are larger and use Instrument Sans.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles/components.css
git commit -m "feat: update TactileButton sizing for TV readability"
```

---

### Task 6: Create StatusBar Component

**Files:**
- Create: `src/renderer/src/components/StatusBar.tsx`
- Create: `src/renderer/src/components/statusbar.css`

- [ ] **Step 1: Write the StatusBar component**

Create `src/renderer/src/components/StatusBar.tsx`:

```tsx
import { memo } from 'react';
import type { ReactNode } from 'react';
import './statusbar.css';

interface StatusBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export const StatusBar = memo(function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <div className="status-bar">
      {left && <div className="status-bar-left">{left}</div>}
      {center && (
        <>
          <div className="status-bar-sep" />
          <div className="status-bar-center">{center}</div>
        </>
      )}
      <div className="status-bar-right">{right}</div>
    </div>
  );
});

export function StatusBarLive({ label = 'Connected' }: { label?: string }) {
  return (
    <span className="status-bar-live">
      <span className="status-bar-live-dot" />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Write the StatusBar CSS**

Create `src/renderer/src/components/statusbar.css`:

```css
.status-bar {
  padding: 10px 28px;
  border-top: 1px solid var(--border-default);
  background: var(--color-bg-surface);
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 13px;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.status-bar-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.status-bar-sep {
  width: 1px;
  height: 14px;
  background: var(--border-default);
  flex-shrink: 0;
}

.status-bar-center {
  display: flex;
  align-items: center;
  gap: 24px;
}

.status-bar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 24px;
}

.status-bar-live {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
}

.status-bar-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-group-green);
  animation: status-bar-pulse 2s infinite;
  flex-shrink: 0;
}

@keyframes status-bar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

- [ ] **Step 3: Verify component renders in isolation**

Temporarily add `<StatusBar left={<StatusBarLive />} right={<span>Test</span>} />` to `AssemblerTab.tsx` at the bottom of the layout, import it, and check it renders.

- [ ] **Step 4: Remove the temporary test usage**

Revert the temporary addition to AssemblerTab.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/StatusBar.tsx src/renderer/src/components/statusbar.css
git commit -m "feat: add StatusBar component with live indicator"
```

---

### Task 7: Redesign ContactCard — Two-Line Layout

**Files:**
- Modify: `src/renderer/src/components/ContactCard.tsx`
- Modify: `src/renderer/src/components/directory/directory.css`

This is the biggest visual change — switching from a single-line card to a two-line entry with avatar.

- [ ] **Step 1: Read current ContactCard.tsx**

Read `src/renderer/src/components/ContactCard.tsx` fully to understand the current props and structure.

- [ ] **Step 2: Update ContactCard JSX to two-line layout**

Rewrite the return JSX of `ContactCard` to use the new two-line entry pattern. Keep all existing props and functionality. The new structure should be:

```tsx
return (
  <div
    className={`contact-entry ${selected ? 'contact-entry--selected' : ''}`}
    onContextMenu={onContextMenu}
    onClick={onRowClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onRowClick?.(e as any); }}
  >
    <Avatar
      name={name}
      email={email}
      className="contact-entry-avatar"
    />
    <div className="contact-entry-body">
      <div className="contact-entry-line1">
        <span className="contact-entry-name">{name || email}</span>
        {tags && tags.length > 0 && (
          <GroupPill group={tags[0]} />
        )}
      </div>
      <div className="contact-entry-line2">
        {email && <span>{email}</span>}
        {title && <><span className="contact-entry-dot">·</span><span>{title}</span></>}
        {phone && <><span className="contact-entry-dot">·</span><span className="contact-entry-phone">{formatPhoneNumber(phone)}</span></>}
      </div>
    </div>
    <div className="contact-entry-actions">
      {action}
      {hasNotes && onNotesClick && (
        <button className="contact-entry-notes-btn" onClick={(e) => { e.stopPropagation(); onNotesClick(); }}>
          📝
        </button>
      )}
    </div>
  </div>
);
```

- [ ] **Step 3: Add new CSS for two-line contact entry**

In `src/renderer/src/components/directory/directory.css`, add the new `.contact-entry` styles (keep old `.contact-card` styles until all references are migrated):

```css
/* Two-line contact entry */
.contact-entry {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  padding: 14px 28px;
  gap: 16px;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 0.12s;
  cursor: default;
}

.contact-entry:hover {
  background: var(--color-bg-card-hover);
}

.contact-entry--selected {
  background: var(--color-accent-subtle);
}

.contact-entry-avatar.avatar {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 700;
}

.contact-entry-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-entry-line1 {
  display: flex;
  align-items: center;
  gap: 12px;
}

.contact-entry-name {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-entry-line2 {
  display: flex;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  align-items: center;
}

.contact-entry-line2 span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-entry-dot {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  font-size: 10px;
}

.contact-entry-phone {
  font-family: var(--font-family-mono);
}

.contact-entry-actions {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.contact-entry:hover .contact-entry-actions {
  opacity: 1;
}

.contact-entry-notes-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 4px;
}
```

- [ ] **Step 4: Update VirtualRow height**

In `src/renderer/src/tabs/assembler/VirtualRow.tsx`, and anywhere `ROW_HEIGHT` or `itemSize` is set for the compose list, update the row height from `80` to `72`.

Also check `src/renderer/src/tabs/DirectoryTab.tsx` and `src/renderer/src/tabs/ServersTab.tsx` for their `ROW_HEIGHT` constants and update to `72`.

- [ ] **Step 5: Verify contact entries render correctly**

```bash
npm run dev
```

Navigate to Compose and Directory tabs. Contacts should show in two-line format with avatar, name+tag on line 1, email·title·phone on line 2.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ContactCard.tsx src/renderer/src/components/directory/directory.css src/renderer/src/tabs/
git commit -m "feat: redesign ContactCard to two-line entry layout"
```

---

### Task 8: Redesign Assembler Sidebar

**Files:**
- Modify: `src/renderer/src/tabs/assembler/AssemblerSidebar.tsx`
- Modify: `src/renderer/src/tabs/assembler/assembler.css`

- [ ] **Step 1: Read current AssemblerSidebar.tsx**

Read `src/renderer/src/tabs/assembler/AssemblerSidebar.tsx` fully.

- [ ] **Step 2: Update group item rendering**

Update the group list items in `AssemblerSidebar.tsx` to use the new two-line layout with SVG checkmarks. Each group item should render:

```tsx
<div
  className={`sig-grp ${isSelected ? 'sig-grp--on' : ''}`}
  onClick={() => onToggleGroup(group.id)}
>
  <div className="sig-grp-check">
    <svg viewBox="0 0 16 16" className="sig-grp-checkmark">
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
  <div className="sig-grp-info">
    <div className="sig-grp-name">{group.name}</div>
    <div className="sig-grp-sub">{group.emails.length} contacts</div>
  </div>
</div>
```

- [ ] **Step 3: Add sidebar footer with stats**

At the bottom of the sidebar, add a stats footer:

```tsx
<div className="sig-sidebar-footer">
  <span>Total contacts <span className="sig-sidebar-footer-val">{totalContacts}</span></span>
  <span>Selected <span className="sig-sidebar-footer-val sig-sidebar-footer-val--accent">{selectedCount}</span></span>
</div>
```

Where `totalContacts` and `selectedCount` come from props or computed values.

- [ ] **Step 4: Add CSS for new sidebar styles**

In `src/renderer/src/tabs/assembler/assembler.css`, add:

```css
/* New sidebar group items */
.sig-grp {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--border-subtle);
}

.sig-grp:hover {
  background: var(--color-bg-card-hover);
}

.sig-grp--on {
  background: var(--color-accent-subtle);
  border-left-color: var(--color-accent);
}

.sig-grp-check {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-text-tertiary);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
  color: transparent;
}

.sig-grp--on .sig-grp-check {
  background: var(--color-accent);
  border-color: var(--color-accent);
  color: #fff;
}

.sig-grp-checkmark {
  width: 12px;
  height: 12px;
}

.sig-grp-info {
  flex: 1;
  min-width: 0;
}

.sig-grp-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.sig-grp--on .sig-grp-name {
  color: var(--color-text-primary);
}

.sig-grp-sub {
  font-size: 13px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.sig-sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--border-default);
  font-size: 13px;
  color: var(--color-text-tertiary);
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: auto;
}

.sig-sidebar-footer span {
  display: flex;
  justify-content: space-between;
}

.sig-sidebar-footer-val {
  color: var(--color-text-secondary);
}

.sig-sidebar-footer-val--accent {
  color: var(--color-accent-text);
}
```

- [ ] **Step 5: Verify sidebar renders**

```bash
npm run dev
```

Check Compose tab sidebar — groups should show checkboxes with checkmarks, two-line layout, and stats footer.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tabs/assembler/AssemblerSidebar.tsx src/renderer/src/tabs/assembler/assembler.css
git commit -m "feat: redesign AssemblerSidebar with checkboxes and stats footer"
```

---

### Task 9: Add StatusBar to Compose Tab

**Files:**
- Modify: `src/renderer/src/tabs/AssemblerTab.tsx`

- [ ] **Step 1: Import and add StatusBar**

In `AssemblerTab.tsx`, import the component:

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

Add the StatusBar at the bottom of the tab's layout (after the `CompositionList`, as the last child of the main content area):

```tsx
<StatusBar
  left={<StatusBarLive />}
  right={<span>{compositionLog.length} of {totalContacts} selected</span>}
/>
```

Where `totalContacts` is derived from available contacts and `compositionLog.length` is the current selection count (these values should already be available in the component's scope).

- [ ] **Step 2: Verify status bar appears**

```bash
npm run dev
```

Expected: Compose tab shows a status bar at the bottom with green pulse dot, "Connected", and selection count on the right.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/tabs/AssemblerTab.tsx
git commit -m "feat: add StatusBar to Compose tab"
```

---

### Task 10: Add StatusBar to Directory Tab

**Files:**
- Modify: `src/renderer/src/tabs/DirectoryTab.tsx`

- [ ] **Step 1: Import and add StatusBar**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

Add at the bottom of the DirectoryTab layout:

```tsx
<StatusBar
  left={<StatusBarLive />}
  center={<span>Showing {filteredContacts.length} of {contacts.length}</span>}
  right={activeFilterCount > 0 ? <span>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span> : undefined}
/>
```

Adapt variable names to match what's available in the component scope — `filteredContacts`, `contacts`, and a count of active filters.

- [ ] **Step 2: Verify**

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/tabs/DirectoryTab.tsx
git commit -m "feat: add StatusBar to Directory tab"
```

---

### Task 11: Add StatusBar to Personnel Tab

**Files:**
- Modify: `src/renderer/src/tabs/PersonnelTab.tsx`

- [ ] **Step 1: Import and add StatusBar**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

Add at the bottom of PersonnelTab layout:

```tsx
<StatusBar
  left={<StatusBarLive label="Synced" />}
  center={<span>Last updated {lastUpdatedLabel}</span>}
  right={<span>{teamCount} teams · {onCallCount} on-call</span>}
/>
```

Derive `teamCount` and `onCallCount` from existing data. `lastUpdatedLabel` can be a simple "just now" or similar based on what data is available.

- [ ] **Step 2: Verify**

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/tabs/PersonnelTab.tsx
git commit -m "feat: add StatusBar to Personnel tab"
```

---

### Task 12: Add StatusBar to Status Tab

**Files:**
- Modify: `src/renderer/src/tabs/CloudStatusTab.tsx`

- [ ] **Step 1: Import and add StatusBar**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

Add at the bottom of CloudStatusTab layout:

```tsx
<StatusBar
  left={<StatusBarLive label="Auto-refreshing" />}
  center={<span>Last updated {lastRefreshLabel}</span>}
  right={<span>{providerCount} providers monitored</span>}
/>
```

- [ ] **Step 2: Verify**

```bash
npm run dev
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/tabs/CloudStatusTab.tsx
git commit -m "feat: add StatusBar to Status tab"
```

---

### Task 13: Add StatusBar to Remaining Tabs

**Files:**
- Modify: `src/renderer/src/tabs/ServersTab.tsx`
- Modify: `src/renderer/src/tabs/NotesTab.tsx`
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`

- [ ] **Step 1: Add StatusBar to ServersTab**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

```tsx
<StatusBar
  left={<StatusBarLive />}
  center={<span>Showing {filteredCount} of {totalCount}</span>}
  right={activeFilterCount > 0 ? <span>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span> : undefined}
/>
```

- [ ] **Step 2: Add StatusBar to NotesTab**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

```tsx
<StatusBar
  left={<StatusBarLive />}
  right={<span>{noteCount} notes</span>}
/>
```

- [ ] **Step 3: Add StatusBar to AlertsTab**

```tsx
import { StatusBar, StatusBarLive } from '../components/StatusBar';
```

```tsx
<StatusBar
  left={<StatusBarLive />}
  right={<span>Alert Composer</span>}
/>
```

- [ ] **Step 4: Verify all tabs have status bars**

```bash
npm run dev
```

Navigate through each tab and confirm a status bar appears at the bottom.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/ServersTab.tsx src/renderer/src/tabs/NotesTab.tsx src/renderer/src/tabs/AlertsTab.tsx
git commit -m "feat: add StatusBar to Servers, Notes, and Alerts tabs"
```

---

### Task 14: Update Focus Styles

**Files:**
- Modify: `src/renderer/src/styles/components.css`

- [ ] **Step 1: Update focus-visible outline color**

In `src/renderer/src/styles/components.css`, find the global `:focus-visible` rule and update the amber outline to signal red:

Search for any `outline` property that references amber/`#f59e0b` and replace with `var(--color-accent)`.

```css
:focus-visible {
  outline: 3px solid var(--color-accent);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/styles/components.css
git commit -m "fix: update focus-visible outline to signal red accent"
```

---

### Task 15: Visual QA and Cleanup

**Files:**
- Potentially any CSS file that needs minor fixes

- [ ] **Step 1: Boot the app and walk through every tab**

```bash
npm run dev
```

Walk through each tab and check:
1. **Compose** — Two-line entries, red checkboxes, status bar, no dot patterns
2. **Alerts** — Alert card/form styling unchanged, toolbar/chrome updated, status bar present
3. **Personnel** — Team cards clean, no amber, status bar
4. **Notes** — Note cards clean, no dot patterns
5. **Status** — Provider cards clean, severity badges correct colors
6. **Directory** — Two-line entries, detail panel, search/filters, status bar
7. **Servers** — Two-line entries, detail panel, status bar
8. **Radar** — Toolbar updated
9. **Weather** — Avenir Next font preserved, toolbar updated
10. **Sidebar** — Navigation items use signal red for active state

- [ ] **Step 2: Fix any remaining amber references**

```bash
grep -rn "#f59e0b\|#fbbf24\|#fcd34d" src/renderer/src/ --include="*.css" --include="*.tsx" --include="*.ts" | grep -v "alerts\|node_modules"
```

Fix any remaining references found.

- [ ] **Step 3: Fix any remaining dot pattern references**

```bash
grep -rn "chrome-pattern\|surface-pattern" src/renderer/src/ --include="*.css"
```

Fix any remaining references found.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Fix any test failures caused by class name changes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: visual QA cleanup — remaining amber refs and pattern artifacts"
```

---

### Task 16: Run Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run production build**

```bash
cd /Users/ryan/Apps/Relay
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: No new lint errors introduced.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Final visual check**

```bash
npm run dev
```

Do one final walkthrough of all tabs. Confirm:
- Instrument Sans renders everywhere (except weather tab and alert card internals)
- Signal red accent is consistent
- No amber remnants
- Status bars on all tabs
- Two-line contact entries in Compose, Directory, Servers
- No dot patterns on any surface
- Buttons are appropriately sized for TV readability
