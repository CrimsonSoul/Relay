# Relay Alerts Action Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distill Alerts to Outlook/Download Draft as the primary command, Save Image as the prominent secondary command, and a keyboard-accessible overflow for low-frequency utilities while collapsing optional delivery details into a truthful configured-state summary.

**Architecture:** A focused `AlertActionsMenu` presents the five existing utility handlers through Relay's tested `ContextMenu` keyboard/focus behavior. `AlertsTab` keeps capture/export/history/reminder handlers unchanged and owns one attention request for invalid optional fields. `AlertForm` owns its disclosure state, derives summary tokens from the existing draft and logo props, and expands/focuses a named optional field only when `AlertsTab` requests it.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Relay `ContextMenu`, Relay `TactileButton`, renderer CSS.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-05-relay-tab-operator-workflows-design.md`.
- Desktop primary label is `OPEN IN OUTLOOK`; Relay Web primary label is `DOWNLOAD DRAFT`.
- `SAVE IMAGE` is the only visible secondary action and remains a high-resolution PNG capture.
- Overflow order is Schedule Alarm, Alarms, History, Pin Template, Reset.
- Preserve every existing handler, modal, history write, reminder flow, loading state, and dirty-draft confirmation.
- Optional delivery details are collapsed by default and report only configured categories: Routing configured, Link ready, Timing configured, Branding customized.
- Missing optional categories are omitted, not described as failures.
- Loaded history/template/reminder content updates summary tokens without forcing disclosure open.
- Invalid click-through export expands the optional section and focuses `#alerts-click-through-url`.
- Do not change EML content, click-through sanitization, image rendering, history persistence, reminder persistence, or alert draft shape.
- Relay Desktop and Relay Web retain their runtime-specific primary labels and identical interaction hierarchy.

---

### Task 1: Keyboard-accessible Alerts overflow component

**Files:**
- Create: `src/renderer/src/tabs/alerts/AlertActionsMenu.tsx`
- Create: `src/renderer/src/tabs/alerts/__tests__/AlertActionsMenu.test.tsx`

**Interfaces:**
- Consumes: five existing no-argument handlers and `captureBusy: boolean`.
- Produces: a descriptive `More alert actions` trigger and a `ContextMenu` with exact approved item order.

- [ ] **Step 1: Write failing overflow inventory and keyboard tests**

```tsx
const handlers = {
  onScheduleAlarm: vi.fn(),
  onOpenAlarms: vi.fn(),
  onOpenHistory: vi.fn(),
  onPinTemplate: vi.fn(),
  onReset: vi.fn(),
};

it('opens the five approved utilities in order', () => {
  render(<AlertActionsMenu {...handlers} captureBusy={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'More alert actions' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Schedule Alarm',
    'Alarms',
    'History',
    'Pin Template',
    'Reset',
  ]);
});

it('supports ArrowDown, ArrowUp, Escape, and focus return through ContextMenu', () => {
  render(<AlertActionsMenu {...handlers} captureBusy={false} />);
  const trigger = screen.getByRole('button', { name: 'More alert actions' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Run the new component test to verify it fails**

Run: `npm run test:renderer -- src/renderer/src/tabs/alerts/__tests__/AlertActionsMenu.test.tsx`

Expected: FAIL because `AlertActionsMenu` does not exist.

- [ ] **Step 3: Implement the trigger and menu using existing ContextMenu behavior**

```tsx
export type AlertActionsMenuProps = {
  captureBusy: boolean;
  onScheduleAlarm: () => void;
  onOpenAlarms: () => void;
  onOpenHistory: () => void;
  onPinTemplate: () => void;
  onReset: () => void;
};

export function AlertActionsMenu(props: AlertActionsMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const items: ContextMenuItem[] = [
    { label: 'Schedule Alarm', onClick: props.onScheduleAlarm },
    { label: 'Alarms', onClick: props.onOpenAlarms },
    { label: 'History', onClick: props.onOpenHistory },
    { label: 'Pin Template', onClick: props.onPinTemplate },
    { label: 'Reset', onClick: props.onReset, danger: true },
  ];

  return (
    <>
      <button
        type="button"
        className="alerts-overflow-trigger"
        aria-label="More alert actions"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        disabled={props.captureBusy}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.right, y: rect.bottom + 4 });
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {position && (
        <ContextMenu
          x={position.x}
          y={position.y}
          items={items}
          onClose={() => setPosition(null)}
        />
      )}
    </>
  );
}
```

Use existing icon components or the current inline SVG paths for menu items only when they improve scanning; item labels and order are mandatory.

- [ ] **Step 4: Run the new component test to verify it passes**

Run: `npm run test:renderer -- src/renderer/src/tabs/alerts/__tests__/AlertActionsMenu.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the overflow component**

