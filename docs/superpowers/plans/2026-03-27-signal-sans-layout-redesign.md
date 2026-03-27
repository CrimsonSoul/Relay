# Signal Sans Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure component layouts across all tabs to match the Signal Sans design mockups — the token/color/font pass is done, but the actual spatial composition, typography hierarchy, and component structure still look like the old design with new paint.

**Architecture:** CSS-only changes where possible, minimal TSX restructuring. Each task targets one component or area. Alert card/form internals (AlertCard, AlertForm) are **explicitly excluded** — only the Alerts tab chrome (toolbar, status bar) can change.

**Tech Stack:** CSS (theme tokens already in place), React TSX (minimal changes), Electron/Vite

**Constraint:** AlertCard and AlertForm visual design MUST NOT be changed — they require approval. Only Alerts tab toolbar/chrome/layout shell can receive Signal Sans treatment.

**Reference mockups:** `.superpowers/design-mockups/signal-hybrid.html`, `signal-sans-tabs.html`, `signal-sans-modals-tabbar.html`

---

## File Map

| Area | Files to Modify | Responsibility |
|------|----------------|----------------|
| Left nav sidebar | `components/sidebar/sidebar.css` | Nav button sizing, active states, spacing |
| Compose toolbar | `tabs/AssemblerTab.tsx`, `styles/components.css` | Button labels, badge, toolbar layout |
| Compose sidebar | `tabs/assembler/assembler.css` | Group item polish, sidebar header, footer |
| Modals | `styles/modals.css` | Modal chrome, form fields, backdrop |
| Toolbar shared | `styles/components.css` (ListToolbar section) | Toolbar title, badge, button alignment |
| CollapsibleHeader | `components/CollapsibleHeader.tsx`, `styles/components.css` | Header layout with title + badge |
| Personnel cards | `components/oncall/oncall.css` | Team card structure, person row grid |
| Cloud Status | `tabs/cloud-status.css` | Provider cards, event feed items |
| Directory | `components/directory/directory.css` | Detail panel width, contact row polish |
| Notes | `tabs/notes/notes.css` | Card styling polish |
| Cleanup | `main.tsx` | Remove dead Space Grotesk import |

---

### Task 1: Clean Up Dead Imports and Hardcoded Fonts

**Files:**
- Modify: `src/renderer/src/main.tsx:3`
- Modify: `src/renderer/src/tabs/alerts.css` (lines 484, 506, 516, 589, 656, 699, 1025)

- [ ] **Step 1: Remove Space Grotesk import from main.tsx**

In `src/renderer/src/main.tsx`, delete line 3:
```tsx
import '@fontsource-variable/space-grotesk';
```

- [ ] **Step 2: Replace hardcoded font-family references in alerts.css**

In `src/renderer/src/tabs/alerts.css`, replace all instances of:
- `font-family: 'IBM Plex Sans', sans-serif;` → `font-family: var(--font-family-base);`
- `font-family: 'Montserrat', sans-serif;` → `font-family: var(--font-family-base);`
- `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-family-mono);`

**Important:** Only change font-family declarations. Do NOT modify any AlertCard or AlertForm component structure, layout, colors, or sizing.

- [ ] **Step 3: Verify build compiles**

Run: `cd ~/Apps/Relay && npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/main.tsx src/renderer/src/tabs/alerts.css
git commit -m "chore: remove dead Space Grotesk import, replace hardcoded fonts with tokens"
```

---

### Task 2: Left Navigation Sidebar Redesign

**Files:**
- Modify: `src/renderer/src/components/sidebar/sidebar.css`

The mockup (`signal-sans-modals-tabbar.html`) shows a cleaner sidebar with:
- Tighter nav items with `8px` horizontal margin and `8px` border-radius
- Active state uses `signal-dim` background + `signal-text` color (no gradient pseudo-elements)
- Icon size 20px with 1.8 stroke-width
- Label 11px 600 weight
- Settings in footer as a 36px circle button
- Brand icon area with border-bottom separator

