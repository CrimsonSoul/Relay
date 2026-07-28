# Dispatcher Radar Page and Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the desktop-only Radar destination with a fixed-footprint, dot-only sidebar status and a left health rail beside responsive dispatcher lanes.

**Architecture:** Keep the current `RadarSnapshot`, Electron polling/session flow, and `useRadarSnapshot()` hook unchanged. Derive compact navigation text in the sidebar, let the generic sidebar button render one semantic dot without health tinting its surface, and reorganize the existing Radar renderer into a semantic health rail plus dispatcher-lane workspace. Use CSS container queries for content-width adaptation and deterministic Electron layout contracts for the wide and compact shells.

**Tech Stack:** TypeScript 6, React 19, CSS, Vitest 4, Testing Library, Playwright Electron

## Global Constraints

- Radar remains desktop-only because it depends on the Electron session and corporate SSO cookie.
- Preserve the existing `RadarSnapshot`, parser, polling, SSO, preload, IPC, client/server, PocketBase, and Relay Web behavior.
- Retain the standard Relay accent rail exclusively for active-tab state.
- Show exactly one Radar health dot; do not add a health-colored background wash or health-colored full rail.
- Keep the standard navigation footprints: `120px × 56px` in the full shell and `56px × 48px` in the compact shell.
- Show both XCenter counts in both shell modes.
- Format visible navigation values below 1,000 exactly and values at or above 1,000 with at most one decimal, omitting unnecessary decimals.
- Use `2k · 1.8k` in the full shell and `2k·1.8k` in the compact shell; use `—` for a missing count.
- Preserve exact XCenter counts and the status word in the tooltip and accessible name.
- Keep the health rail left of dispatcher lanes at normal desktop widths and stack it above lanes only when the Radar content width is too narrow.
- Do not infer warning or critical colors from raw queue depths; only source-provided tones are semantic.
- Preserve the last good snapshot during refresh, sign-in recovery, and fetch/parse failures, while labeling retained failure-state data as stale.
- Add no sorting, filtering, queue expansion, charts, trends, thresholds, dependencies, or decorative animation.
- Use genuine red-green TDD for every behavior slice.

---

## File Map

- `src/renderer/src/components/Sidebar.tsx` — format compact XCenter values while retaining exact spoken values.
- `src/renderer/src/components/__tests__/Sidebar.test.tsx` — cover all compact-number boundaries and the exact accessible announcement payload.
- `src/renderer/src/components/sidebar/SidebarButton.tsx` — render one status dot and distinct full/compact detail strings without changing generic button behavior.
- `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx` — guard status markup, accessibility, fixed geometry, and the absence of health wash/rail styling.
- `src/renderer/src/components/sidebar/sidebar.css` — lay out the full Radar item within the standard `120px × 56px` footprint and style dot tones.
- `src/renderer/src/styles/responsive.css` — fit the icon, dot, and compact detail into the standard `56px × 48px` shell item.
- `src/renderer/src/tabs/RadarTab.tsx` — render stale-aware header state, the semantic health rail, dispatcher lanes, and stable empty states.
- `src/renderer/src/tabs/__tests__/RadarTab.test.tsx` — verify DOM order, retained snapshots, refresh state, empty states, semantic tones, and long queue-name access.
- `src/renderer/src/tabs/radar.css` — implement the left-rail Dispatcher Lanes direction and content-width fallback.
- `src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts` — guard the structural CSS contract for the rail, lanes, truncation, and narrow fallback.
- `tests/e2e/css-visual-contracts.spec.ts` — measure full/compact sidebar footprints and Radar overflow/rail placement in Electron.

---

### Task 1: Produce Exact and Compact Radar Navigation Text

**Files:**

- Modify: `src/renderer/src/components/Sidebar.tsx:1-73`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx:7-24`
- Modify: `src/renderer/src/components/__tests__/Sidebar.test.tsx:126-166`

**Interfaces:**

- Consumes: `RadarSnapshot.color` and `RadarSnapshot.xcenter.{ok,pending}`.
- Produces: `formatRadarNavigationCount(value: number | null): string`.
- Produces: `SidebarButtonStatus.compactDetail?: string` in addition to the existing `tone`, `announcement`, and `detail`.
- Preserves: exact comma-grouped counts in `announcement`.

- [ ] **Step 1: Write the compact-count unit regression**

Import the formatter from `Sidebar.tsx` and add this table beside the existing Sidebar tests:

```ts
it.each([
  [null, '—'],
  [0, '0'],
  [999, '999'],
  [1000, '1k'],
  [1807, '1.8k'],
  [2000, '2k'],
  [9999, '10k'],
] as const)('formats Radar navigation count %s as %s', (value, expected) => {
  expect(formatRadarNavigationCount(value)).toBe(expected);
});
```

Update the mocked status prop to include:

```ts
status?: {
  tone: string;
  announcement: string;
  detail?: string;
  compactDetail?: string;
} | null;
```

Expose the compact detail on the mock button:

```tsx
data-status-compact-detail={status?.compactDetail}
```

- [ ] **Step 2: Change the existing live-status regression to demand compact visible values**

Replace the current assertions for the default `2,000` and `1,807` snapshot with:

```ts
expect(radar).toHaveAttribute(
  'data-status-announcement',
  'Healthy. XCenter OK 2,000, Pending 1,807',
);
expect(radar).toHaveAttribute('data-status-detail', '2k · 1.8k');
expect(radar).toHaveAttribute('data-status-compact-detail', '2k·1.8k');
```

Keep the existing `unknown` announcement regression and add:

```ts
expect(screen.getByTestId('sidebar-btn-radar')).toHaveAttribute(
  'data-status-detail',
  '— · —',
);
expect(screen.getByTestId('sidebar-btn-radar')).toHaveAttribute(
  'data-status-compact-detail',
  '—·—',
);
```

- [ ] **Step 3: Run the Sidebar tests and verify red**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/Sidebar.test.tsx
```