```bash
git add src/renderer/src/tabs/alerts/AlertActionsMenu.tsx src/renderer/src/tabs/alerts/__tests__/AlertActionsMenu.test.tsx
git commit -m "feat: add Alerts utility overflow"
```

### Task 2: Two-action command bar wired to existing handlers

**Files:**
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

**Interfaces:**
- Consumes: `AlertActionsMenu` from Task 1 and all existing Alerts handlers.
- Produces: primary Outlook/Download Draft, visible Save Image, and overflow utilities without handler-semantic changes.

- [ ] **Step 1: Replace toolbar-shape tests with the approved hierarchy**

```tsx
it('shows only draft delivery and Save Image outside the overflow', () => {
  render(<AlertsTab />);
  const toolbar = screen.getByRole('toolbar', { name: 'Alert actions' });
  expect(within(toolbar).getByRole('button', { name: /OPEN IN OUTLOOK/i })).toBeVisible();
  expect(within(toolbar).getByRole('button', { name: /SAVE IMAGE/i })).toBeVisible();
  expect(within(toolbar).getByRole('button', { name: 'More alert actions' })).toBeVisible();
  expect(within(toolbar).queryByRole('button', { name: /^RESET$/i })).toBeNull();
  expect(within(toolbar).queryByRole('button', { name: /^HISTORY$/i })).toBeNull();
  expect(within(toolbar).queryByRole('button', { name: /^SCHEDULE ALARM$/i })).toBeNull();
});

it('keeps Save Image as the prominent secondary action while capture is busy', async () => {
  const capture = deferred<HTMLCanvasElement>();
  mockCapture.html2canvas.mockReturnValueOnce(capture.promise);
  render(<AlertsTab />);
  fireEvent.click(screen.getByRole('button', { name: /SAVE IMAGE/i }));
  expect(screen.getByRole('button', { name: /SAVE IMAGE/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'More alert actions' })).toBeDisabled();
});
```

Add `within` to the existing `@testing-library/react` import. Preserve the existing web-runtime test that switches `globalThis.api.runtime` to `WEB_RUNTIME` and expects `DOWNLOAD DRAFT`; it proves the distilled primary action retains Desktop/Web label parity.

Add this promise helper so the capture remains pending until the assertions complete:

```ts
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
```

Update obsolete tests that assert alarm placement before Outlook or simultaneous utility buttons.

- [ ] **Step 2: Run AlertsTab tests to verify the hierarchy assertions fail**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`

Expected: FAIL because all utility buttons are still visible.

- [ ] **Step 3: Replace the existing utility and primary groups with three controls**

```tsx
<div className="alerts-command-actions">
  <TactileButton
    variant="primary"
    onClick={() => void handleOpenOutlookDraft()}
    loading={isCapturing}
  >
    {isWebRuntime ? 'DOWNLOAD DRAFT' : 'OPEN IN OUTLOOK'}
  </TactileButton>
  <TactileButton
    variant="secondary"
    className="alerts-save-image-action"
    onClick={handleSaveImage}
    loading={isCapturing}
  >
    SAVE IMAGE
  </TactileButton>
  <AlertActionsMenu
    captureBusy={isCapturing}
    onScheduleAlarm={openNewReminderModal}
    onOpenAlarms={reminderManagerModal.open}
    onOpenHistory={historyModal.open}
    onPinTemplate={handlePinTemplate}
    onReset={handleClear}
  />