- [ ] **Step 1: Update sidebar button base styles**

In `src/renderer/src/components/sidebar/sidebar.css`, replace the `.sidebar-button` block (lines 226-243):

```css
.sidebar-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: calc(100% - 16px);
  margin: 0 8px;
  padding: 10px 8px;
  gap: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  color: var(--color-text-tertiary);
  transition: all 0.15s;
  border-radius: 8px;
  outline: none;
  box-shadow: none;
}
```

- [ ] **Step 2: Update sidebar button hover — remove gradient pseudo-element**

Replace the hover block (lines 246-261):

```css
.sidebar-button:hover {
  background: var(--color-bg-card-hover);
  color: var(--color-text-secondary);
}
```

Remove the `.sidebar-button:hover::before` rule entirely.

- [ ] **Step 3: Update sidebar button active state — use signal-dim fill**

Replace the active block (lines 263-279):

```css
.sidebar-button--active {
  background: var(--color-accent-dim);
  color: var(--color-accent-text);
}
```

Remove the `.sidebar-button--active::before` rule entirely.

- [ ] **Step 4: Update icon and label sizing**

Replace `.sidebar-button-icon` (lines 281-293):

```css
.sidebar-button-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  transition: color 0.15s;
}

.sidebar-button-icon svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.8;
}
```

Replace `.sidebar-button-label` (lines 303-316):

```css
.sidebar-button-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
  transition: color 0.15s;
  line-height: 1;
}
```

- [ ] **Step 5: Simplify hover/active label and icon overrides**

Replace the remaining hover/active overrides for icon and label:

```css
.sidebar-button:hover .sidebar-button-icon {
  color: var(--color-text-secondary);
}

.sidebar-button--active .sidebar-button-icon {
  color: var(--color-accent-text);
}

.sidebar-button:hover .sidebar-button-label {
  color: var(--color-text-secondary);
}

.sidebar-button--active .sidebar-button-label {
  color: var(--color-accent-text);
}
```

- [ ] **Step 6: Update indicator bar**

Replace `.sidebar-button-indicator` (lines 327-335):

```css
.sidebar-button-indicator {
  position: absolute;
  left: -8px;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--color-accent);
  border-radius: 2px;
}
```

- [ ] **Step 7: Update sidebar container spacing**

Replace `.sidebar` (lines 184-196):

```css
.sidebar {
  width: var(--sidebar-width-collapsed);
  background-color: var(--color-bg-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  gap: 2px;
  z-index: 9002;
  -webkit-app-region: drag;
  overflow: hidden;
}
```

Update `.sidebar-nav` (lines 206-213):

```css
.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  -webkit-app-region: no-drag;
}
```

Update `.sidebar-footer` (lines 215-220):

```css
.sidebar-footer {
  -webkit-app-region: no-drag;
  padding: 12px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: center;
}
```

- [ ] **Step 8: Update app icon / brand area**

Replace `.sidebar-app-icon` (lines 2-19):

```css
.sidebar-app-icon {
  width: 100%;
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  -webkit-app-region: no-drag;
  transition: background 0.15s;
  color: var(--color-accent);
  cursor: pointer;
  position: relative;
  border-radius: 0;
}

.sidebar-app-icon:hover {
  background: var(--color-bg-card-hover);
}
```

Remove the `.sidebar-app-icon:hover::before` pseudo-element rule entirely.

- [ ] **Step 9: Verify the app renders**