Expected: FAIL because the formatter and `compactDetail` do not exist and `detail` still uses exact comma-grouped values.

- [ ] **Step 4: Add the compact formatter and status payload**

Add this exported helper above `navItems` in `Sidebar.tsx`:

```ts
export function formatRadarNavigationCount(value: number | null): string {
  if (value === null) return '—';
  if (value < 1000) return value.toLocaleString('en-US');

  const compactValue = Math.round(value / 100) / 10;
  return `${compactValue.toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
}
```

Replace the current `radarStatus` construction with:

```ts
const okCompact = formatRadarNavigationCount(radar.xcenter.ok);
const pendingCompact = formatRadarNavigationCount(radar.xcenter.pending);
const radarStatus: SidebarButtonStatus = {
  tone: radar.color,
  announcement:
    radar.xcenter.ok === null && radar.xcenter.pending === null
      ? RADAR_STATUS_LABELS[radar.color]
      : `${RADAR_STATUS_LABELS[radar.color]}. XCenter OK ${radar.xcenter.ok?.toLocaleString('en-US') ?? 'unknown'}, Pending ${radar.xcenter.pending?.toLocaleString('en-US') ?? 'unknown'}`,
  detail: `${okCompact} · ${pendingCompact}`,
  compactDetail: `${okCompact}·${pendingCompact}`,
};
```

Add `compactDetail?: string` to `SidebarButtonStatus` in `SidebarButton.tsx`. Do not change its rendering until Task 2.

- [ ] **Step 5: Run the focused tests and verify green**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/Sidebar.test.tsx
```

Expected: PASS for the seven formatting boundaries, exact spoken counts, compact full-shell detail, compact collapsed-shell detail, unknown state, desktop-only Radar entry, and status-free non-Radar entries.

- [ ] **Step 6: Commit the count-formatting slice**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/sidebar/SidebarButton.tsx src/renderer/src/components/__tests__/Sidebar.test.tsx
git commit -m "feat: compact Radar sidebar counts"
```

---

### Task 2: Render a Dot-Only Fixed-Footprint Radar Navigation Item

**Files:**

- Modify: `src/renderer/src/components/sidebar/SidebarButton.tsx:27-50`
- Modify: `src/renderer/src/components/sidebar/sidebar.css:202-287`
- Modify: `src/renderer/src/components/sidebar/sidebar.css:400-457`
- Modify: `src/renderer/src/styles/responsive.css:40-57`
- Modify: `src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx:121-223`

**Interfaces:**

- Consumes: `SidebarButtonStatus.tone`, `announcement`, `detail`, and `compactDetail`.
- Produces: one `.sidebar-button-status-dot[data-status-tone]`.
- Produces: `.sidebar-button-detail--full` and `.sidebar-button-detail--compact` display variants.
- Preserves: `aria-label`, tooltip text, `aria-pressed`, and `.sidebar-button--active` accent rail.

- [ ] **Step 1: Replace the status-height regression with fixed-footprint assertions**

Replace the test that currently permits status buttons to grow with:

```ts
it('keeps status buttons inside the standard navigation footprint', () => {
  const buttonStyles = cssBlockFor('.sidebar-button');
  const statusStyles = cssBlockFor('.sidebar-button--status');

  expect(buttonStyles).toContain('width: var(--sidebar-button-width)');
  expect(buttonStyles).toContain('height: var(--sidebar-button-height)');
  expect(statusStyles).not.toContain('height: auto');
  expect(statusStyles).not.toContain('min-height:');
});
```

Add:

```ts
it('does not give status buttons a health wash or health rail', () => {
  expect(sidebarCss).not.toContain('--sidebar-status-wash');
  expect(sidebarCss).not.toContain('--sidebar-status-rail');
});