</div>
```

Retain the current SVGs/tooltips for Outlook and Save Image. Do not rewrite their callbacks.

- [ ] **Step 4: Style the distilled command bar**

```css
.alerts-command-actions {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.alerts-save-image-action.tactile-button,
.alerts-overflow-trigger {
  min-height: 36px;
}

.alerts-overflow-trigger {
  min-width: 44px;
  border: 1px solid var(--color-border-strong);
  background: transparent;
  color: var(--color-text-secondary);
}
```

Add existing hover, focus-visible, disabled, and responsive wrapping tokens. Remove selectors that only served the deleted simultaneous utility groups.

- [ ] **Step 5: Run AlertsTab tests and existing export/reminder integration tests**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.operatorAttribution.integration.test.tsx`

Expected: PASS, including image scale, Outlook/EML content, history writes, alarms, and reset confirmation.

- [ ] **Step 6: Commit the command hierarchy**

```bash
git add src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat: distill Alerts command hierarchy"
```

### Task 3: Collapsed optional-delivery summary

**Files:**
- Modify: `src/renderer/src/tabs/AlertForm.tsx`
- Create: `src/renderer/src/tabs/alerts/AlertDeliveryFields.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertForm.test.tsx`
- Modify: `src/renderer/src/tabs/alerts.css`

**Interfaces:**
- Consumes: existing alert draft fields and logo props.
- Produces: `AlertOptionalField`, `AlertOptionalAttentionRequest`, configured-state tokens, and controlled disclosure/focus behavior.

- [ ] **Step 1: Add failing default-collapse and summary-token tests**

```tsx
it('collapses optional delivery details by default and omits unconfigured categories', () => {
  render(<AlertForm {...defaultProps} />);
  const disclosure = screen.getByRole('group', { name: 'Optional delivery details' });
  expect(disclosure).not.toHaveAttribute('open');
  expect(screen.queryByText('Routing configured')).toBeNull();
  expect(screen.queryByText('Link ready')).toBeNull();
  expect(screen.queryByText('Timing configured')).toBeNull();
  expect(screen.queryByText('Branding customized')).toBeNull();
});

it('summarizes only configured optional categories without opening the section', () => {
  render(<AlertForm
    {...defaultProps}
    sender="IT"
    clickThroughUrl="https://status.example.com"
    updateNumber={2}
    logoDataUrl="data:image/png;base64,logo"
  />);
  expect(screen.getByText('Routing configured')).toBeVisible();
  expect(screen.getByText('Link ready')).toBeVisible();
  expect(screen.getByText('Timing configured')).toBeVisible();
  expect(screen.getByText('Branding customized')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Optional delivery details' })).not.toHaveAttribute(
    'open',
  );
});

it('updates configured-state summary on a loaded draft without forcing disclosure open', () => {
  const { rerender } = render(<AlertForm {...defaultProps} />);
  rerender(<AlertForm {...defaultProps} sender="NOC" eventTimeStart="2026-08-05T14:00" />);
  expect(screen.getByText('Routing configured')).toBeVisible();
  expect(screen.getByText('Timing configured')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Optional delivery details' })).not.toHaveAttribute(
    'open',
  );
});
```

- [ ] **Step 2: Add a failing attention-request focus test**

```tsx
it('expands and focuses the requested optional field exactly once', async () => {
  const request = { requestId: 3, field: 'clickThroughUrl' as const };
  const { rerender } = render(<AlertForm {...defaultProps} attentionRequest={request} />);
  await waitFor(() => expect(screen.getByLabelText('Clickable image URL')).toHaveFocus());
  expect(screen.getByRole('group', { name: 'Optional delivery details' })).toHaveAttribute('open');

  fireEvent.click(screen.getByText('Add delivery details'));
  rerender(<AlertForm {...defaultProps} attentionRequest={request} />);
  expect(screen.getByRole('group', { name: 'Optional delivery details' })).not.toHaveAttribute(
    'open',
  );
});
```

Extend `AlertFormHarnessProps` and the existing harness destructuring so `attentionRequest` is passed through to `BaseAlertForm`; keep the current `AlertDraftProvider` setup for draft overrides.

Add `waitFor` to the existing `@testing-library/react` import in `AlertForm.test.tsx`.

- [ ] **Step 3: Run AlertForm tests to verify the new behavior fails**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertForm.test.tsx`

Expected: FAIL because step 3 is always expanded and accepts no attention request.

- [ ] **Step 4: Add exact attention types and summary derivation**

```ts
export type AlertOptionalField = 'clickThroughUrl';
export type AlertOptionalAttentionRequest = {
  requestId: number;
  field: AlertOptionalField;
};

const summaryTokens = [
  (sender.trim() || recipient.trim()) && 'Routing configured',
  normalizedClickThroughUrl && 'Link ready',
  (updateNumber > 0 || eventTimeStart || eventTimeEnd) && 'Timing configured',
  (logoDataUrl || footerLogoDataUrl) && 'Branding customized',
].filter((token): token is string => Boolean(token));
```

Add `attentionRequest?: AlertOptionalAttentionRequest | null` to `AlertFormProps`.

- [ ] **Step 5: Extract the delivery fields and wrap them in a controlled details element**

Move the current Routing, Outlook action, Timing, and Branding option markup from `AlertForm.tsx` into `AlertDeliveryFields.tsx`. The extracted component calls `useAlertDraft()` for `sender`, `recipient`, `clickThroughUrl`, `updateNumber`, `eventTimeStart`, `eventTimeEnd`, `eventTimeSourceTz`, and `setField`, and accepts the six current logo props from `AlertFormProps`.

Use these imports in the extracted component so validation and logo behavior remain on the current code paths:

```ts
import { AlertLogoUpload } from './AlertLogoUpload';
import { useAlertDraft } from './AlertDraftContext';
import { ALERT_CLICK_URL_MAX_LENGTH, sanitizeAlertClickUrl } from '../alertLinks';
```

```tsx
export type AlertDeliveryFieldsProps = {
  logoDataUrl: string | null;
  onSetLogo: () => void;
  onRemoveLogo: () => void;
  footerLogoDataUrl: string | null;
  onSetFooterLogo: () => void;
  onRemoveFooterLogo: () => void;
};

<details
  className="alerts-step-section alerts-optional-delivery"
  role="group"
  aria-label="Optional delivery details"
  open={deliveryExpanded}
  onToggle={(event) => setDeliveryExpanded(event.currentTarget.open)}
>
  <summary className="alerts-step-header alerts-optional-delivery-summary">
    <span className="alerts-step-index" aria-hidden="true">3</span>
    <div className="alerts-step-copy">
      <h2 className="alerts-step-title" id="alerts-step-delivery-title">
        Add delivery details
      </h2>
      <p className="alerts-step-description">Routing, timing, and updates.</p>
    </div>
    <span className="alerts-optional-summary-state">
      {summaryTokens.map((token) => <span key={token}>{token}</span>)}
    </span>
    <span className="alerts-step-status">OPTIONAL</span>
  </summary>
  <div className="alerts-step-content">
    <AlertDeliveryFields
      logoDataUrl={logoDataUrl}
      onSetLogo={onSetLogo}
      onRemoveLogo={onRemoveLogo}
      footerLogoDataUrl={footerLogoDataUrl}
      onSetFooterLogo={onSetFooterLogo}
      onRemoveFooterLogo={onRemoveFooterLogo}
    />
  </div>
</details>
```

Use `lastAttentionRequestIdRef` in an effect. For a new click-through request, set `deliveryExpanded(true)` and focus `document.getElementById('alerts-click-through-url')` in `requestAnimationFrame`.

- [ ] **Step 6: Style disclosure state and summary tokens**

```css
.alerts-optional-delivery-summary {
  cursor: pointer;
  list-style: none;
}

.alerts-optional-summary-state {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
}

.alerts-optional-summary-state > span {
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--text-2xs);
}
```

Remove the native disclosure marker and add the existing focus-visible token. At narrow widths, allow tokens to wrap below the title rather than clipping.

- [ ] **Step 7: Run AlertForm tests to verify disclosure behavior passes**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertForm.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit optional delivery disclosure**

```bash
git add src/renderer/src/tabs/AlertForm.tsx src/renderer/src/tabs/alerts/AlertDeliveryFields.tsx src/renderer/src/tabs/__tests__/AlertForm.test.tsx src/renderer/src/tabs/alerts.css
git commit -m "feat: collapse optional alert delivery details"
```

### Task 4: Invalid export attention wiring

**Files:**
- Modify: `src/renderer/src/tabs/AlertsTab.tsx`
- Modify: `src/renderer/src/tabs/__tests__/AlertsTab.test.tsx`

**Interfaces:**
- Consumes: `AlertOptionalAttentionRequest` from Task 3.
- Produces: a new request only when Outlook/Download Draft validation identifies the click-through field.

- [ ] **Step 1: Add a failing invalid-click-through request test**

```tsx
it('requests click-through attention before an invalid Outlook export', async () => {
  render(<AlertsTab />);
  fireEvent.click(screen.getByTestId('set-unsafe-click-through-url'));
  fireEvent.click(screen.getByRole('button', { name: /OPEN IN OUTLOOK/i }));

  expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'clickThroughUrl' });
  expect(mockCapture.html2canvas).not.toHaveBeenCalled();
  expect(mockShowToast).toHaveBeenCalledWith(
    'Enter a valid HTTP or HTTPS click-through URL',
    'error',
  );
});
```

Capture `props` in the existing `AlertForm` mock as `lastAlertFormProps`, reset it in `beforeEach`, and retain the mock's current draft mutation buttons. Task 3's real `AlertForm` test proves that this request expands and focuses the actual input.

- [ ] **Step 2: Run the integration case to verify it fails**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx -t "invalid click-through"`