Run: `cd ~/Apps/Relay && npm run dev`
Visually confirm the sidebar matches the mockup: clean items, no gradient wash, signal-dim active state.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/sidebar/sidebar.css
git commit -m "feat: redesign left nav sidebar to match Signal Sans mockup"
```

---

### Task 3: Compose Tab Toolbar Restructure

**Files:**
- Modify: `src/renderer/src/tabs/AssemblerTab.tsx:178-317`
- Modify: `src/renderer/src/styles/components.css` (CollapsibleHeader / match-count area)

The mockup shows a toolbar with:
- Left: Title "Recipients" (18px bold) + count badge in signal-dim pill
- Center: Separator + sort controls
- Right: Ghost buttons with full-word labels (not ALL-CAPS) + primary "Draft Bridge" button
- Button labels: "Reset", "History", "Copy All" (sentence case, not "RESET", "HISTORY", "COPY")

- [ ] **Step 1: Update button labels from ALL-CAPS to sentence case in AssemblerTab.tsx**

In `src/renderer/src/tabs/AssemblerTab.tsx`, change these button children:

- Line ~203: `UNDO` → `Undo`
- Line ~226: `RESET` → `Reset`
- Line ~251: `HISTORY` → `History`
- Line ~272: `COPY` → `Copy All`
- Line ~316: `DRAFT BRIDGE` → `Draft Bridge`

- [ ] **Step 2: Add a toolbar title and recipient badge before the action buttons**

In `src/renderer/src/tabs/AssemblerTab.tsx`, inside `<CollapsibleHeader>`, replace the existing match-count div (lines 179-181):

```tsx
<CollapsibleHeader isCollapsed={asm.isHeaderCollapsed}>
  <div className="toolbar-title-group">
    <span className="toolbar-title">Recipients</span>
    {asm.allRecipients.length > 0 && (
      <span className="toolbar-badge">{asm.allRecipients.length}</span>
    )}
  </div>
  <div className="toolbar-sep" />
  {manualRemoves.length > 0 && (
```

(Rest of the buttons remain as-is, just with updated labels from Step 1.)

- [ ] **Step 3: Add toolbar title/badge/separator CSS**

In `src/renderer/src/styles/components.css`, add after the existing `.match-count` rules:

```css
/* Toolbar title group */
.toolbar-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.toolbar-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.3px;
}

.toolbar-badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 14px;
  border-radius: 8px;
  background: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  flex-shrink: 0;
}
```

- [ ] **Step 4: Update the primary button color for dark text on red**

In `src/renderer/src/styles/components.css`, update `.tactile-button--primary` (line 40):

Change `color: #000000 !important;` → `color: #ffffff !important;`

The mockup shows white text on signal red, not black.

- [ ] **Step 5: Verify the compose toolbar looks correct**

Run the app: `cd ~/Apps/Relay && npm run dev`
Navigate to Compose tab. Confirm: "Recipients" title + count badge, sentence-case buttons, white text on red primary button.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tabs/AssemblerTab.tsx src/renderer/src/styles/components.css
git commit -m "feat: restructure Compose toolbar with title, badge, and sentence-case buttons"
```

---

### Task 4: Modal System Redesign

**Files:**
- Modify: `src/renderer/src/styles/modals.css`

The mockup (`signal-sans-modals-tabbar.html`) shows:
- Overlay: `rgba(7, 8, 16, 0.85)` with `blur(16px)` (darker, more immersive)
- Modal: `14px` border-radius, `0 24px 80px rgba(0,0,0,0.5)` shadow
- Header: 18px 700 title, 32px close button (8px radius)
- Body: 24px padding
- Footer: border-top, flex-end, 8px gap
- Form inputs: `--bg` background, 8px radius, 16px font, signal focus border
- Form labels: 13px 700 uppercase, 1.5px letter-spacing

- [ ] **Step 1: Update modal overlay**

In `src/renderer/src/styles/modals.css`, replace `.modal-overlay` (lines 2-13):

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(7, 8, 16, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-critical);
  animation: fadeIn 0.2s ease-out;
}
```

- [ ] **Step 2: Update modal container**

Replace `.modal-container` (lines 24-36):