it('keeps the Relay accent rail as the active-state signal', () => {
  const activeStyles = cssBlockFor('.sidebar-button--active');
  expect(activeStyles).toContain('border-left-color: var(--accent)');
});
```

- [ ] **Step 2: Write the dot and dual-detail markup regressions**

Add these tests in `describe('SidebarButton status')`:

```tsx
it('renders one semantic dot and both responsive detail strings', () => {
  const { container } = render(
    <SidebarButton
      {...baseProps}
      status={{
        tone: 'yellow',
        announcement: 'Warning. XCenter OK 2,000, Pending 1,807',
        detail: '2k · 1.8k',
        compactDetail: '2k·1.8k',
      }}
    />,
  );

  const dots = container.querySelectorAll('.sidebar-button-status-dot');
  expect(dots).toHaveLength(1);
  expect(dots[0]).toHaveAttribute('data-status-tone', 'yellow');
  expect(dots[0]).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('2k · 1.8k')).toHaveClass('sidebar-button-detail--full');
  expect(screen.getByText('2k·1.8k')).toHaveClass('sidebar-button-detail--compact');
});

it('renders no semantic dot for an ordinary navigation button', () => {
  const { container } = render(<SidebarButton {...baseProps} status={null} />);
  expect(container.querySelector('.sidebar-button-status-dot')).toBeNull();
});
```

Keep the existing accessible-name, tooltip, pressed-state, missing-detail, and tone-data tests.

- [ ] **Step 3: Run the SidebarButton tests and verify red**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
```

Expected: FAIL because the button has no dot or compact detail variant and its status CSS still grows and health-tints the button.

- [ ] **Step 4: Render the semantic dot and both visual detail variants**

Replace the button contents in `SidebarButton.tsx` with:

```tsx
<div className="sidebar-button-icon">{icon}</div>
<span className="sidebar-button-label">{label}</span>
{status && (
  <span
    className="sidebar-button-status-dot"
    data-status-tone={status.tone}
    aria-hidden="true"
  />
)}
{status?.detail && (
  <span className="sidebar-button-detail" aria-hidden="true">
    <span className="sidebar-button-detail--full">{status.detail}</span>
    <span className="sidebar-button-detail--compact">
      {status.compactDetail ?? status.detail}
    </span>
  </span>
)}
{isActive && <div className="sidebar-button-indicator" />}
```

Keep the existing button-level `data-status-tone`, exact `aria-label`, tooltip, active class, and click behavior.

- [ ] **Step 5: Replace the health wash/rail rules with fixed-grid dot styling**

Replace the status-reporting section of `sidebar.css` with:

```css
.sidebar-button--status {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  grid-template-rows: auto auto;
  grid-template-areas:
    'icon label'
    'icon detail';
  align-content: center;
  column-gap: 8px;
  row-gap: 2px;
}

.sidebar-button--status .sidebar-button-icon {
  grid-area: icon;
  align-self: center;
}

.sidebar-button--status .sidebar-button-label {
  grid-area: label;
  min-width: 0;
  padding-right: 12px;
}

.sidebar-button-status-dot {
  position: absolute;
  top: 11px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-quaternary);
  pointer-events: none;
}

.sidebar-button-status-dot[data-status-tone='green'] {
  background: var(--ok);
}

.sidebar-button-status-dot[data-status-tone='yellow'] {
  background: var(--color-warning);
}

.sidebar-button-status-dot[data-status-tone='red'] {
  background: var(--color-danger);
}

.sidebar-button-status-dot[data-status-tone='magenta'] {
  background: #b200ff;
}

.sidebar-button-detail {
  grid-area: detail;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-button-detail--compact {
  display: none;
}
```

Delete every `--sidebar-status-wash`, `--sidebar-status-rail`, status background, status border override, `height: auto`, and status `min-height` rule. Leave `.sidebar-button--active` unchanged so its Relay accent rail remains authoritative.

- [ ] **Step 6: Add the compact-shell placement rules**

Inside the existing `@media (max-width: 1200px)` block in `responsive.css`, add:

```css
.sidebar-button--status {
  grid-template-columns: 1fr;
  grid-template-rows: 20px auto;
  grid-template-areas:
    'icon'
    'detail';
  justify-items: center;
  align-content: center;
  gap: 2px;
  padding: 4px 0;
}

.sidebar-button--status .sidebar-button-icon {
  align-self: center;
}

.sidebar-button-status-dot {
  top: 6px;
  right: 7px;
  width: 6px;
  height: 6px;
}

.sidebar-button-detail {
  font-size: 9px;
  letter-spacing: -0.04em;
  line-height: 1;
}

.sidebar-button-detail--full {
  display: none;
}

.sidebar-button-detail--compact {
  display: inline;
}
```

- [ ] **Step 7: Run the focused sidebar tests**

Run:

```bash
npx vitest run src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx src/renderer/src/__tests__/responsiveShell.test.ts
```

Expected: PASS, including the standard full/compact shell dimensions, active state, exact accessible announcement, one dot, dual visible-detail forms, and no health wash/rail.

- [ ] **Step 8: Commit the navigation rendering slice**

```bash
git add src/renderer/src/components/sidebar/SidebarButton.tsx src/renderer/src/components/sidebar/sidebar.css src/renderer/src/styles/responsive.css src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx
git commit -m "feat: simplify Radar sidebar status"
```

---