Expected: FAIL because `AlertsTab` does not yet pass an attention request.

- [ ] **Step 3: Create and pass a monotonically identified attention request**

```tsx
const optionalAttentionSequenceRef = useRef(0);
const [optionalAttentionRequest, setOptionalAttentionRequest] =
  useState<AlertOptionalAttentionRequest | null>(null);

const requestOptionalFieldAttention = useCallback((field: AlertOptionalField) => {
  optionalAttentionSequenceRef.current += 1;
  setOptionalAttentionRequest({
    requestId: optionalAttentionSequenceRef.current,
    field,
  });
}, []);
```

Call `requestOptionalFieldAttention('clickThroughUrl')` immediately before the existing invalid-URL toast and early return. Pass `attentionRequest={optionalAttentionRequest}` to `AlertForm`.

- [ ] **Step 4: Run AlertsTab and AlertForm tests**

Run: `npm run test:renderer -- src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/AlertForm.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit validation attention wiring**

```bash
git add src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx
git commit -m "feat: focus invalid alert delivery fields"
```

### Task 5: Document Alerts operator hierarchy

**Files:**
- Modify: `docs/DESIGN.md`

**Interfaces:**
- Consumes: completed command hierarchy and optional disclosure behavior.
- Produces: canonical renderer guidance that prevents low-frequency utilities from returning to the primary toolbar.

- [ ] **Step 1: Add the operator-action hierarchy after the Alerts email-preview exemption**

```md
### Operator action hierarchy

