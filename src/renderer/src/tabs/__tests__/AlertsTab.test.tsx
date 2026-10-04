import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WEB_RUNTIME } from '@shared/runtime';
import { readCssBundle } from '../../styles/readCssBundle.test-util';

function cssBlock(css: string, selector: string): string | undefined {
  const selectorStart = css.indexOf(selector);
  if (selectorStart === -1) return undefined;

  const openingBrace = css.indexOf('{', selectorStart);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }

  return undefined;
}

function mediaBlock(css: string, query: string): string | undefined {
  const mediaStart = css.indexOf(`@media (${query})`);
  if (mediaStart === -1) return undefined;

  const openingBrace = css.indexOf('{', mediaStart);
  let depth = 0;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(openingBrace + 1, index);
  }

  return undefined;
}

function declarations(css: string): Map<string, string> {
  return new Map(
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((declaration) => {
        const separator = declaration.indexOf(':');
        return separator === -1
          ? undefined
          : [declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()];
      })
      .filter((declaration): declaration is [string, string] => declaration !== undefined),
  );
}

function px(value: string | undefined): number {
  const parsed = /^(\d+)px$/.exec(value?.trim() ?? '');
  if (!parsed) throw new Error(`Expected a pixel value, received ${value ?? 'undefined'}`);
  return Number(parsed[1]);
}