### Task 3: Recompose Radar as a Stale-Aware Health Rail and Dispatcher Workspace

**Files:**

- Modify: `src/renderer/src/tabs/RadarTab.tsx:16-180`
- Modify: `src/renderer/src/tabs/__tests__/RadarTab.test.tsx:74-205`

**Interfaces:**

- Consumes: the unchanged `useRadarSnapshot()` result.
- Produces: `.radar-workspace` containing `.radar-health-rail` before `.radar-dispatcher-lanes` in DOM order.
- Produces: `Stale` with `data-radar-tone="unknown"` when `signInRequired` or `error` is present.
- Produces: stable XCenter, PaPA, Services, and Dashboard timing sections even when no usable snapshot exists.
- Preserves: refresh, sign-in, dispatcher tone, metric tone, exact depth formatting, and live pushed snapshots.

- [ ] **Step 1: Write DOM-order, stale-state, and stable-empty regressions**

Add these tests to `RadarTab.test.tsx`:

```tsx
it('places the health rail before dispatcher lanes in DOM order', async () => {
  const { container } = render(<RadarTab />);
  await screen.findByText('prod01');

  const workspace = container.querySelector('.radar-workspace');
  expect(workspace?.children[0]).toHaveClass('radar-health-rail');
  expect(workspace?.children[1]).toHaveClass('radar-dispatcher-lanes');
});

it('marks retained data stale without discarding the last good snapshot', async () => {
  getRadarSnapshot.mockResolvedValue(
    snapshotWith({
      color: 'green',
      error: 'ECONNREFUSED',
    }),
  );
  const { container } = render(<RadarTab />);

  expect(await screen.findByText('Stale')).toBeInTheDocument();
  expect(container.querySelector('.radar-overall')).toHaveAttribute(
    'data-radar-tone',
    'unknown',
  );
  expect(screen.getByText('prod01')).toBeInTheDocument();
  expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
  expect(screen.getByText(/ECONNREFUSED/)).toHaveTextContent('stale');
  expect(screen.getByText('Last successful update').nextElementSibling).toHaveAttribute(
    'dateTime',
    '2026-07-28T19:57:00.000Z',
  );
});

it('keeps retained data visible while offering sign-in recovery', async () => {
  getRadarSnapshot.mockResolvedValue(
    snapshotWith({
      color: 'green',
      signInRequired: true,
    }),
  );
  render(<RadarTab />);

  expect(await screen.findByText('Stale')).toBeInTheDocument();
  expect(screen.getByText('prod01')).toBeInTheDocument();
  expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();

  const signIn = screen.getByRole('button', { name: 'Sign in to CW Dashboard' });
  fireEvent.click(signIn);
  await waitFor(() => expect(openRadarSignIn).toHaveBeenCalledOnce());
});

it('keeps all health sections and one lane message before the first snapshot', async () => {
  getRadarSnapshot.mockResolvedValue(
    snapshotWith({
      color: 'unknown',
      dispatchers: [],
      papa: [],
      metrics: [],
      xcenter: { ok: null, pending: null },
      currentTime: null,
      lastUpdated: 0,
    }),
  );
  render(<RadarTab />);

  expect(await screen.findByRole('region', { name: 'XCenter counts' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'PaPA Processor Service' })).toHaveTextContent(
    'No PaPA data',
  );
  expect(screen.getByRole('region', { name: 'Service metrics' })).toHaveTextContent(
    'No service data',
  );
  expect(screen.getByRole('region', { name: 'Dashboard timing' })).toHaveTextContent(
    'Dashboard clock—',
  );
  expect(screen.getByText('Radar snapshot unavailable')).toBeInTheDocument();
});
```

Replace the existing sign-in test with the retained-data version above so the suite has one
authoritative sign-in recovery regression.

- [ ] **Step 2: Write the long-name and in-flight refresh regressions**

Add:

```tsx
it('keeps a complete long queue name available while allowing visual truncation', async () => {
  const queueName =
    'TRANSACTION.MEMBERSHIPS.RECONCILIATION.EXCEPTION.RETRY.DEAD.LETTER.QUEUE';
  getRadarSnapshot.mockResolvedValue(
    snapshotWith({
      dispatchers: [
        {
          name: 'prod01',
          tone: 'yellow',
          lastScheduleDate: 'x',
          lastPubSubDate: 'y',
          queues: [{ name: queueName, depth: 12534 }],
        },
      ],
    }),
  );
  render(<RadarTab />);

  expect(await screen.findByText(queueName)).toHaveAttribute('title', queueName);
  expect(screen.getByText('12,534')).not.toHaveAttribute('data-radar-tone');
});

it('pairs every service tone with an accessible status word', async () => {
  render(<RadarTab />);

  expect(await screen.findByRole('listitem', { name: 'Order API Counts — Healthy: 6,063' }))
    .toBeInTheDocument();
  expect(
    screen.getByRole('listitem', { name: 'EDW Daily Load Date Status — Warning' }),
  ).toBeInTheDocument();
});

it('keeps the snapshot visible and prevents repeated refresh while refreshing', async () => {
  let resolveRefresh: ((snapshot: RadarSnapshot) => void) | null = null;
  refreshRadar.mockReturnValue(
    new Promise<RadarSnapshot>((resolve) => {
      resolveRefresh = resolve;
    }),
  );
  render(<RadarTab />);
  await screen.findByText('prod01');

  fireEvent.click(screen.getByRole('button', { name: 'Refresh Radar now' }));

  const refreshing = screen.getByRole('button', { name: 'Refresh Radar now' });
  expect(refreshing).toBeDisabled();
  expect(refreshing).toHaveTextContent('REFRESHING');
  expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
  fireEvent.click(refreshing);
  expect(refreshRadar).toHaveBeenCalledOnce();

  resolveRefresh?.(snapshotWith());
  await waitFor(() => expect(refreshing).not.toBeDisabled());
});
```