Alerts exposes Open in Outlook on Desktop or Download Draft on Relay Web as the primary command.
Save Image is the visible secondary command. Schedule Alarm, Alarms, History, Pin Template, and
Reset remain available in the keyboard-accessible overflow, with existing confirmations and modal
behavior unchanged. Optional delivery details stay collapsed until requested and summarize only
configured routing, link, timing, and branding state.
```

- [ ] **Step 2: Check the edited canonical document**

Run: `npx prettier --check docs/DESIGN.md && git diff --check`

Expected: both commands exit 0.

- [ ] **Step 3: Commit the Alerts design update**

```bash
git add docs/DESIGN.md
git commit -m "docs: define Alerts action hierarchy"
```

### Task 6: Alerts readiness gate

**Files:**
- Modify only files required by failures attributable to Tasks 1-4.

**Interfaces:**
- Consumes: completed Alerts command and disclosure slices.
- Produces: verified Alerts behavior ready to combine with the other Relay tab plans.

- [ ] **Step 1: Run the complete Alerts renderer slice**

Run: `npm run test:renderer -- src/renderer/src/tabs/alerts/__tests__/AlertActionsMenu.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.test.tsx src/renderer/src/tabs/__tests__/AlertForm.test.tsx src/renderer/src/tabs/__tests__/AlertsTab.operatorAttribution.integration.test.tsx src/renderer/src/tabs/__tests__/AlertReminderModal.test.tsx src/renderer/src/tabs/__tests__/AlertReminderManagerModal.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run static gates for the slice**

Run: `npm run typecheck && npm run lint && npm run format:check && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the final diff for handler preservation**

Run: `git diff "$(git merge-base origin/test HEAD)"..HEAD -- src/renderer/src/tabs/AlertsTab.tsx src/renderer/src/tabs/AlertForm.tsx src/renderer/src/tabs/alerts/AlertActionsMenu.tsx src/renderer/src/tabs/alerts.css`

Expected: export/history/reminder implementations remain intact; changes are limited to hierarchy, disclosure, and validation focus wiring.