function gridMinimums(template: string | undefined): number[] {
  if (!template) throw new Error('Missing grid-template-columns');

  return template
    .split('minmax(')
    .slice(1)
    .map((column) => px(`${column.trim().split('px', 1)[0]}px`));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function decodeEmlPart(eml: string, contentType: 'text/plain' | 'text/html'): string {
  const encoded = eml
    .split(
      `Content-Type: ${contentType}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
    )[1]
    ?.split('\r\n--relay_alert_')[0]
    ?.replaceAll('\r\n', '');
  return Buffer.from(encoded ?? '', 'base64').toString('utf8');
}

// --- Mocks ---

const OPTIMIZED_OUTLOOK_DATA_URL = 'data:image/png;base64,T1BUSU1JWkVEX09VVExPT0tfQ0FQVFVSRQ==';

const mockCapture = vi.hoisted(() => {
  const highResCanvas = {
    width: 1280,
    height: 1200,
    toDataURL: vi.fn(() => 'data:image/png;base64,HIGH_RES_CAPTURE'),
  };
  const outlookCanvas = {
    width: 640,
    height: 600,
    toDataURL: vi.fn(() => 'data:image/png;base64,OUTLOOK_SIZED_CAPTURE'),
  };
  const html2canvas = vi.fn((_element: HTMLElement, options?: { scale?: number }) =>
    Promise.resolve(options?.scale === 1 ? outlookCanvas : highResCanvas),
  );
  return { highResCanvas, outlookCanvas, html2canvas };
});

vi.mock('html2canvas', () => ({
  default: mockCapture.html2canvas,
}));

// Mock useToast — capture showToast so tests can assert on it
const mockShowToast = vi.fn();
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mock useAlertHistory — capture addHistory so tests can assert/resolve it
const mockAddHistory = vi.fn().mockResolvedValue({ id: '1' });
const mockDeleteHistory = vi.fn();
const mockDeleteHistoryEntries = vi.fn();
const mockPinHistory = vi.fn();
const mockUpdateLabel = vi.fn();
const mockHistory = { current: [] as Array<Record<string, unknown>> };
vi.mock('../../hooks/useAlertHistory', () => ({
  useAlertHistory: () => ({
    history: mockHistory.current,
    addHistory: mockAddHistory,
    deleteHistory: mockDeleteHistory,
    deleteHistoryEntries: mockDeleteHistoryEntries,
    pinHistory: mockPinHistory,
    updateLabel: mockUpdateLabel,
  }),
}));

const mockScheduleReminder = vi.fn().mockResolvedValue(true);
const mockUpdateReminder = vi.fn().mockResolvedValue(true);
const mockMarkDone = vi.fn().mockResolvedValue(true);
const mockDismissReminder = vi.fn().mockResolvedValue(true);
const mockReminderRefetch = vi.fn();
const mockPendingReminders = {
  current: [] as Array<{
    id: string;
    title: string;
    dueAt: string;
    note?: string;
    status?: string;
    snoozeUntil?: string;
    operatorId?: string;
    createdBy?: string;
  }>,
};
const mockCompletedReminders = { current: [] as unknown[] };
const mockReminderSubmitResult = { current: null as boolean | null };

vi.mock('../../hooks/useAlertReminders', () => ({
  useAlertReminders: () => ({
    reminders: [],
    pendingReminders: mockPendingReminders.current,
    completedReminders: mockCompletedReminders.current,
    upcomingReminders: mockPendingReminders.current,
    loading: false,
    error: null,
    refetch: mockReminderRefetch,
    scheduleReminder: mockScheduleReminder,
    snoozeReminder: vi.fn(),
    updateReminder: mockUpdateReminder,
    markDone: mockMarkDone,
    dismissReminder: mockDismissReminder,
  }),
}));

// Use a real-ish useModalState so modals can actually open/close
vi.mock('../../hooks/useModalState', () => ({
  useModalState: () => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((p: boolean) => !p),
    };
  },
}));

vi.mock('../AlertReminderModal', () => ({
  AlertReminderModal: (props: {
    isOpen: boolean;
    draft: { severity: string; subject: string; bodyHtml: string; sender: string };
    mode?: 'schedule' | 'edit';
    reminder?: { title: string } | null;
    onSchedule: (input: Record<string, unknown>) => Promise<boolean>;
    onClose: () => void;
  }) =>
    props.isOpen ? (
      <div data-testid="reminder-modal">
        <span data-testid="reminder-modal-mode">{props.mode ?? 'schedule'}</span>
        <span data-testid="reminder-edit-title">{props.reminder?.title ?? ''}</span>
        <span data-testid="reminder-draft-severity">{props.draft.severity}</span>
        <span data-testid="reminder-draft-subject">{props.draft.subject}</span>
        <span data-testid="reminder-draft-body">{props.draft.bodyHtml}</span>
        <span data-testid="reminder-draft-sender">{props.draft.sender}</span>
        <button
          data-testid="reminder-schedule"
          onClick={() =>
            void props
              .onSchedule({
                title: 'Scheduled reminder',
                note: 'Reminder note',
                dueAt: '2026-05-28T20:00:00.000Z',
                operatorId: 'malicious-current-operator',
                createdBy: 'Malicious Current Operator',
              })
              .then((result) => {
                mockReminderSubmitResult.current = result;
              })
          }
        >
          Schedule alarm
        </button>
        <button data-testid="reminder-close" onClick={props.onClose}>
          Close alarm
        </button>
      </div>
    ) : null,
}));

/** The reminder the manager-modal mock acts on, failing loudly when none was passed. */
const firstPendingReminder = (reminders: Array<{ id: string; title: string }>) => {
  const [reminder] = reminders;
  if (!reminder) {
    throw new Error('Expected AlertReminderManagerModal to receive at least one pending reminder');
  }
  return reminder;
};

vi.mock('../AlertReminderManagerModal', () => ({
  AlertReminderManagerModal: (props: {
    isOpen: boolean;
    pendingReminders: Array<{ id: string; title: string }>;
    onScheduleNew: () => void;
    onEdit: (reminder: { id: string; title: string }) => void;
    onDone: (id: string) => void;
    onDismiss: (id: string) => void;
  }) =>
    props.isOpen ? (
      <div data-testid="reminder-manager-modal">
        <span data-testid="manager-count">{props.pendingReminders.length}</span>
        <button data-testid="manager-schedule" onClick={props.onScheduleNew}>
          manager-schedule
        </button>
        <button
          data-testid="manager-edit"
          onClick={() => props.onEdit(firstPendingReminder(props.pendingReminders))}
        >
          manager-edit
        </button>
        <button
          data-testid="manager-done"
          onClick={() => props.onDone(firstPendingReminder(props.pendingReminders).id)}
        >
          manager-done
        </button>
        <button
          data-testid="manager-dismiss"
          onClick={() => props.onDismiss(firstPendingReminder(props.pendingReminders).id)}
        >
          manager-dismiss
        </button>
      </div>
    ) : null,
}));

let lastAlertFormProps: Record<string, unknown> | null = null;

// Mock AlertForm — use the real draft contract and expose controls for tab-level tests
vi.mock('../AlertForm', async () => {
  const { useAlertDraft } = await vi.importActual<typeof import('../alerts/AlertDraftContext')>(
    '../alerts/AlertDraftContext',
  );
  return {
    AlertForm: function MockAlertForm(props: Record<string, unknown>) {
      lastAlertFormProps = props;
      const { state, setField } = useAlertDraft();
      const hasRetiredTransformProps = [
        'isCompact',
        'onToggleCompact',
        'isEnhanced',
        'onToggleEnhanced',
      ].some((key) => Object.prototype.hasOwnProperty.call(props, key));
      const hasRetiredFontSizeProps = ['alertBodyFontSize', 'setAlertBodyFontSize'].some((key) =>
        Object.prototype.hasOwnProperty.call(props, key),
      );
      return (
        <div data-testid="alert-form">
          <button data-testid="set-severity-issue" onClick={() => setField('severity', 'ISSUE')}>
            set-issue
          </button>
          <button
            data-testid="set-severity-maintenance"
            onClick={() => setField('severity', 'MAINTENANCE')}
          >
            set-maintenance
          </button>
          <button data-testid="set-severity-info" onClick={() => setField('severity', 'INFO')}>
            set-info
          </button>
          <button
            data-testid="set-severity-resolved"
            onClick={() => setField('severity', 'RESOLVED')}
          >
            set-resolved
          </button>
          <button data-testid="set-subject" onClick={() => setField('subject', 'Test Subject')}>
            set-subject
          </button>
          <button data-testid="set-body" onClick={() => setField('bodyHtml', '<p>body</p>')}>
            set-body
          </button>
          <button data-testid="set-sender" onClick={() => setField('sender', 'Security')}>
            set-sender
          </button>
          <button data-testid="set-recipient" onClick={() => setField('recipient', 'Managers')}>
            set-recipient
          </button>
          <button
            data-testid="set-click-through-url"
            onClick={() => setField('clickThroughUrl', 'https://status.example.com/incident')}
          >
            set-click-through-url
          </button>
          <button
            data-testid="set-unsafe-click-through-url"
            onClick={() => setField('clickThroughUrl', 'javascript:alert(1)')}
          >
            set-unsafe-click-through-url
          </button>
          <span data-testid="form-click-through-url">{state.clickThroughUrl}</span>
          <button
            data-testid="set-event-times"
            onClick={() => {
              setField('eventTimeStart', '2026-09-10T09:00');
              setField('eventTimeEnd', '2026-09-10T10:00');
            }}
          >
            Set times
          </button>
          <span data-testid="form-event-times">
            {state.eventTimeStart}
            {state.eventTimeEnd}
          </span>
          <span data-testid="form-body-html">{state.bodyHtml}</span>
          <button data-testid="set-update-number" onClick={() => setField('updateNumber', 2)}>
            set-update
          </button>
          <span data-testid="form-retired-transform-props">{String(hasRetiredTransformProps)}</span>
          <span data-testid="form-retired-font-size-props">{String(hasRetiredFontSizeProps)}</span>
        </div>
      );
    },
  };
});

vi.mock('../AlertCard', () => ({
  AlertCard: (props: Record<string, unknown>) => {
    const severityColors: Record<string, string> = {
      ISSUE: '#d32f2f',
      MAINTENANCE: '#f9a825',
      INFO: '#1565c0',
      RESOLVED: '#2e7d32',
    };
    return (
      <div
        className="alerts-email-card"
        data-testid="alert-card"
        ref={props.cardRef as React.Ref<HTMLDivElement>}
        style={
          {
            '--email-banner': severityColors[String(props.severity)] ?? '#1565c0',
            borderColor: 'var(--email-banner)',
          } as React.CSSProperties
        }
      >
        <div className="alerts-email-severity-header" style={{ background: 'var(--email-banner)' }}>
          mock banner
        </div>
        <div className="alerts-email-icon-wrapper">
          <div className="alerts-email-icon">
            <svg data-testid="mock-alert-icon" />
          </div>
        </div>
        <div className="alerts-email-header">mock subject</div>
        <div className="alerts-email-meta">mock meta</div>
        <div className="alerts-email-body">mock body</div>
        <div className="alerts-email-footer">mock footer</div>
        <span data-testid="card-severity">{String(props.severity)}</span>
        <span data-testid="card-subject">{String(props.displaySubject)}</span>
        <span data-testid="card-subject-placeholder">{String(props.subjectIsPlaceholder)}</span>
        <span data-testid="card-sender">{String(props.displaySender)}</span>
        <span data-testid="card-recipient">{String(props.displayRecipient)}</span>
        <span data-testid="card-body">{String(props.bodyHtml)}</span>
        <span data-testid="card-retired-font-size-prop">
          {String(Object.prototype.hasOwnProperty.call(props, 'alertBodyFontSize'))}
        </span>
      </div>
    );
  },
}));

// Mock AlertHistoryModal — render load button when open
vi.mock('../AlertHistoryModal', () => ({
  AlertHistoryModal: (props: {
    isOpen: boolean;
    onLoad: (entry: Record<string, unknown>) => void;
    onDelete: (id: string) => void;
    onClear: () => void;
  }) =>
    props.isOpen ? (
      <div data-testid="history-modal">
        <button
          data-testid="history-load"
          onClick={() =>
            props.onLoad({
              severity: 'MAINTENANCE',
              subject: 'Loaded Subject',
              bodyHtml: '<p>loaded</p>',
              sender: 'Ops',
              recipient: 'Staff',
            })
          }
        >
          Load
        </button>
        <button data-testid="history-delete" onClick={() => props.onDelete('del-1')}>
          Delete
        </button>
        <button data-testid="history-clear" onClick={() => props.onClear()}>
          Clear
        </button>
      </div>
    ) : null,
}));

vi.mock('../../components/CollapsibleHeader', () => ({
  CollapsibleHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="collapsible-header">{children}</div>
  ),
}));

vi.mock('../../components/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    title,
    variant,
    footer,
  }: {
    isOpen: boolean;
    children: React.ReactNode;
    title?: React.ReactNode;
    variant?: string;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid={`modal-${title}`} data-variant={variant}>
        {children}
        {footer}
      </div>
    ) : null,
}));

vi.mock('../../components/StatusBar', () => ({
  StatusBar: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="status-bar">
      {left}
      {right}
    </div>
  ),
  StatusBarLive: () => <span data-testid="status-bar-live" />,
}));

vi.mock('../alertUtils', async () => ({
  ...(await vi.importActual<typeof import('../alertUtils')>('../alertUtils')),
  sanitizeHtml: (html: string) => html,
}));

// Stub globalThis.api
beforeEach(() => {
  vi.clearAllMocks();
  lastAlertFormProps = null;
  mockHistory.current = [];
  mockReminderSubmitResult.current = null;
  mockPendingReminders.current = [];
  mockCompletedReminders.current = [];
  (globalThis as Record<string, unknown>).api = {
    getCompanyLogo: vi.fn().mockResolvedValue(null),
    getFooterLogo: vi.fn().mockResolvedValue(null),
    optimizeAlertImage: vi.fn().mockResolvedValue({
      success: true,
      data: OPTIMIZED_OUTLOOK_DATA_URL,
    }),
    saveAndOpenAlertDraft: vi.fn().mockResolvedValue(true),
    saveAlertImage: vi.fn().mockResolvedValue({ success: true }),
    saveCompanyLogo: vi.fn().mockResolvedValue({ success: false }),
    removeCompanyLogo: vi.fn().mockResolvedValue({ success: true }),
    saveFooterLogo: vi.fn().mockResolvedValue({ success: false }),
    removeFooterLogo: vi.fn().mockResolvedValue({ success: true }),
  };
});

// --- Import after mocks ---
import { AlertsTab } from '../AlertsTab';
import { HISTORY_DELETE_UNDO_MS } from '../alerts/useUndoableHistoryDelete';

type AlertOverflowAction = 'Schedule Alarm' | 'Alarms' | 'Pin Template';

function chooseAlertAction(name: AlertOverflowAction): void {
  fireEvent.click(screen.getByRole('button', { name: 'More Alert Actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

/** Export refuses an unchosen severity or an empty subject or body, so export tests start from a
 * complete message with INFO deliberately chosen. */
function composeExportableAlert(): void {
  fireEvent.click(screen.getByTestId('set-severity-info'));
  fireEvent.click(screen.getByTestId('set-subject'));
  fireEvent.click(screen.getByTestId('set-body'));
}

function openAlertHistory(): void {
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
}

describe('AlertsTab', () => {
  beforeEach(() => {
    // The unsent draft persists per workstation; each test starts from a blank one.
    localStorage.clear();
  });

  it('renders without crashing', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('alert-form')).toBeInTheDocument();
    expect(screen.getByTestId('alert-card')).toBeInTheDocument();
  });

  it('places History at the far-left utility position while keeping Save Image beside delivery', () => {
    render(<AlertsTab />);
    const toolbar = screen.getByRole('toolbar', { name: 'Alert actions' });
    const actions = within(toolbar).getAllByRole('button');

    expect(
      actions.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual(['History', 'Reset', 'Save Image', 'Open in Outlook', 'More Alert Actions']);
    expect(within(toolbar).getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(within(toolbar).queryByRole('button', { name: /^SCHEDULE ALARM$/i })).toBeNull();
  });

  it('keeps Save Image prominent while capture disables conflicting actions', async () => {
    const capture = deferred<typeof mockCapture.highResCanvas>();
    mockCapture.html2canvas.mockReturnValueOnce(capture.promise);
    render(<AlertsTab />);
    composeExportableAlert();

    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }));

    expect(screen.getByRole('button', { name: 'Save Image' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'More Alert Actions' })).toBeDisabled();

    await act(async () => {
      capture.resolve(mockCapture.highResCanvas);
      await capture.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save Image' })).toBeEnabled();
    });
  });

  it('renders the approved Alerts operational hierarchy', () => {
    render(<AlertsTab />);

    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Alert actions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Alert definition' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live email preview' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('tab-page-status');
    // The readout appears only once ready; an incomplete draft shows no "Needs …" text.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByText('Draft · INFO')).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs/)).not.toBeInTheDocument();
  });

  it('separates far-left History from the right-aligned delivery workflow', () => {
    const { container } = render(<AlertsTab />);

    const heading = screen.getByRole('heading', { level: 2, name: 'Alerts' });
    const toolbar = screen.getByRole('toolbar', { name: 'Alert actions' });
    const utility = container.querySelector<HTMLElement>('.tab-command-group--utility');
    const workflow = container.querySelector<HTMLElement>('.tab-command-group--workflow');

    expect(heading).toHaveClass('tab-page-header__title');
    expect(toolbar).toContainElement(utility);
    expect(toolbar).toContainElement(workflow);
    expect(screen.getByRole('button', { name: 'Open in Outlook' })).toHaveClass(
      'tactile-button--primary',
    );
    expect(screen.getByRole('button', { name: 'Save Image' })).toHaveClass(
      'alerts-save-image-action',
      'tactile-button--secondary',
    );
    expect(workflow).toContainElement(screen.getByRole('button', { name: 'Save Image' }));
    expect(workflow).toContainElement(screen.getByRole('button', { name: 'Open in Outlook' }));
    expect(workflow).toContainElement(screen.getByRole('button', { name: 'More Alert Actions' }));
    expect(utility).toContainElement(screen.getByRole('button', { name: 'History' }));
    expect(workflow).not.toContainElement(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByRole('button', { name: 'More Alert Actions' })).toHaveClass(
      'tactile-button',
      'tactile-button--icon-only',
    );
  });

  it('renders one divider between the Alert definition header and its first step', () => {
    const css = readCssBundle('tabs/alerts.css');
    const paneHeader = declarations(cssBlock(css, '.alerts-pane-header') ?? '');
    const step = declarations(cssBlock(css, '.alerts-step-section') ?? '');
    const firstStep = declarations(
      cssBlock(css, '.alerts-form-section > .alerts-step-section:first-child') ?? '',
    );

    expect(paneHeader.get('border-bottom')).toBe('1px solid var(--color-border)');
    expect(step.get('border-top')).toBe('1px solid var(--color-border)');
    expect(firstStep.get('border-top')).toBe('0');
  });

  it('keeps the two-pane Alerts grid within the shell content width down to its 900px stack breakpoint', () => {
    const alertsCss = readCssBundle('tabs/alerts.css');
    const responsiveCss = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/responsive.css'),
      'utf8',
    );
    const themeCss = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/styles/theme.css'),
      'utf8',
    );

    const alertsTab = declarations(cssBlock(alertsCss, '.alerts-tab') ?? '');
    const desktopGrid = declarations(cssBlock(alertsCss, '.alerts-layout') ?? '');
    const narrowGrid = declarations(
      cssBlock(mediaBlock(alertsCss, 'max-width: 1100px') ?? '', '.alerts-layout') ?? '',
    );
    const stackGrid = declarations(
      cssBlock(mediaBlock(alertsCss, 'max-width: 900px') ?? '', '.alerts-layout') ?? '',
    );
    const theme = declarations(cssBlock(themeCss, ':root') ?? '');
    const compactShell = declarations(
      cssBlock(mediaBlock(responsiveCss, 'max-width: 1200px') ?? '', ':root') ?? '',
    );

    const horizontalPadding = px(theme.get('--space-5')) * 2;
    const sumMinimums = (template: string | undefined) =>
      gridMinimums(template).reduce((total, minimum) => total + minimum, 0);
    const gridMinimumsPx = gridMinimums(desktopGrid.get('grid-template-columns'));
    const gridMinimumTotal = sumMinimums(desktopGrid.get('grid-template-columns'));
    const narrowMinimumTotal = sumMinimums(narrowGrid.get('grid-template-columns'));
    const compactSidebarWidth = px(compactShell.get('--sidebar-width-collapsed'));
    const expandedSidebarWidth = px(theme.get('--sidebar-width-collapsed'));

    expect(alertsTab.get('--page-gutter-x')).toBe('var(--space-5)');
    expect(alertsTab.get('padding')).toBe('var(--space-4) var(--page-gutter-x) 0');
    expect(gridMinimumsPx).toHaveLength(2);
    expect(stackGrid.get('grid-template-columns')).toBe('1fr');

    for (const { viewport, sidebarWidth } of [
      { viewport: 1101, sidebarWidth: compactSidebarWidth },
      { viewport: 1200, sidebarWidth: compactSidebarWidth },
      { viewport: 1201, sidebarWidth: expandedSidebarWidth },
    ]) {
      const twoPaneContentWidth = viewport - sidebarWidth - horizontalPadding;
      expect(gridMinimumTotal).toBeLessThanOrEqual(twoPaneContentWidth);
    }
    // Between the breakpoints the narrower two-pane minimums must still fit the compact shell.
    expect(narrowMinimumTotal).toBeLessThanOrEqual(901 - compactSidebarWidth - horizontalPadding);
  });

  it('docks the collapsed delivery step only on windows tall enough to keep the body in view', () => {
    const alertsCss = readCssBundle('tabs/alerts.css');
    const tallTwoPane = mediaBlock(alertsCss, 'min-width: 901px) and (min-height: 901px') ?? '';
    const docked = declarations(
      cssBlock(tallTwoPane, '\n  .alerts-optional-delivery:not([open]) {') ?? '',
    );

    expect(docked.get('position')).toBe('sticky');
    expect(docked.get('bottom')).toBe('0');
    expect(docked.get('background')).toBe('var(--color-bg-app)');

    // Short windows (1366×768) never dock it: the docked step would cover the message body.
    const shortWindows = mediaBlock(alertsCss, 'max-height: 900px') ?? '';
    expect(shortWindows).not.toContain('alerts-optional-delivery');
  });

  it('shows the readout only once the draft is ready, never a "Needs …" label', () => {
    const { container } = render(<AlertsTab />);

    fireEvent.click(screen.getByTestId('set-severity-issue'));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByTestId('set-subject'));
    expect(container.querySelector('.alerts-page-state-dot')).toBeNull();
    expect(screen.queryByText(/Needs/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('set-body'));
    expect(screen.getByText('Ready to export')).toBeInTheDocument();
    expect(container.querySelector('.alerts-page-state-dot')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/^Draft ready$/);
  });

  it('restores the unsent draft after a reload and forgets it on Reset', () => {
    const first = render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    first.unmount();

    const second = render(<AlertsTab />);
    expect(screen.getByTestId('card-subject-placeholder')).toHaveTextContent('false');
    expect(screen.queryByText('Ready to export')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    second.unmount();

    render(<AlertsTab />);
    expect(screen.getByTestId('card-subject-placeholder')).toHaveTextContent('true');
  });

  it('keeps the visible Alert action order aligned with keyboard focus order', () => {
    render(<AlertsTab />);
    const toolbar = screen.getByRole('toolbar', { name: 'Alert actions' });
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim()),
    ).toEqual(['History', 'Reset', 'Save Image', 'Open in Outlook', 'More Alert Actions']);
  });

  it('shows default sender and recipient on the alert card', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-sender')).toHaveTextContent('IT');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('All Employees');
  });

  it('previews no severity until the operator confirms one, never the INFO default', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-severity')).toHaveTextContent('null');
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
  });

  it('shows the default subject placeholder in the preview only', () => {
    render(<AlertsTab />);
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
    expect(screen.getByTestId('card-subject-placeholder')).toHaveTextContent('true');
    fireEvent.click(screen.getByTestId('set-subject'));
    expect(screen.getByTestId('card-subject-placeholder')).toHaveTextContent('false');
  });

  it('keeps both exports enabled without a "Needs …" description, before and after the draft is complete', () => {
    render(<AlertsTab />);
    const outlook = screen.getByRole('button', { name: 'Open in Outlook' });
    const save = screen.getByRole('button', { name: 'Save Image' });

    expect(outlook).toBeEnabled();
    expect(save).toBeEnabled();
    expect(outlook).not.toHaveAttribute('aria-describedby');
    expect(save).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/Needs/)).not.toBeInTheDocument();

    composeExportableAlert();
    expect(outlook).toBeEnabled();
    expect(save).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Alert definition' })).toHaveTextContent(
      'Ready to export',
    );
  });

  it('refuses a clicked export of an incomplete alert, naming what is missing and pointing at the first missing field', async () => {
    render(<AlertsTab />);
    mockCapture.html2canvas.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Open in Outlook' }));
    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'severity' });
    });
    expect(mockShowToast).toHaveBeenLastCalledWith(
      'Choose a severity and add a subject and message body before exporting',
      'error',
    );

    fireEvent.click(screen.getByTestId('set-severity-info'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Image' }));
    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'subject' });
    });
    expect(mockShowToast).toHaveBeenLastCalledWith(
      'Add a subject and message body before exporting',
      'error',
    );

    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByRole('button', { name: 'Open in Outlook' }));
    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'body' });
    });
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
    expect(globalThis.api?.saveAlertImage).not.toHaveBeenCalled();
    expect(globalThis.api?.saveAndOpenAlertDraft).not.toHaveBeenCalled();
    expect(mockAddHistory).not.toHaveBeenCalled();
  });

  it('refuses a shortcut export of an empty alert and points at the first missing field', async () => {
    render(<AlertsTab />);
    mockCapture.html2canvas.mockClear();

    fireEvent.keyDown(screen.getByTestId('alert-form'), { key: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'severity' });
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Choose a severity and add a subject and message body before exporting',
      'error',
    );

    fireEvent.click(screen.getByTestId('set-severity-info'));
    fireEvent.keyDown(screen.getByTestId('alert-form'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'subject' });
    });
    expect(mockShowToast).toHaveBeenLastCalledWith(
      'Add a subject and message body before exporting',
      'error',
    );

    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.keyDown(screen.getByTestId('alert-form'), { key: 's', metaKey: true });
    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'body' });
    });
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
    expect(globalThis.api?.saveAlertImage).not.toHaveBeenCalled();
    expect(globalThis.api?.saveAndOpenAlertDraft).not.toHaveBeenCalled();
    expect(mockAddHistory).not.toHaveBeenCalled();
  });

  it('exports with Mod+S and Mod+Enter from anywhere on the tab', async () => {
    render(<AlertsTab />);
    composeExportableAlert();

    fireEvent.keyDown(screen.getByTestId('alert-form'), { key: 's', metaKey: true });
    await waitFor(() => {
      expect(globalThis.api?.saveAlertImage).toHaveBeenCalledOnce();
    });

    fireEvent.keyDown(screen.getByTestId('alert-form'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(globalThis.api?.saveAndOpenAlertDraft).toHaveBeenCalledOnce();
    });
  });

  it('loads a pinned template from the template row', () => {
    mockHistory.current = [
      {
        id: 'pin-1',
        timestamp: 1,
        severity: 'MAINTENANCE',
        subject: 'Weekend patching',
        bodyHtml: '<p>Patch window</p>',
        sender: 'Ops',
        recipient: 'Staff',
        pinned: true,
        label: 'Patching',
      },
      {
        id: 'recent-1',
        timestamp: 2,
        severity: 'ISSUE',
        subject: 'Unpinned',
        bodyHtml: '',
        sender: '',
        recipient: '',
      },
    ];
    render(<AlertsTab />);

    const templates = screen.getByRole('navigation', { name: 'Pinned templates' });
    expect(
      within(templates)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Maintenance: Patching']);
    fireEvent.click(within(templates).getByRole('button', { name: 'Maintenance: Patching' }));

    expect(screen.getByTestId('card-severity')).toHaveTextContent('MAINTENANCE');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Weekend patching');
  });

  it('does not show history modal by default', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('history-modal')).not.toBeInTheDocument();
  });

  it('does not show pin template modal by default', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('modal-Pin template')).not.toBeInTheDocument();
  });

  it('displays update number prefix in subject when updateNumber > 0', () => {
    // The AlertCard mock receives displaySubject which is computed from updateNumber
    // Default state has updateNumber 0, so subject should be 'Alert Subject'
    render(<AlertsTab />);
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
    // No "UPDATE" prefix in the default state
    expect(screen.getByTestId('card-subject').textContent).not.toContain('UPDATE');
  });

  it('loads logo from api on mount', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getCompanyLogo as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,LOGO',
    );
    render(<AlertsTab />);
    // The getCompanyLogo should have been called
    expect(api.getCompanyLogo).toHaveBeenCalled();
  });

  it('loads footer logo from api on mount', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getFooterLogo as ReturnType<typeof vi.fn>).mockResolvedValue(
      'data:image/png;base64,FLOGO',
    );
    render(<AlertsTab />);
    expect(api.getFooterLogo).toHaveBeenCalled();
  });

  it('handles logo load failure gracefully', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getCompanyLogo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    // Should not throw
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('handles footer logo load failure gracefully', async () => {
    const api = globalThis.api as Record<string, unknown>;
    (api.getFooterLogo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('handles missing api gracefully', () => {
    (globalThis as Record<string, unknown>).api = undefined;
    expect(() => render(<AlertsTab />)).not.toThrow();
  });

  it('keeps Reset visible and enables it once something is composed', () => {
    render(<AlertsTab />);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('set-sender'));
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  // eslint-disable-next-line sonarjs/parameterized-tests -- Each action verifies a distinct workflow, state transition, and rendered result.
  it('exposes Pin Template in the overflow and keeps it clickable', () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    expect(screen.getByTestId('modal-Pin template')).toBeInTheDocument();
  });

  it('clicking SAVE IMAGE saves the high-resolution PNG capture', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    const saveBtn = screen.getByText('Save Image');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(globalThis.api?.saveAlertImage).toHaveBeenCalledWith(
        'data:image/png;base64,HIGH_RES_CAPTURE',
        'alert_test_subject.png',
      );
    });
    expect(mockCapture.html2canvas).toHaveBeenCalledWith(
      expect.objectContaining({
        style: expect.objectContaining({
          minWidth: '640px',
          maxWidth: '640px',
        }),
      }),
      expect.objectContaining({ scale: 2 }),
    );
  });

  it('opens a 2x inline-image Outlook draft at an explicit 640px display size', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(globalThis.api?.saveAndOpenAlertDraft).toHaveBeenCalledTimes(1);
    });
    expect(mockCapture.html2canvas).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ scale: 2 }),
    );

    const eml = vi.mocked(globalThis.api!.saveAndOpenAlertDraft!).mock.calls[0]?.[0] ?? '';
    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toContain('Subject: Test Subject');
    expect(eml).not.toMatch(/(^|\r\n)From:/);
    expect(eml).not.toMatch(/(^|\r\n)To:/);
    expect(eml).toContain('Content-ID: <relay-alert-image>');
    const html = decodeEmlPart(eml, 'text/html');
    expect(html).toContain('width="640" height="600"');
  });

  it('exports the alert fields shown on the card as readable message content', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));
    fireEvent.click(screen.getByTestId('set-recipient'));
    fireEvent.click(screen.getByTestId('set-update-number'));
    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(globalThis.api?.saveAndOpenAlertDraft).toHaveBeenCalledTimes(1);
    });
    const eml = vi.mocked(globalThis.api!.saveAndOpenAlertDraft!).mock.calls[0]?.[0] ?? '';
    const text = decodeEmlPart(eml, 'text/plain');
    for (const expected of [
      'ALERT ISSUE',
      'UPDATE #2',
      'Test Subject',
      'body',
      'Security',
      'Managers',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('downloads an EML with browser-specific action text in the web runtime', async () => {
    (globalThis.api as Record<string, unknown>).runtime = WEB_RUNTIME;
    render(<AlertsTab />);
    composeExportableAlert();

    fireEvent.click(screen.getByText('Download Draft'));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'relay-alert.eml download started — open it in Outlook, review recipients, and send.',
        'success',
      );
    });
    expect(globalThis.api?.saveAndOpenAlertDraft).toHaveBeenCalledOnce();
  });

  it('uses the sanitized click-through URL for the card and readable HTML link', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    fireEvent.click(screen.getByTestId('set-click-through-url'));
    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(globalThis.api?.saveAndOpenAlertDraft).toHaveBeenCalledTimes(1);
    });
    const eml = vi.mocked(globalThis.api!.saveAndOpenAlertDraft!).mock.calls[0]?.[0] ?? '';
    const html = decodeEmlPart(eml, 'text/html');
    const anchors = Array.from(
      new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a'),
    );
    expect(anchors.map((anchor) => anchor.href)).toEqual([
      'https://status.example.com/incident',
      'https://status.example.com/incident',
    ]);
    expect(anchors.some((anchor) => anchor.textContent === 'More information')).toBe(true);
    expect(anchors.some((anchor) => anchor.querySelector('img'))).toBe(true);
  });

  it('blocks an unsafe click-through URL before capturing or opening Outlook', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    fireEvent.click(screen.getByTestId('set-unsafe-click-through-url'));
    mockCapture.html2canvas.mockClear();
    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'Enter a valid HTTP or HTTPS click-through URL',
        'error',
      );
    });
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
    expect(globalThis.api?.saveAndOpenAlertDraft).not.toHaveBeenCalled();
  });

  it('requests click-through attention before an invalid Outlook export', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    fireEvent.click(screen.getByTestId('set-unsafe-click-through-url'));
    mockCapture.html2canvas.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Outlook' }));

    await waitFor(() => {
      expect(lastAlertFormProps?.attentionRequest).toMatchObject({ field: 'clickThroughUrl' });
    });
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Enter a valid HTTP or HTTPS click-through URL',
      'error',
    );
  });

  it('resolves banner colors in the shared capture clone before rendering', async () => {
    render(<AlertsTab />);
    composeExportableAlert();
    fireEvent.click(screen.getByTestId('set-severity-issue'));

    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(mockCapture.html2canvas).toHaveBeenCalled();
    });
    const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;
    const header = clone.querySelector('.alerts-email-severity-header') as HTMLElement;

    expect(header.style.background).not.toContain('var(');
    expect(header.style.backgroundColor).toBe('rgb(211, 47, 47)');
    expect(clone.style.borderColor).toBe('rgb(211, 47, 47)');
  });

  it.each([
    ['ISSUE', 'set-severity-issue', 'rgb(211, 47, 47)'],
    ['MAINTENANCE', 'set-severity-maintenance', 'rgb(249, 168, 37)'],
    ['INFO', 'set-severity-info', 'rgb(21, 101, 192)'],
    ['RESOLVED', 'set-severity-resolved', 'rgb(46, 125, 50)'],
  ])(
    'resolves %s capture colors for Teams, Discord, and Outlook paste targets',
    async (_severity, testId, expectedColor) => {
      render(<AlertsTab />);
      composeExportableAlert();
      fireEvent.click(screen.getByTestId(testId));

      fireEvent.click(screen.getByText('Open in Outlook'));

      await waitFor(() => {
        expect(mockCapture.html2canvas).toHaveBeenCalled();
      });
      const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;
      const header = clone.querySelector('.alerts-email-severity-header') as HTMLElement;
      const icon = clone.querySelector('.alerts-email-icon') as HTMLElement;

      expect(header.style.backgroundColor).toBe(expectedColor);
      expect(clone.style.borderColor).toBe(expectedColor);
      expect(icon.style.borderColor).toBe(expectedColor);
    },
  );

  it('paints alert capture surfaces so Teams and Discord do not show grey transparency', async () => {
    render(<AlertsTab />);
    composeExportableAlert();

    fireEvent.click(screen.getByText('Open in Outlook'));

    await waitFor(() => {
      expect(mockCapture.html2canvas).toHaveBeenCalled();
    });
    const clone = mockCapture.html2canvas.mock.calls.at(-1)?.[0] as HTMLElement;

    expect(clone.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect((clone.querySelector('.alerts-email-header') as HTMLElement).style.backgroundColor).toBe(
      'rgb(255, 255, 255)',
    );
    expect((clone.querySelector('.alerts-email-body') as HTMLElement).style.backgroundColor).toBe(
      'rgb(255, 255, 255)',
    );
    const iconWrapper = clone.querySelector('.alerts-email-icon-wrapper') as HTMLElement;
    const iconWrapperFill = iconWrapper.querySelector(
      '.alerts-email-icon-wrapper-fill',
    ) as HTMLElement;
    const icon = clone.querySelector('.alerts-email-icon') as HTMLElement;
    const iconFill = icon.querySelector('.alerts-email-icon-fill') as HTMLElement;
    const iconSvg = icon.querySelector('svg') as SVGElement;
    expect(iconWrapper.style.background).toBe('');
    expect(iconWrapper.style.backgroundColor).toBe('');
    expect(iconWrapperFill.style.top).toBe('26px');
    expect(iconWrapperFill.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(iconFill.style.inset).toBe('0px');
    expect(iconFill.style.borderRadius).toBe('50%');
    expect(iconFill.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(icon.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(icon.style.position).toBe('relative');
    expect(icon.style.zIndex).toBe('1');
    expect(iconSvg.style.position).toBe('relative');
    expect(iconSvg.style.zIndex).toBe('1');
    expect((clone.querySelector('.alerts-email-meta') as HTMLElement).style.backgroundColor).toBe(
      'rgb(250, 250, 250)',
    );
    expect((clone.querySelector('.alerts-email-footer') as HTMLElement).style.backgroundColor).toBe(
      'rgb(250, 250, 250)',
    );
  });

  it('opens the reminder time picker without copying from the alarm button', async () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));

    chooseAlertAction('Schedule Alarm');

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Security');
    expect(mockCapture.html2canvas).not.toHaveBeenCalled();
  });

  it('clicking HISTORY button calls open on the modal state', () => {
    render(<AlertsTab />);
    openAlertHistory();
    expect(screen.getByTestId('history-modal')).toBeInTheDocument();
  });

  it('opens reminder modal with current draft context', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));

    chooseAlertAction('Alarms');
    fireEvent.click(screen.getByTestId('manager-schedule'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Security');
  });

  it('loads an attached reminder alert into the composer', async () => {
    render(
      <AlertsTab
        loadedReminderAlert={{
          reminderId: 'rem-1',
          title: 'Stored reminder',
          severity: 'ISSUE',
          subject: 'Stored outage alert',
          bodyHtml: '<p>Stored body</p>',
          sender: 'Ops',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
    });
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Stored outage alert');
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>Stored body</p>');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Ops');
    expect(mockShowToast).toHaveBeenCalledWith(
      'Loaded "Stored outage alert" from the alarm',
      'success',
      undefined,
    );

    chooseAlertAction('Schedule Alarm');

    expect(screen.getByTestId('reminder-draft-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('reminder-draft-subject')).toHaveTextContent('Stored outage alert');
    expect(screen.getByTestId('reminder-draft-body')).toHaveTextContent('<p>Stored body</p>');
    expect(screen.getByTestId('reminder-draft-sender')).toHaveTextContent('Ops');
  });

  it('schedules a new reminder without operator attribution', async () => {
    render(<AlertsTab />);
    chooseAlertAction('Alarms');
    fireEvent.click(screen.getByTestId('manager-schedule'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('reminder-schedule'));

    await waitFor(() => {
      expect(mockScheduleReminder).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Scheduled reminder' }),
      );
    });
  });

  it('opens the schedule modal without an operator provider', () => {
    render(<AlertsTab />);
    chooseAlertAction('Schedule Alarm');

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
  });

  it('shows the next upcoming reminder compactly', () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'Send maintenance alert', dueAt: '2099-05-28T20:00:00.000Z' },
    ];

    render(<AlertsTab />);

    expect(screen.getByText('Next alarm')).toBeInTheDocument();
    expect(screen.getByText('Send maintenance alert')).toBeInTheDocument();
  });

  it('labels a due alarm as overdue', () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'Send outage update', dueAt: '2020-01-01T00:00:00.000Z' },
    ];

    render(<AlertsTab />);

    expect(screen.getByText('Overdue alarm')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Overdue alarm: Send outage update, / }),
    ).toHaveClass('is-overdue');
  });

  it('shows a count when more pending reminders exist and opens the manager from the strip', () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'First reminder', dueAt: '2099-05-28T20:00:00.000Z' },
      { id: 'rem-2', title: 'Second reminder', dueAt: '2099-05-28T21:00:00.000Z' },
      { id: 'rem-3', title: 'Third reminder', dueAt: '2099-05-28T22:00:00.000Z' },
    ];

    render(<AlertsTab />);

    expect(screen.getByText('+2 more')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /^Next alarm: First reminder, .*, \+2 more$/ }),
    );
    expect(screen.getByTestId('reminder-manager-modal')).toBeInTheDocument();
    expect(screen.getByTestId('manager-count')).toHaveTextContent('3');
  });

  it('opens the reminder manager from the header action', () => {
    render(<AlertsTab />);

    chooseAlertAction('Alarms');

    expect(screen.getByTestId('reminder-manager-modal')).toBeInTheDocument();
  });

  it('opens edit mode from the reminder manager and routes manager actions', async () => {
    mockPendingReminders.current = [
      { id: 'rem-1', title: 'Editable reminder', dueAt: '2026-05-28T20:00:00.000Z' },
    ];

    render(<AlertsTab />);
    chooseAlertAction('Alarms');
    fireEvent.click(screen.getByTestId('manager-edit'));

    expect(screen.getByTestId('reminder-modal')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-modal-mode')).toHaveTextContent('edit');
    expect(screen.getByTestId('reminder-edit-title')).toHaveTextContent('Editable reminder');

    chooseAlertAction('Alarms');
    fireEvent.click(screen.getByTestId('manager-done'));
    fireEvent.click(screen.getByTestId('manager-dismiss'));

    expect(mockMarkDone).toHaveBeenCalledWith('rem-1');
    expect(mockDismissReminder).toHaveBeenCalledWith('rem-1');
  });

  it('edits an existing reminder without requiring or replacing its creator attribution', async () => {
    mockPendingReminders.current = [
      {
        id: 'rem-1',
        title: 'Editable reminder',
        dueAt: '2026-05-28T20:00:00.000Z',
        operatorId: 'operator-original',
        createdBy: 'Original Operator',
      },
    ];

    render(<AlertsTab />);
    chooseAlertAction('Alarms');
    fireEvent.click(screen.getByTestId('manager-edit'));
    fireEvent.click(screen.getByTestId('reminder-schedule'));

    await waitFor(() => {
      expect(mockUpdateReminder).toHaveBeenCalledWith('rem-1', {
        title: 'Scheduled reminder',
        note: 'Reminder note',
        dueAt: '2026-05-28T20:00:00.000Z',
      });
    });
    expect(mockScheduleReminder).not.toHaveBeenCalled();
  });

  it('renders with null logo by default on the card', () => {
    render(<AlertsTab />);
    // AlertCard mock doesn't show logos, but we verify no crash
    expect(screen.getByTestId('alert-card')).toBeInTheDocument();
  });

  // --- Severity & form field dispatch tests ---

  it('changes severity via AlertForm callback', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
  });

  it('changes severity to RESOLVED', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-resolved'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('RESOLVED');
  });

  it('updates subject via form callback and reflects in card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Test Subject');
  });

  it('updates sender and displays it on the card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-sender'));
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Security');
  });

  it('updates recipient and displays it on the card', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-recipient'));
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('Managers');
  });

  it('does not expose retired alert font size controls or props', () => {
    render(<AlertsTab />);

    expect(screen.queryByTestId('set-alert-font-large')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-retired-font-size-props')).toHaveTextContent('false');
    expect(screen.getByTestId('card-retired-font-size-prop')).toHaveTextContent('false');
  });

  it('shows UPDATE prefix in subject when updateNumber > 0', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-update-number'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('UPDATE #2');
  });

  it('shows UPDATE prefix combined with custom subject', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-update-number'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('UPDATE #2 — Test Subject');
  });

  it('does not expose retired compact or enhance controls to the alert form', () => {
    render(<AlertsTab />);
    expect(screen.queryByTestId('toggle-compact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toggle-enhanced')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-retired-transform-props')).toHaveTextContent('false');
  });

  // --- History modal interactions ---

  it('opens history modal when HISTORY button is clicked', () => {
    render(<AlertsTab />);
    openAlertHistory();
    expect(screen.getByTestId('history-modal')).toBeInTheDocument();
  });

  it('loads from history and updates form state', () => {
    render(<AlertsTab />);
    openAlertHistory();
    fireEvent.click(screen.getByTestId('history-load'));
    expect(screen.getByTestId('card-severity')).toHaveTextContent('MAINTENANCE');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Loaded Subject');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('Ops');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('Staff');
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>loaded</p>');
    expect(screen.getByTestId('form-body-html')).toHaveTextContent('<p>loaded</p>');
  });

  it('deletes an entry that is no longer in history without an undo window', () => {
    render(<AlertsTab />);
    openAlertHistory();
    fireEvent.click(screen.getByTestId('history-delete'));
    expect(mockDeleteHistory).toHaveBeenCalledWith('del-1');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  describe('history delete with undo', () => {
    const pinnedEntry = {
      id: 'del-1',
      timestamp: 1,
      severity: 'MAINTENANCE',
      subject: 'Weekend patching',
      bodyHtml: '<p>Patch window</p>',
      sender: 'Ops',
      recipient: 'Staff',
      pinned: true,
      label: 'Patching',
    };

    function deleteAndGetUndo(): () => void {
      openAlertHistory();
      fireEvent.click(screen.getByTestId('history-delete'));
      const toastCall = mockShowToast.mock.calls.at(-1) as
        [string, string, { action: { label: string; onClick: () => void } }] | undefined;
      expect(toastCall?.[2].action.label).toBe('Undo');
      return toastCall![2].action.onClick;
    }

    beforeEach(() => {
      vi.useFakeTimers();
      mockHistory.current = [pinnedEntry];
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('hides the entry at once and restores it when Undo is pressed in the window', () => {
      render(<AlertsTab />);
      expect(screen.getByRole('navigation', { name: 'Pinned templates' })).toBeInTheDocument();

      const undo = deleteAndGetUndo();
      expect(screen.queryByRole('navigation', { name: 'Pinned templates' })).toBeNull();
      expect(mockDeleteHistory).not.toHaveBeenCalled();

      act(() => undo());
      expect(screen.getByRole('button', { name: /^\w+: Patching$/ })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(HISTORY_DELETE_UNDO_MS + 1);
      });
      expect(mockDeleteHistory).not.toHaveBeenCalled();
      expect(mockAddHistory).not.toHaveBeenCalled();
    });

    it('commits the delete after the undo window and re-adds the entry on a late Undo', () => {
      render(<AlertsTab />);
      const undo = deleteAndGetUndo();

      act(() => {
        vi.advanceTimersByTime(HISTORY_DELETE_UNDO_MS);
      });
      expect(mockDeleteHistory).toHaveBeenCalledWith('del-1');

      act(() => undo());
      expect(mockAddHistory).toHaveBeenCalledWith({
        severity: 'MAINTENANCE',
        subject: 'Weekend patching',
        bodyHtml: '<p>Patch window</p>',
        sender: 'Ops',
        recipient: 'Staff',
        pinned: true,
        label: 'Patching',
      });
    });

    it('commits a pending delete when the tab unmounts', () => {
      const { unmount } = render(<AlertsTab />);
      deleteAndGetUndo();
      expect(mockDeleteHistory).not.toHaveBeenCalled();

      unmount();
      expect(mockDeleteHistory).toHaveBeenCalledWith('del-1');
    });
  });

  describe('clear all history with undo', () => {
    const entries = [
      {
        id: 'h-1',
        timestamp: 2,
        severity: 'ISSUE',
        subject: 'Outage',
        bodyHtml: '<p>Down</p>',
        sender: 'IT',
        recipient: 'All',
        pinned: false,
      },
      {
        id: 'h-2',
        timestamp: 1,
        severity: 'INFO',
        subject: 'Weekend patching',
        bodyHtml: '<p>Patch</p>',
        sender: 'Ops',
        recipient: 'Staff',
        pinned: true,
        label: 'Patching',
      },
    ];

    type ClearToastOptions = {
      action: { label: string; onClick: () => void };
      onDismiss: () => void;
    };

    function clearAndGetToast(): [string, ClearToastOptions] {
      openAlertHistory();
      fireEvent.click(screen.getByTestId('history-clear'));
      const toastCall = mockShowToast.mock.calls.at(-1) as
        [string, string, ClearToastOptions] | undefined;
      expect(toastCall?.[2].action.label).toBe('Undo');
      return [toastCall![0], toastCall![2]];
    }

    beforeEach(() => {
      mockHistory.current = entries;
      mockDeleteHistoryEntries.mockResolvedValue(['h-1', 'h-2']);
    });

    it('hides every entry at once and restores them on Undo without deleting', () => {
      render(<AlertsTab />);
      const [message, options] = clearAndGetToast();
      expect(message).toBe('Cleared alert history (2 entries)');
      expect(screen.queryByRole('navigation', { name: 'Pinned templates' })).toBeNull();

      act(() => options.action.onClick());
      expect(screen.getByRole('button', { name: /^\w+: Patching$/ })).toBeInTheDocument();
      expect(mockDeleteHistoryEntries).not.toHaveBeenCalled();
    });

    it('deletes exactly the cleared entries when the toast leaves without Undo', () => {
      render(<AlertsTab />);
      const [, options] = clearAndGetToast();
      act(() => options.onDismiss());
      expect(mockDeleteHistoryEntries).toHaveBeenCalledWith(['h-1', 'h-2']);
    });

    it('re-adds the deleted entries on an Undo that arrives after the commit', async () => {
      const { unmount } = render(<AlertsTab />);
      const [, options] = clearAndGetToast();
      unmount();
      expect(mockDeleteHistoryEntries).toHaveBeenCalledWith(['h-1', 'h-2']);

      options.action.onClick();
      await waitFor(() => expect(mockAddHistory).toHaveBeenCalledTimes(2));
      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Weekend patching', pinned: true, label: 'Patching' }),
      );
    });
  });

  // --- Pin template modal ---

  it('opens pin template modal and shows template name input', () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    expect(screen.getByTestId('modal-Pin template')).toBeInTheDocument();
    expect(screen.getByTestId('modal-Pin template')).toHaveAttribute(
      'data-variant',
      'confirmation',
    );
    expect(screen.getByLabelText('Template name')).toBeInTheDocument();
  });

  it('pin template modal defaults to Untitled Template when subject is empty', () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    expect(screen.getByLabelText('Template name')).toHaveValue('Untitled Template');
  });

  it('pin template modal uses subject as default name', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    chooseAlertAction('Pin Template');
    expect(screen.getByLabelText('Template name')).toHaveValue('Test Subject');
  });

  it('can change pin template name and confirm', async () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    const input = screen.getByLabelText('Template name');
    fireEvent.change(input, { target: { value: 'My Custom Template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin Template' }));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({ pinned: true, label: 'My Custom Template' }),
      );
    });
  });

  it('pin template confirm with empty label sends undefined label', async () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    const input = screen.getByLabelText('Template name');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pin Template' }));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(
        expect.objectContaining({ pinned: true, label: undefined }),
      );
    });
  });

  it('pin template can be confirmed with Enter key', async () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    const input = screen.getByLabelText('Template name');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }));
    });
  });

  it('pin template Cancel closes the modal', () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    expect(screen.getByTestId('modal-Pin template')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('modal-Pin template')).not.toBeInTheDocument();
  });

  it('pin template confirm shows toast on success', async () => {
    mockAddHistory.mockResolvedValueOnce({ id: 'pin-1' });
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    fireEvent.click(screen.getByRole('button', { name: 'Pin Template' }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Pinned ".+" as a template$/),
        'success',
      );
    });
  });

  it('pin template confirm shows error toast on failure', async () => {
    mockAddHistory.mockRejectedValueOnce(new Error('fail'));
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    fireEvent.click(screen.getByRole('button', { name: 'Pin Template' }));
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringMatching(
          /^Couldn't pin ".+" as a template\. Fail\. Your draft is unchanged\. Try again\.$/,
        ),
        'error',
      );
    });
  });

  it('pin template confirm with null entry does not show success toast', async () => {
    mockAddHistory.mockResolvedValueOnce(null);
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    fireEvent.click(screen.getByRole('button', { name: 'Pin Template' }));
    await waitFor(() => {
      expect(mockAddHistory).toHaveBeenCalled();
    });
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Pinned ".+" as a template$/),
      'success',
    );
  });

  // --- Reset button ---

  it('reset clears form state at once and Undo restores the whole draft', () => {
    render(<AlertsTab />);
    // Change state
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-sender'));
    // Reset needs no confirm: the draft stays recoverable through the toast's Undo.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByTestId('modal-Reset Alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-severity')).toHaveTextContent('null');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Alert Subject');
    expect(screen.getByTestId('card-sender')).toHaveTextContent('IT');
    expect(screen.getByTestId('card-recipient')).toHaveTextContent('All Employees');
    expect(screen.getByTestId('card-body')).toBeEmptyDOMElement();
    expect(screen.getByTestId('form-body-html')).toBeEmptyDOMElement();

    const toastCall = mockShowToast.mock.calls.at(-1) as
      [string, string, { action: { label: string; onClick: () => void } }] | undefined;
    expect(toastCall?.[0]).toBe('Reset "Test Subject"');
    expect(toastCall?.[2].action.label).toBe('Undo');

    act(() => toastCall![2].action.onClick());
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>body</p>');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  it('does not count a confirmed default severity as a composition to discard', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-info'));

    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    openAlertHistory();
    fireEvent.click(screen.getByTestId('history-load'));
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Loaded Subject');
    // Nothing was being composed, so there is nothing to undo.
    expect(mockShowToast).toHaveBeenLastCalledWith(
      'Loaded "Loaded Subject" from history',
      'success',
      undefined,
    );
  });

  it('loads a history alert over a composition at once and Undo restores the draft', () => {
    render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-severity-issue'));
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));

    openAlertHistory();
    fireEvent.click(screen.getByTestId('history-load'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Loaded Subject');
    expect(screen.getByTestId('card-severity')).toHaveTextContent('MAINTENANCE');
    // A saved alert carries a real severity, so it counts as chosen.
    expect(screen.getByText('Ready to export')).toBeInTheDocument();

    const toastCall = mockShowToast.mock.calls.at(-1) as
      [string, string, { action: { label: string; onClick: () => void } }] | undefined;
    expect(toastCall?.[0]).toBe('Loaded "Loaded Subject" from history');
    expect(toastCall?.[2].action.label).toBe('Undo');

    act(() => toastCall![2].action.onClick());
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('card-body')).toHaveTextContent('<p>body</p>');
  });

  it('loads an alarm over a composition at once and Undo restores the draft', async () => {
    const loadedReminderAlert = {
      reminderId: 'rem-1',
      title: 'Stored reminder',
      severity: 'ISSUE' as const,
      subject: 'Stored outage alert',
      bodyHtml: '<p>Stored body</p>',
      sender: 'Ops',
    };

    const { rerender } = render(<AlertsTab />);
    fireEvent.click(screen.getByTestId('set-subject'));
    fireEvent.click(screen.getByTestId('set-body'));
    fireEvent.click(screen.getByTestId('set-event-times'));
    rerender(<AlertsTab loadedReminderAlert={loadedReminderAlert} />);

    await waitFor(() => {
      expect(screen.getByTestId('card-subject')).toHaveTextContent('Stored outage alert');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-severity')).toHaveTextContent('ISSUE');
    expect(screen.getByTestId('form-event-times')).toBeEmptyDOMElement();

    const toastCall = mockShowToast.mock.calls.at(-1) as
      [string, string, { action: { label: string; onClick: () => void } }] | undefined;
    expect(toastCall?.[0]).toBe('Loaded "Stored outage alert" from the alarm');
    expect(toastCall?.[2].action.label).toBe('Undo');

    act(() => toastCall![2].action.onClick());
    expect(screen.getByTestId('card-subject')).toHaveTextContent('Test Subject');
    expect(screen.getByTestId('form-event-times')).not.toBeEmptyDOMElement();
  });

  // --- Non-enter keydown on pin template input ---

  it('non-Enter keydown on pin template input does not confirm', () => {
    render(<AlertsTab />);
    chooseAlertAction('Pin Template');
    const input = screen.getByLabelText('Template name');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Modal should still be open, addHistory should not be called
    expect(screen.getByTestId('modal-Pin template')).toBeInTheDocument();
    expect(mockAddHistory).not.toHaveBeenCalled();
  });
});