```css
.modal-container {
  width: 100%;
  max-width: 520px;
  background-color: var(--color-bg-surface);
  border-radius: 14px;
  border: 1px solid var(--color-border);
  padding: 0;
  margin: 0;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 3: Update modal header**

Replace `.modal-header` (lines 39-48):

```css
.modal-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: transparent;
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
}
```

- [ ] **Step 4: Verify modals render correctly**

Run the app, open a modal (e.g., create group from Compose sidebar). Confirm darker overlay, updated border-radius, cleaner header.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles/modals.css
git commit -m "feat: update modal chrome to match Signal Sans mockup"
```

---

### Task 5: Compose Sidebar Polish

**Files:**
- Modify: `src/renderer/src/tabs/assembler/assembler.css`

The current sidebar structure is correct (checkboxes, two-line groups, footer). But comparing to mockup, the spacing and container need adjustment:
- Sidebar header: letter-spacing 2.5px (currently 0.04em ≈ 0.56px)
- Active count badge in header
- Group items: full-bleed border-bottom (no gap between items)
- Footer: padding 16px 20px with border-top

- [ ] **Step 1: Update sidebar header title**

In `src/renderer/src/tabs/assembler/assembler.css`, replace `.assembler-sidebar-groups-title` (lines 92-98):

```css
.assembler-sidebar-groups-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-tertiary);
  letter-spacing: 2.5px;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Update sidebar panel to remove padding (let items bleed full-width)**

Replace `.assembler-sidebar-panel` (lines 61-73):

```css
.assembler-sidebar-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background-color: var(--color-bg-surface);
  animation: detailPanelFadeIn 0.2s ease-out;
}
```

- [ ] **Step 3: Update header to have internal padding**

Replace `.assembler-sidebar-groups-header` (lines 83-90):

```css
.assembler-sidebar-groups-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--color-border);
}
```

Remove `margin-bottom: 12px;` since we're using padding now.

- [ ] **Step 4: Update group items to use consistent padding**

Replace `.sig-grp` (lines 409-419):

```css
.sig-grp {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--color-border-subtle);
  margin: 0;
}
```

(Removed the `margin: 0 -20px` since panel no longer has padding.)

- [ ] **Step 5: Update group name to 15px per mockup**

Replace `.sig-grp-name` (lines 452-457):

```css
.sig-grp-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-secondary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 6: Update footer to match mockup padding**

Replace `.sig-sidebar-footer` (lines 471-480):

```css
.sig-sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
  font-size: 13px;
  color: var(--color-text-tertiary);
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}
```

- [ ] **Step 7: Update empty state padding**

Replace `.assembler-sidebar-empty` (lines 126-131):

```css
.assembler-sidebar-empty {
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  font-style: italic;
  padding: 20px;
}
```

- [ ] **Step 8: Verify sidebar renders**