- [ ] **Step 3: Run the Radar renderer tests and verify red**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/RadarTab.test.tsx
```

Expected: FAIL because the current page has no health rail/lane structure, stale label, stable empty sections, queue title, or last-successful-update element.

- [ ] **Step 4: Add stale and update-time presentation state**

Destructure `lastUpdated` with the existing snapshot fields and add:

```ts
const isStale = signInRequired || Boolean(error);
const hasUsableSnapshot = lastUpdated > 0;
const overallTone = isStale ? 'unknown' : color;
const overallLabel = isStale ? 'Stale' : RADAR_STATUS_LABELS[color];
const lastUpdatedDate = hasUsableSnapshot ? new Date(lastUpdated) : null;
```

Change the header indicator to:

```tsx
<span className="radar-overall" data-radar-tone={overallTone}>
  <span className="radar-overall-dot" aria-hidden="true" />
  {overallLabel}
</span>
```

Change the two notices to:

```tsx
{signInRequired && (
  <output className="radar-notice">
    <span>Your CW Dashboard session has expired. Retained Radar data is stale.</span>
    <TactileButton variant="primary" onClick={signIn} aria-label="Sign in to CW Dashboard">
      SIGN IN
    </TactileButton>
  </output>
)}

{error && !signInRequired && (
  <output className="radar-notice radar-notice--error">
    Could not reach Radar: {error}. Retained Radar data is stale.
  </output>
)}
```

- [ ] **Step 5: Make long queue names recoverable**

Change the first `DepthRows` body cell to:

```tsx
<td className="radar-table-name" title={row.name}>
  {row.name}
</td>
```

Leave the depth cell as plain exact text with no inferred tone:

```tsx
<td className="radar-table-number">{row.depth.toLocaleString('en-US')}</td>
```

- [ ] **Step 6: Replace the current lead/grid/footer body with the approved workspace**

Replace the current `.radar-lead`, `.radar-grid`, and trailing `.radar-updated` JSX with:

```tsx
<div className="radar-workspace">
  <aside className="radar-health-rail" aria-label="Radar health summary">
    <section className="radar-health-section" aria-label="XCenter counts">
      <h3 className="radar-section-title">XCenter</h3>
      <div className="radar-figures">
        <div className="radar-figure">
          <span className="radar-figure-label">OK</span>
          <span className="radar-figure-value">{formatCount(xcenter.ok)}</span>
        </div>
        <div className="radar-figure">
          <span className="radar-figure-label">Pending</span>
          <span className="radar-figure-value">{formatCount(xcenter.pending)}</span>
        </div>
      </div>
    </section>

    <section className="radar-health-section" aria-label="PaPA Processor Service">
      <h3 className="radar-section-title">PaPA Processor Service</h3>
      {papa.length > 0 ? (
        <DepthRows rows={papa} nameHeading="Message type" />
      ) : (
        <p className="radar-empty">No PaPA data</p>
      )}
    </section>

    <section className="radar-health-section" aria-label="Service metrics">
      <h3 className="radar-section-title">Services</h3>
      {metrics.length > 0 ? (
        <ul className="radar-metrics">
          {metrics.map((metric) => (
            <li
              key={metric.label}
              className="radar-metric"
              aria-label={`${metric.label} — ${RADAR_STATUS_LABELS[metric.tone]}${
                metric.value === null ? '' : `: ${formatMetricValue(metric.value)}`
              }`}
            >
              <span className="radar-metric-label">
                <span
                  className="radar-panel-dot"
                  data-radar-tone={metric.tone}
                  aria-hidden="true"
                />
                {metric.label}
              </span>
              <span className="radar-metric-value">
                {metric.value === null
                  ? RADAR_STATUS_LABELS[metric.tone]
                  : formatMetricValue(metric.value)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="radar-empty">No service data</p>
      )}
    </section>

    <section className="radar-health-section" aria-label="Dashboard timing">
      <h3 className="radar-section-title">Dashboard timing</h3>
      <dl className="radar-clock">
        <div>
          <dt>Dashboard clock</dt>
          <dd>{currentTime ?? '—'}</dd>
        </div>
        <div>
          <dt>Last successful update</dt>
          <dd>
            {lastUpdatedDate ? (
              <time dateTime={lastUpdatedDate.toISOString()}>
                {lastUpdatedDate.toLocaleString()}
              </time>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
    </section>
  </aside>

  <section className="radar-dispatcher-lanes" aria-labelledby="radar-dispatchers-title">
    <h3 id="radar-dispatchers-title" className="radar-section-title">
      Dispatchers
    </h3>
    <div className="radar-lane-grid">
      {dispatchers.length > 0 ? (
        dispatchers.map((dispatcher) => (
          <section
            key={dispatcher.name}
            className="radar-lane"
            aria-label={`Dispatcher ${dispatcher.name} — ${RADAR_STATUS_LABELS[dispatcher.tone]}`}
          >
            <h4 className="radar-lane-title">
              <span
                className="radar-panel-dot"
                data-radar-tone={dispatcher.tone}
                aria-hidden="true"
              />
              {dispatcher.name}
            </h4>
            <dl className="radar-pairs">
              <div>
                <dt>Last schedule</dt>
                <dd>{dispatcher.lastScheduleDate || '—'}</dd>
              </div>
              <div>
                <dt>Last pub/sub</dt>
                <dd>{dispatcher.lastPubSubDate || '—'}</dd>
              </div>
            </dl>
            {dispatcher.queues.length > 0 ? (
              <DepthRows rows={dispatcher.queues} nameHeading="Queue" />
            ) : (
              <p className="radar-empty">No queues reported</p>
            )}
          </section>
        ))
      ) : (
        <p className="radar-empty radar-empty--workspace">
          {hasUsableSnapshot ? 'No dispatcher data reported' : 'Radar snapshot unavailable'}
        </p>
      )}
    </div>
  </section>
</div>
```

- [ ] **Step 7: Run the Radar renderer tests and verify green**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/RadarTab.test.tsx
```

Expected: PASS for the existing live snapshot and tone behavior plus health-first DOM order, stale retention, refresh locking, stable empty sections, exact queue depths, complete long names, and update timing.

- [ ] **Step 8: Commit the semantic workspace slice**

```bash
git add src/renderer/src/tabs/RadarTab.tsx src/renderer/src/tabs/__tests__/RadarTab.test.tsx
git commit -m "feat: restructure the Radar workspace"
```

---

### Task 4: Implement the Left Health Rail and Responsive Dispatcher Lanes

**Files:**

- Modify: `src/renderer/src/tabs/radar.css:1-299`
- Create: `src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts`

**Interfaces:**

- Consumes: the class contract introduced in Task 3.
- Produces: a normal `minmax(240px, 280px) minmax(0, 1fr)` health-rail/lane layout.
- Produces: a `@container radar (max-width: 720px)` single-column fallback.
- Preserves: Relay typography, color tokens, square corners, source-provided status tones, and reduced-motion neutrality.

- [ ] **Step 1: Write the CSS structure regression**

Create `RadarTabStyles.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const radarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/tabs/radar.css'),
  'utf8',
);

describe('Radar layout CSS', () => {
  it('places a bounded health rail before flexible dispatcher lanes', () => {
    expect(radarCss).toMatch(
      /\.radar-tab\s*{[^}]*container-name:\s*radar;[^}]*container-type:\s*inline-size;/s,
    );
    expect(radarCss).toMatch(
      /\.radar-workspace\s*{[^}]*grid-template-columns:\s*minmax\(240px,\s*280px\)\s+minmax\(0,\s*1fr\);/s,
    );
    expect(radarCss).toMatch(
      /\.radar-health-rail\s*{[^}]*border-right:\s*1px solid var\(--color-border\);/s,
    );
  });

  it('stacks the rail above lanes at narrow Radar content widths', () => {
    expect(radarCss).toMatch(
      /@container radar \(max-width:\s*720px\)[\s\S]*?\.radar-workspace\s*{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(radarCss).toMatch(
      /@container radar \(max-width:\s*720px\)[\s\S]*?\.radar-health-rail\s*{[^}]*border-right:\s*0;[^}]*border-bottom:\s*1px solid var\(--color-border\);/,
    );
  });

  it('contains long queue names without horizontal overflow', () => {
    expect(radarCss).toMatch(/\.radar-table\s*{[^}]*table-layout:\s*fixed;/s);
    expect(radarCss).toMatch(
      /\.radar-table-name\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(radarCss).toMatch(/\.radar-lane-grid\s*{[^}]*min-width:\s*0;/s);
  });
});
```

- [ ] **Step 2: Run the style test and verify red**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts
```

Expected: FAIL because the current CSS has a full-width XCenter lead and auto-fill panel grid, not the approved rail/lane structure or container fallback.

- [ ] **Step 3: Establish the Radar container and two-column workspace**

Keep the current page/header/notice/status-tone rules, then replace the board-layout rules with:

```css
.radar-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: 16px 24px 24px;
  background: transparent;
  overflow: auto;
  scrollbar-gutter: stable;
  container-name: radar;
  container-type: inline-size;
}

.radar-workspace {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  align-items: start;
  gap: 28px;
  min-width: 0;
}

.radar-health-rail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-right: 24px;
  border-right: 1px solid var(--color-border);
}

.radar-health-section {
  min-width: 0;
  padding: 16px 0;
  border-bottom: 1px solid var(--color-border-subtle);
}

.radar-health-section:first-child {
  padding-top: 0;
}

.radar-health-section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.radar-section-title,
.radar-lane-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-quaternary);
}

.radar-dispatcher-lanes {
  min-width: 0;
}

.radar-lane-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  align-items: start;
  gap: 24px 32px;
  min-width: 0;
}

.radar-lane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-subtle);
}
```

- [ ] **Step 4: Fit exact health data and safely truncate queue names**

Use:

```css
.radar-figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.radar-figure {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.radar-figure-value {
  font-family: var(--font-family-mono);
  font-size: 30px;
  line-height: 1.05;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.radar-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--text-xs);
}