Run the app, check the Compose tab sidebar. Groups should have consistent padding, cleaner header with wider letter-spacing, footer properly separated.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/tabs/assembler/assembler.css
git commit -m "feat: polish Compose sidebar layout to match Signal Sans mockup"
```

---

### Task 6: Personnel Tab — Team Card Layout

**Files:**
- Modify: `src/renderer/src/components/oncall/oncall.css`

The mockup shows team cards with:
- 12px border-radius, surface background, border
- Header: team name with 10px color-coded dot (3px border-radius square), flex space-between
- Person rows: grid with 36px avatar, name (16px 600), role (13px dim), shift time (13px mono, right-aligned)
- Cards in responsive grid: `minmax(340px, 1fr)`

- [ ] **Step 1: Read the current oncall.css to understand existing styles**

Read: `src/renderer/src/components/oncall/oncall.css`

- [ ] **Step 2: Update team card body**

Find `.team-card-body` and update to:

```css
.team-card-body {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.team-card-body:hover {
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 3: Update team card header**

Find the team card header (`.team-card-name` or header area) and update to:

```css
/* Team card header should have:
   padding: 16px 20px, border-bottom, flex space-between */
```

Adjust the header section to match: 17px 700 font, color-coded 10px dot with 3px border-radius.

- [ ] **Step 4: Update team member rows**

Update `.team-row` to use grid layout:

```css
.team-row {
  padding: 14px 20px;
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--color-border-subtle);
  transition: background 0.12s;
}

.team-row:last-child {
  border-bottom: none;
}

.team-row:hover {
  background: var(--color-bg-card-hover);
}
```

- [ ] **Step 5: Update grid min-width**

Find `.relay-grid--oncall` and update min column from 550px to 340px:

```css
.relay-grid--oncall {
  --grid-min-col: 340px;
}
```

- [ ] **Step 6: Verify the Personnel tab**

Run the app, navigate to On-Call. Confirm cards have 12px radius, cleaner person rows, responsive grid at 340px min.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/oncall/oncall.css
git commit -m "feat: update Personnel tab team cards to Signal Sans layout"
```

---

### Task 7: Cloud Status Tab — Provider Cards and Event Feed

**Files:**
- Modify: `src/renderer/src/tabs/cloud-status.css`

The mockup shows:
- Provider summary cards in `minmax(200px, 1fr)` grid with 12px radius, 18px/20px padding
- Event feed items: 10px radius, grid with severity badge + body + timestamp
- Filter pills: consistent with other tab filters

- [ ] **Step 1: Read current cloud-status.css**

Read: `src/renderer/src/tabs/cloud-status.css`

- [ ] **Step 2: Update provider card styling**

Find `.cloud-status-provider` and update:

```css
.cloud-status-provider {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s;
  cursor: pointer;
}

.cloud-status-provider:hover {
  border-color: rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 3: Update provider grid to 200px min**

Find `.cloud-status__summary` and update the grid to:

```css
.cloud-status__summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
```

- [ ] **Step 4: Update event feed items**

Find `.cloud-status-item` and update:

```css
.cloud-status-item {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px 20px;
  transition: background 0.12s;
}

.cloud-status-item:hover {
  background: var(--color-bg-card-hover);
}
```

- [ ] **Step 5: Verify the Status tab**

Run the app, navigate to Status. Confirm provider cards and event items match mockup.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tabs/cloud-status.css
git commit -m "feat: update Cloud Status tab to Signal Sans layout"
```

---

### Task 8: Directory Tab — Detail Panel and Contact Rows

**Files:**
- Modify: `src/renderer/src/components/directory/directory.css`

The mockup shows:
- Detail panel: 320px width (currently 280px), 28px/24px padding
- Detail avatar: 64px, 14px border-radius
- Detail name: 20px 700
- Detail fields with label (12px 700 uppercase 2px letter-spacing) + value (16px 500)
- Detail action buttons: full-width, 10px padding, 8px radius

- [ ] **Step 1: Read current directory.css for detail panel**

Read: `src/renderer/src/components/directory/directory.css` lines 1-100

- [ ] **Step 2: Update detail panel width**

Find `.detail-panel` and change `width: 280px` to `width: 320px`.

- [ ] **Step 3: Update detail panel sections**

Update detail panel internal styles to match mockup:
- Head section: centered, 24px bottom padding, border-bottom
- Avatar: 64px, 14px border-radius
- Name: 20px 700
- Field labels: 12px 700 uppercase, 2px letter-spacing
- Field values: 16px 500

- [ ] **Step 4: Verify the Directory tab**

Run the app, navigate to Directory (People tab), select a contact. Confirm wider detail panel with updated typography.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/directory/directory.css
git commit -m "feat: update Directory detail panel to Signal Sans layout"
```

---

### Task 9: Bridge History Modal Redesign

**Files:**
- Modify: `src/renderer/src/tabs/assembler/assembler.css` (bridge history section)

The mockup shows history items with:
- 10px border-radius, `--bg` background, border
- Date: 15px 700, count badge: signal-dim pill
- Group tags: 11px 700 uppercase, 4px border-radius
- Action buttons: 12px font, 6px padding, 6px radius
- "Load" button: signal-dim accent variant

- [ ] **Step 1: Update bridge history entry styling**

In `src/renderer/src/tabs/assembler/assembler.css`, replace `.bridge-history-entry` (lines 181-199):

```css
.bridge-history-entry {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 14px 18px;
  border-radius: 10px;
  margin-bottom: 8px;
  background: var(--color-bg-app);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: all 0.12s;
}

.bridge-history-entry:hover {
  background: var(--color-bg-card-hover);
  border-color: rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 2: Update history entry date styling**

Replace `.bridge-history-entry-date` (lines 210-215):

```css
.bridge-history-entry-date {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}
```

- [ ] **Step 3: Update history entry count badge**

Replace `.bridge-history-entry-count` (lines 217-226):

```css
.bridge-history-entry-count {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-accent-text);
  background: var(--color-accent-dim);
  padding: 2px 10px;
  border-radius: 6px;
}
```

- [ ] **Step 4: Update history group tags — remove old amber colors**

Replace `.bridge-history-entry-group-tag` (lines 241-248):

```css
.bridge-history-entry-group-tag {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 5: Verify history modal**

Run the app, open the History modal from Compose. Confirm updated card styling with signal-red count badges and neutral group tags.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/tabs/assembler/assembler.css
git commit -m "feat: update Bridge History modal to Signal Sans styling"
```

---

### Task 10: CollapsibleHeader Layout Consistency

**Files:**
- Modify: `src/renderer/src/styles/components.css` (CollapsibleHeader section)

The CollapsibleHeader wraps the toolbar across multiple tabs. It needs to enforce consistent alignment: items centered, proper gap, flex-wrap for small screens.

- [ ] **Step 1: Read the CollapsibleHeader CSS**

Read: `src/renderer/src/styles/components.css` and search for `.collapsible-header`

- [ ] **Step 2: Update CollapsibleHeader styles**

Ensure the header has:

```css
.collapsible-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}
```

- [ ] **Step 3: Verify across tabs**

Run the app, check the toolbar area on Compose, Directory, Servers, Notes. Confirm consistent alignment and spacing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/styles/components.css
git commit -m "feat: standardize CollapsibleHeader layout across tabs"
```

---

### Task 11: Notes Tab Card Polish

**Files:**
- Modify: `src/renderer/src/tabs/notes/notes.css`

The spec says: apply new card styling (remove dot pattern, use new border/radius), tag pills use new color system.

- [ ] **Step 1: Read notes.css for card styles**

Read: `src/renderer/src/tabs/notes/notes.css` focusing on `.note-card` rules

- [ ] **Step 2: Update note card base**

Update `.note-card` to use:
- `border-radius: 12px`
- `border: 1px solid var(--color-border)`
- `background: var(--color-bg-surface)`
- Remove any dot pattern backgrounds

- [ ] **Step 3: Verify the Notes tab**

Run the app, navigate to Notes. Confirm cards have clean surface, 12px radius, no dot patterns.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/tabs/notes/notes.css
git commit -m "feat: polish Notes tab cards to Signal Sans styling"
```

---

### Task 12: Final Visual QA Pass

**Files:**
- Potentially any CSS file from above

- [ ] **Step 1: Launch the app**

Run: `cd ~/Apps/Relay && npm run dev`

- [ ] **Step 2: Walk through each tab visually**

Check each tab for:
- Consistent border-radius (8px buttons, 12px cards, 14px modals)
- No remaining amber/old-style artifacts
- Signal red accent used consistently
- Font rendering as Instrument Sans (not fallback)
- Sentence-case button labels throughout
- Status bars present and properly styled

- [ ] **Step 3: Fix any remaining issues found**

Address specific issues discovered during walkthrough.

- [ ] **Step 4: Run build to ensure no regressions**

Run: `cd ~/Apps/Relay && npx electron-vite build 2>&1 | tail -10`
Expected: Clean build

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix: visual QA cleanup for Signal Sans layout redesign"
```