.radar-table th:last-child,
.radar-table td:last-child {
  width: 84px;
}

.radar-table-name {
  min-width: 0;
  padding-right: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.radar-empty--workspace {
  grid-column: 1 / -1;
  padding: 28px 0;
  border-top: 1px solid var(--color-border-subtle);
}

.radar-clock {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  font-size: var(--text-xs);
}

.radar-clock > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.radar-clock dt {
  color: var(--color-text-quaternary);
}

.radar-clock dd {
  margin: 0;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
```

Keep service metric tones source-driven. Do not add selectors that color `.radar-table-number` from the numeric depth.

- [ ] **Step 5: Add the content-width fallback**

Append:

```css
@container radar (max-width: 720px) {
  .radar-workspace {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .radar-health-rail {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 24px;
    padding-right: 0;
    padding-bottom: 20px;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .radar-health-section:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}

@container radar (max-width: 460px) {
  .radar-tab-header,
  .radar-tab-actions {
    align-items: flex-start;
  }

  .radar-tab-actions {
    width: 100%;
    justify-content: space-between;
  }

  .radar-health-rail {
    grid-template-columns: 1fr;
  }

  .radar-health-section:nth-last-child(2) {
    border-bottom: 1px solid var(--color-border-subtle);
  }
}
```

- [ ] **Step 6: Run focused Radar tests**

Run:

```bash
npx vitest run src/renderer/src/tabs/__tests__/RadarTab.test.tsx src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts
```

Expected: PASS for semantic behavior and the wide/narrow layout contract.

- [ ] **Step 7: Commit the responsive page slice**

```bash
git add src/renderer/src/tabs/radar.css src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts
git commit -m "feat: style Radar dispatcher lanes"
```

---

### Task 5: Prove the Design in Chromium/Electron Layout

**Files:**

- Modify: `tests/e2e/css-visual-contracts.spec.ts:6-25`
- Modify: `tests/e2e/css-visual-contracts.spec.ts`

**Interfaces:**

- Consumes: production `theme.css`, `sidebar.css`, `responsive.css`, and `radar.css`.
- Produces: deterministic Electron measurements for both sidebar modes.
- Produces: deterministic wide and narrow Radar overflow/placement checks.

- [ ] **Step 1: Load the production Radar and sidebar styles in the visual-contract suite**

Add:

```ts
const sidebarCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);
const responsiveCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/styles/responsive.css'),
  'utf8',
);
const radarCss = readFileSync(
  join(testDirectory, '../../src/renderer/src/tabs/radar.css'),
  'utf8',
);
```

- [ ] **Step 2: Add the full/compact Radar navigation measurement**

Add this Electron test:

```ts
test('Radar status keeps the standard sidebar footprint in full and compact shells', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${sidebarCss}
        ${responsiveCss}
        html, body { margin: 0; }
      </style>
      <button
        class="sidebar-button sidebar-button--status sidebar-button--active"
        data-status-tone="yellow"
      >
        <span class="sidebar-button-icon"><svg></svg></span>
        <span class="sidebar-button-label">Radar</span>
        <span
          class="sidebar-button-status-dot"
          data-status-tone="yellow"
          aria-hidden="true"
        ></span>
        <span class="sidebar-button-detail" aria-hidden="true">
          <span class="sidebar-button-detail--full">2k · 1.8k</span>
          <span class="sidebar-button-detail--compact">2k·1.8k</span>
        </span>
      </button>
    `);

    const button = window.locator('.sidebar-button');
    const fullDetail = window.locator('.sidebar-button-detail--full');
    const compactDetail = window.locator('.sidebar-button-detail--compact');

    await window.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => {
        const box = await button.boundingBox();
        return box && { width: box.width, height: box.height };
      })
      .toEqual({ width: 120, height: 56 });
    await expect(fullDetail).toBeVisible();
    await expect(compactDetail).toBeHidden();

    await window.setViewportSize({ width: 1100, height: 900 });
    await expect
      .poll(async () => {
        const box = await button.boundingBox();
        return box && { width: box.width, height: box.height };
      })
      .toEqual({ width: 56, height: 48 });
    await expect(fullDetail).toBeHidden();
    await expect(compactDetail).toBeVisible();
    await expect(window.locator('.sidebar-button-status-dot')).toHaveCount(1);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 3: Add the wide/narrow Radar workspace measurement**

Add:

```ts
test('Radar keeps the health rail left when wide and stacks without overflow when narrow', async () => {
  const app = await electron.launch({ args: [mainEntry] });
  const window = await app.firstWindow();

  try {
    await window.setContent(`
      <style>
        ${themeCss}
        ${radarCss}
        html, body { margin: 0; width: 100%; height: 100%; }
        .radar-tab { box-sizing: border-box; width: 100%; height: 100%; }
      </style>
      <div class="radar-tab">
        <div class="radar-workspace">
          <aside class="radar-health-rail">
            <section class="radar-health-section">
              <h3 class="radar-section-title">XCenter</h3>
              <div class="radar-figures">
                <span class="radar-figure-value">2,000</span>
                <span class="radar-figure-value">1,807</span>
              </div>
            </section>
          </aside>
          <section class="radar-dispatcher-lanes">
            <h3 class="radar-section-title">Dispatchers</h3>
            <div class="radar-lane-grid">
              <section class="radar-lane">
                <h4 class="radar-lane-title">prod01</h4>
                <table class="radar-table">
                  <tbody>
                    <tr>
                      <td class="radar-table-name">
                        TRANSACTION.MEMBERSHIPS.RECONCILIATION.EXCEPTION.RETRY.DEAD.LETTER.QUEUE
                      </td>
                      <td class="radar-table-number">12,534</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          </section>
        </div>
      </div>
    `);

    const rail = window.locator('.radar-health-rail');
    const lanes = window.locator('.radar-dispatcher-lanes');
    const tab = window.locator('.radar-tab');

    await window.setViewportSize({ width: 1400, height: 900 });
    const wideRail = await rail.boundingBox();
    const wideLanes = await lanes.boundingBox();
    expect(wideRail).not.toBeNull();
    expect(wideLanes).not.toBeNull();
    expect((wideRail?.x ?? 0) + (wideRail?.width ?? 0)).toBeLessThan(wideLanes?.x ?? 0);

    await window.setViewportSize({ width: 680, height: 900 });
    await expect
      .poll(async () => {
        const [railBox, laneBox] = await Promise.all([rail.boundingBox(), lanes.boundingBox()]);
        return Boolean(railBox && laneBox && railBox.y + railBox.height <= laneBox.y);
      })
      .toBe(true);
    await expect
      .poll(async () => tab.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 4: Run the focused Electron contract and verify green**

Run:

```bash
npm run test:electron -- tests/e2e/css-visual-contracts.spec.ts
```

Expected: PASS with a `120 × 56` full Radar button, a `56 × 48` compact Radar button, one dot, the correct visible count variant, left-rail placement when wide, stacked placement when narrow, and at most one pixel of horizontal overflow.

- [ ] **Step 5: Commit the Electron layout contract**

```bash
git add tests/e2e/css-visual-contracts.spec.ts
git commit -m "test: cover Radar responsive layout"
```

---

## Final Verification

- [ ] Run all focused renderer regressions:

```bash
npx vitest run src/renderer/src/components/__tests__/Sidebar.test.tsx src/renderer/src/components/__tests__/sidebar/SidebarButton.test.tsx src/renderer/src/__tests__/responsiveShell.test.ts src/renderer/src/tabs/__tests__/RadarTab.test.tsx src/renderer/src/tabs/__tests__/RadarTabStyles.test.ts
```

- [ ] Run the required repository gates:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
git diff --check
npm audit --audit-level=high --omit=dev
```

- [ ] Run the desktop integration suite through Relay's ABI-safe script:

```bash
npm run test:electron
```

- [ ] Launch the disposable local development app:

```bash
npm run dev
```

Verify at a width above `1200px`:

- Radar uses the standard `120px × 56px` navigation footprint.
- The active Relay accent rail remains visible.
- Exactly one health dot is visible.
- Counts read `2k · 1.8k` for the representative `2,000` and `1,807` values.
- No health wash or health-colored rail appears.
- The health rail is left of dispatcher lanes.

Verify at a width at or below `1200px`:

- Radar uses the standard `56px × 48px` navigation footprint.
- Counts read `2k·1.8k`.
- The icon, dot, and counts do not clip.
- The Radar page does not overflow horizontally.

Verify with warning/critical source tones and a long queue name:

- Overall, dispatcher, and service states pair color with visible text.
- Queue depth remains neutral unless its source provides a tone.
- Hovering the truncated queue name exposes its complete value.

Verify refresh and failure states:

- `REFRESHING` disables repeat refresh while keeping the last snapshot visible.
- Sign-in-required and error notices call retained data stale.
- No-snapshot state keeps all health sections and one focused lane message.

- [ ] Stop the local development process after the visual pass and confirm the worktree contains only the intended Radar/sidebar/test changes.
