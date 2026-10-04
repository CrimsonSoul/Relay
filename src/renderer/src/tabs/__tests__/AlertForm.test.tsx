import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readCssBundle } from '../../styles/readCssBundle.test-util';
import { AlertForm as BaseAlertForm, type AlertFormProps } from '../AlertForm';
import {
  AlertDraftProvider,
  initialAlertDraftState,
  type AlertDraftState,
} from '../alerts/AlertDraftContext';

// --- Mocks ---

vi.mock('../alerts/AlertSeveritySelector', () => ({
  AlertSeveritySelector: ({
    severity,
    setSeverity,
  }: {
    severity: string;
    setSeverity: (s: string) => void;
  }) => (
    <div data-testid="severity-selector">
      <span>{severity}</span>
      <button onClick={() => setSeverity('MAINTENANCE')}>change-severity</button>
    </div>
  ),
}));

vi.mock('../alerts/AlertBodyEditor', () => ({
  AlertBodyEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <div data-testid="body-editor">
      <span data-testid="body-editor-value">{value}</span>
      <button onClick={() => onChange('<p>test</p>')}>set-body</button>
    </div>
  ),
}));

const defaultProps = {
  severity: 'ISSUE' as const,
  subject: '',
  bodyHtml: '',
  sender: '',
  recipient: '',
  clickThroughUrl: '',
  updateNumber: 0,
  eventTimeStart: '',
  eventTimeEnd: '',
  eventTimeSourceTz: 'America/Chicago',
  logoDataUrl: null,
  onSetLogo: vi.fn(),
  onRemoveLogo: vi.fn(),
  footerLogoDataUrl: null,
  onSetFooterLogo: vi.fn(),
  onRemoveFooterLogo: vi.fn(),
};

type AlertFormHarnessProps = AlertFormProps & Partial<AlertDraftState> & Record<string, unknown>;

const AlertForm: React.FC<AlertFormHarnessProps> = ({
  severity = defaultProps.severity,
  subject = defaultProps.subject,
  bodyHtml = defaultProps.bodyHtml,
  sender = defaultProps.sender,
  recipient = defaultProps.recipient,
  clickThroughUrl = defaultProps.clickThroughUrl,
  updateNumber = defaultProps.updateNumber,
  eventTimeStart = defaultProps.eventTimeStart,
  eventTimeEnd = defaultProps.eventTimeEnd,
  eventTimeSourceTz = defaultProps.eventTimeSourceTz,
  logoDataUrl,
  onSetLogo,
  onRemoveLogo,
  footerLogoDataUrl,
  onSetFooterLogo,
  onRemoveFooterLogo,
  attentionRequest,
}) => {
  const draftState = {
    ...initialAlertDraftState,
    severity,
    subject,
    bodyHtml,
    sender,
    recipient,
    clickThroughUrl,
    updateNumber,
    eventTimeStart,
    eventTimeEnd,
    eventTimeSourceTz,
  };

  return (
    <AlertDraftProvider key={JSON.stringify(draftState)} initialState={draftState}>
      <BaseAlertForm
        logoDataUrl={logoDataUrl}
        onSetLogo={onSetLogo}
        onRemoveLogo={onRemoveLogo}
        footerLogoDataUrl={footerLogoDataUrl}
        onSetFooterLogo={onSetFooterLogo}
        onRemoveFooterLogo={onRemoveFooterLogo}
        attentionRequest={attentionRequest}
      />
    </AlertDraftProvider>
  );
};

describe('AlertForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the base font for alert form labels and controls', () => {
    const css = readCssBundle('tabs/alerts.css');
    const baseFontSelectors = [
      '.alerts-step-index',
      '.alerts-step-status',
      '.alerts-delivery-group-title',
      '.alerts-branding-summary::after',
      '.alerts-sev-btn',
      '.alerts-update-toggle',
      '.alerts-stepper-value',
      '.alerts-hl-popover-label',
      '.alerts-hl-popover-key',
    ];

    for (const selector of baseFontSelectors) {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'm').exec(css);
      expect(match?.[0]).not.toContain('var(--font-family-mono)');
    }
  });

  it('keeps guided step numbers neutral instead of accent-coloured', () => {
    const css = readCssBundle('tabs/alerts.css');
    const stepIndex = /\.alerts-step-index\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(stepIndex).toContain('color: var(--color-text-secondary)');
    expect(stepIndex).toContain('background: var(--color-hover-overlay-strong)');
    expect(stepIndex).not.toMatch(/border(-color)?:/);
    expect(stepIndex).not.toContain('accent');
  });

  it('gives each unchecked severity option its pip shape in its severity colour', () => {
    const css = readCssBundle('tabs/alerts.css');
    const pip = /\.alerts-sev-btn::before\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';

    expect(pip).toContain("content: ''");
    expect(pip).toContain('border: 2px solid var(--sev-pip, var(--sev-color))');
    expect(pip).toContain('border-radius: 50%');
    expect(css).toMatch(
      /\.alerts-sev-btn\[data-sev='ISSUE'\]::before\s*\{[^}]*border-radius: 0;[^}]*background: var\(--sev-pip, var\(--sev-color\)\)/,
    );
    expect(css).toMatch(
      /\.alerts-sev-btn\[data-sev='MAINTENANCE'\]::before\s*\{[^}]*clip-path: polygon\(50% 0, 100% 50%, 50% 100%, 0 50%\)/,
    );
    expect(css).not.toMatch(/\.alerts-sev-btn\[data-sev='INFO'\]::before/);
    expect(css).toMatch(
      /\.alerts-sev-btn\.active\[data-sev\]\s*\{[^}]*--sev-pip: var\(--on-alarm\)/,
    );
  });

  it('dims the body placeholder to match the subject placeholder', () => {
    const css = readCssBundle('tabs/alerts.css');
    const placeholder =
      /\.alerts-input::placeholder,\s*\.alerts-editable-body:empty::before\s*\{[^}]*\}/m.exec(
        css,
      )?.[0];

    expect(placeholder).toContain('color: var(--color-text-tertiary)');
  });

  it('keeps select arrows and collapsed branding controls comfortably spaced', () => {
    const css = readCssBundle('tabs/alerts.css');
    const inputFocus = /\.alerts-input:focus-visible\s*\{[^}]*\}/m.exec(css)?.[0];
    const timezoneSelect = /\.alerts-event-time-tz\s*\{[^}]*\}/m.exec(css)?.[0];
    const brandingToggle = /\.alerts-branding-summary::after\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(inputFocus).toContain('background-color: var(--color-bg-surface)');
    expect(inputFocus).not.toContain('background:');
    expect(inputFocus).toContain('outline: 3px solid var(--accent-bright)');
    expect(inputFocus).not.toContain('outline: none');
    expect(timezoneSelect).toContain('padding-right: var(--field-chevron-inset)');
    expect(timezoneSelect).toContain('appearance: none');
    expect(timezoneSelect).toContain('background-image: var(--field-chevron)');
    expect(brandingToggle).toContain('border-radius: var(--radius-control)');
  });

  it('renders the severity selector', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByTestId('severity-selector')).toBeInTheDocument();
  });

  it('renders the guided alert creation sections', () => {
    render(<AlertForm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Choose severity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Write the message' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add delivery details' })).toBeInTheDocument();
  });

  it('keeps branding controls collapsed by default', () => {
    render(<AlertForm {...defaultProps} />);

    const brandingGroup = screen.getByText('Branding options').closest('details');
    expect(brandingGroup).toBeInTheDocument();
    expect(brandingGroup).not.toHaveAttribute('open');
  });

  it('uses one optional marker for the delivery section', () => {
    render(<AlertForm {...defaultProps} />);

    const deliveryStep = screen.getByRole('group', { name: 'Optional delivery details' });
    expect(within(deliveryStep).getAllByText('Optional')).toHaveLength(1);
  });

  it('collapses optional delivery details by default and omits unconfigured categories', () => {
    render(<AlertForm {...defaultProps} />);
    const disclosure = screen.getByRole('group', { name: 'Optional delivery details' });

    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.queryByText('Routing configured')).toBeNull();
    expect(screen.queryByText('Link ready')).toBeNull();
    expect(screen.queryByText('Timing configured')).toBeNull();
    expect(screen.queryByText('Branding customized')).toBeNull();
  });

  it('shows the default audience outside the collapsed delivery details when To is empty', () => {
    const { container, rerender } = render(<AlertForm {...defaultProps} recipient="" />);
    const disclosure = screen.getByRole('group', { name: 'Optional delivery details' });
    const audience = container.querySelector(
      '.alerts-optional-delivery-summary .alerts-step-audience',
    );

    expect(disclosure).not.toHaveAttribute('open');
    expect(audience).toHaveTextContent('To: All Employees (default)');
    expect(audience).toBeVisible();

    rerender(<AlertForm {...defaultProps} recipient="  Store Managers " />);
    expect(
      container.querySelector('.alerts-optional-delivery-summary .alerts-step-audience'),
    ).toHaveTextContent(/^To: Store Managers$/);
  });

  it('summarizes only configured optional categories without opening the section', () => {
    render(
      <AlertForm
        {...defaultProps}
        sender="IT"
        clickThroughUrl="https://status.example.com"
        updateNumber={2}
        logoDataUrl="data:image/png;base64,logo"
      />,
    );

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

  it('expands and focuses the requested optional field exactly once', async () => {
    const request = { requestId: 3, field: 'clickThroughUrl' as const };
    const { rerender } = render(<AlertForm {...defaultProps} attentionRequest={request} />);

    await waitFor(() => expect(screen.getByLabelText('Clickable image URL')).toHaveFocus());
    expect(screen.getByRole('group', { name: 'Optional delivery details' })).toHaveAttribute(
      'open',
    );

    fireEvent.click(screen.getByText('Add delivery details'));
    rerender(<AlertForm {...defaultProps} attentionRequest={request} />);
    expect(screen.getByRole('group', { name: 'Optional delivery details' })).not.toHaveAttribute(
      'open',
    );
  });

  it('marks the message step done when subject and body both have content', () => {
    render(<AlertForm {...defaultProps} subject="POS outage" bodyHtml="<p>Investigating.</p>" />);

    const messageStep = screen.getByRole('region', { name: 'Write the message' });
    expect(messageStep).toHaveTextContent('Done');
    expect(messageStep.querySelector('.alerts-step-status')).toHaveTextContent(/^Done$/);
  });

  it('shows no message step chip when body only has invisible editor content', () => {
    render(<AlertForm {...defaultProps} subject="POS outage" bodyHtml={'<p>\u200b</p>'} />);

    const messageStep = screen.getByRole('region', { name: 'Write the message' });
    expect(messageStep).not.toHaveTextContent('Done');
    expect(messageStep.querySelector('.alerts-step-status')).toBeNull();
  });

  it('leaves required steps chipless until complete', () => {
    render(<AlertForm {...defaultProps} />);

    const severityStep = screen.getByRole('region', { name: 'Choose severity' });
    expect(severityStep.querySelector('.alerts-step-status')).toBeNull();
    expect(severityStep).not.toHaveTextContent('Required');
    expect(severityStep).not.toHaveTextContent('Default');
    expect(screen.getByLabelText(/Subject/)).toHaveAttribute('aria-required', 'true');
  });

  it('renders the subject field', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText(/Subject/)).toBeInTheDocument();
  });

  it('renders the body editor', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByTestId('body-editor')).toBeInTheDocument();
  });

  it('renders the sender field', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText(/Sender/)).toBeInTheDocument();
  });

  it('renders the recipient field', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText(/To \/ Recipient/)).toBeInTheDocument();
  });

  it('updates the draft subject on input change', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText(/Subject/);
    fireEvent.change(input, { target: { value: 'Test Subject' } });
    expect(input).toHaveValue('Test Subject');
  });

  it('updates the draft sender on input change', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText(/Sender/);
    fireEvent.change(input, { target: { value: 'IT Team' } });
    expect(input).toHaveValue('IT Team');
  });

  it('updates the draft recipient on input change', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText(/To \/ Recipient/);
    fireEvent.change(input, {
      target: { value: 'All Staff' },
    });
    expect(input).toHaveValue('All Staff');
  });

  it('renders one optional whole-image click-through URL field', () => {
    render(<AlertForm {...defaultProps} />);

    expect(screen.getByLabelText('Clickable image URL')).toBeInTheDocument();
    expect(screen.getByText(/entire alert image open one URL/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add click link/i })).not.toBeInTheDocument();
  });

  it('updates and normalizes a valid click-through URL', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText('Clickable image URL');
    fireEvent.change(input, { target: { value: 'status.example.com/incident' } });
    expect(input).toHaveValue('status.example.com/incident');

    fireEvent.blur(input);
    expect(input).toHaveValue('https://status.example.com/incident');
    expect(screen.getByText('Ready')).toHaveClass('alerts-click-through-state');
  });

  it('marks unsafe click-through URLs invalid', () => {
    render(<AlertForm {...defaultProps} clickThroughUrl="javascript:alert(1)" />);

    expect(screen.getByLabelText('Clickable image URL')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a valid HTTP or HTTPS address.')).toBeInTheDocument();
  });

  it('shows subject char count', () => {
    render(<AlertForm {...defaultProps} subject="Hello" />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows warn class when subject exceeds 80 chars', () => {
    const longSubject = 'A'.repeat(81);
    const { container } = render(<AlertForm {...defaultProps} subject={longSubject} />);
    const charCount = container.querySelector('.alerts-char-count.warn');
    expect(charCount).toBeInTheDocument();
  });

  it('renders update number toggle (OFF by default)', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('toggles update number on click', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('Off'));
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('shows stepper when updateNumber > 0', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('renders event time start field', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText('Start')).toBeInTheDocument();
  });

  it('renders timezone selector', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText('Source TZ')).toBeInTheDocument();
  });

  it('shows clear button when event time is set', () => {
    render(<AlertForm {...defaultProps} eventTimeStart="2026-01-01T10:00" />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('renders an upload control for each logo slot', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText('Upload Company logo')).toHaveTextContent(/^Upload$/);
    expect(screen.getByLabelText('Upload Footer logo')).toHaveTextContent(/^Upload$/);
  });

  it('renders the footer logo thumbnail and Remove when a footer logo exists', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,abc" />);
    expect(screen.getByLabelText('Remove Footer logo')).toHaveTextContent(/^Remove$/);
    expect(screen.getByAltText('Footer logo')).toBeInTheDocument();
  });

  it('clicks ON to turn off update number', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    fireEvent.click(screen.getByText('On'));
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('increments update number with + button', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    fireEvent.click(screen.getByText('+'));
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('disables the - button at update 1 and gives the live value its context', () => {
    render(<AlertForm {...defaultProps} updateNumber={1} />);
    const minusBtn = screen.getByRole('button', { name: 'Previous update number' });
    expect(minusBtn).toBeDisabled();
    fireEvent.click(minusBtn);
    const value = screen.getByText('#1');
    expect(value).toHaveTextContent('Update #1');
    expect(value).toHaveAttribute('aria-atomic', 'true');
  });

  it('decrements update number correctly when > 1', () => {
    render(<AlertForm {...defaultProps} updateNumber={3} />);
    const minusBtn = screen.getByText('\u2212');
    fireEvent.click(minusBtn);
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('does not show stepper when updateNumber is 0', () => {
    render(<AlertForm {...defaultProps} updateNumber={0} />);
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  it('updates the draft start time on change', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText('Start');
    fireEvent.change(input, { target: { value: '2026-04-01T10:00' } });
    expect(input).toHaveValue('2026-04-01T10:00');
  });

  it('updates the draft end time on change', () => {
    render(<AlertForm {...defaultProps} />);
    const input = screen.getByLabelText(/End/);
    fireEvent.change(input, { target: { value: '2026-04-01T14:00' } });
    expect(input).toHaveValue('2026-04-01T14:00');
  });

  it('updates the draft source timezone on change', () => {
    render(<AlertForm {...defaultProps} />);
    const select = screen.getByLabelText('Source TZ');
    fireEvent.change(select, { target: { value: 'UTC' } });
    expect(select).toHaveValue('UTC');
  });

  it('clears both event times when Clear is clicked', () => {
    render(<AlertForm {...defaultProps} eventTimeStart="2026-01-01T10:00" />);
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByLabelText('Start')).toHaveValue('');
    expect(screen.getByLabelText(/End/)).toHaveValue('');
  });

  it('does not show clear button when no event time is set', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('shows clear button when only eventTimeEnd is set', () => {
    render(<AlertForm {...defaultProps} eventTimeEnd="2026-01-01T14:00" />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onSetFooterLogo when Upload Footer Logo is clicked', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Upload Footer logo'));
    expect(defaultProps.onSetFooterLogo).toHaveBeenCalled();
  });

  it('calls onRemoveFooterLogo when Remove Footer Logo is clicked', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,abc" />);
    fireEvent.click(screen.getByLabelText('Remove Footer logo'));
    expect(defaultProps.onRemoveFooterLogo).toHaveBeenCalled();
  });

  it('does not show warn class when subject is under 80 chars', () => {
    const { container } = render(<AlertForm {...defaultProps} subject="Short" />);
    const charCount = container.querySelector('.alerts-char-count.warn');
    expect(charCount).not.toBeInTheDocument();
  });

  it('does not show warn class when subject is exactly 80 chars', () => {
    const exactSubject = 'A'.repeat(80);
    const { container } = render(<AlertForm {...defaultProps} subject={exactSubject} />);
    const charCount = container.querySelector('.alerts-char-count.warn');
    expect(charCount).not.toBeInTheDocument();
  });

  it('shows correct char count for empty subject', () => {
    render(<AlertForm {...defaultProps} subject="" />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('updates severity through the severity selector', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('change-severity'));
    expect(screen.getByTestId('severity-selector')).toHaveTextContent('MAINTENANCE');
  });

  it('updates body HTML through the body editor', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('set-body'));
    expect(screen.getByTestId('body-editor-value')).toHaveTextContent('<p>test</p>');
  });

  it('calls onSetLogo when Upload Company Logo is clicked', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Upload Company logo'));
    expect(defaultProps.onSetLogo).toHaveBeenCalled();
  });

  it('calls onRemoveLogo when Remove Company Logo is clicked', () => {
    render(<AlertForm {...defaultProps} logoDataUrl="data:image/png;base64,abc" />);
    fireEvent.click(screen.getByLabelText('Remove Company logo'));
    expect(defaultProps.onRemoveLogo).toHaveBeenCalled();
  });

  it('renders only Upload for the footer logo when footerLogoDataUrl is null', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl={null} />);
    expect(screen.getByLabelText('Upload Footer logo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Footer logo')).not.toBeInTheDocument();
  });

  it('renders the footer Remove Logo button and thumbnail when footerLogoDataUrl is set', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,xyz" />);
    expect(screen.getByLabelText('Remove Footer logo')).toBeInTheDocument();
    const img = screen.getByAltText('Footer logo');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,xyz');
    expect(screen.queryByLabelText('Upload Footer logo')).not.toBeInTheDocument();
  });

  it('does not render the retired alert font size control', () => {
    render(<AlertForm {...defaultProps} />);

    const bodyEditor = screen.getByTestId('body-editor');
    const css = readCssBundle('tabs/alerts.css');

    expect(screen.queryByRole('group', { name: 'Alert font size' })).not.toBeInTheDocument();
    expect(screen.queryByText('Alert Font Size')).not.toBeInTheDocument();
    expect(bodyEditor).toBeInTheDocument();
    expect(css).not.toContain('.alerts-font-size-control');
    expect(css).not.toContain('.alerts-font-size-btn');
  });

  it('renders all timezone options in the Source TZ dropdown', () => {
    render(<AlertForm {...defaultProps} />);
    const select = screen.getByLabelText('Source TZ') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('America/Chicago');
    expect(options).toContain('America/New_York');
    expect(options).toContain('America/Denver');
    expect(options).toContain('America/Los_Angeles');
    expect(options).toContain('UTC');
    expect(options).toContain('Europe/London');
    expect(options).toContain('Europe/Berlin');
    expect(options).toContain('Asia/Tokyo');
    expect(options).toContain('Asia/Kolkata');
    expect(options).toContain('Australia/Sydney');
  });

  it('renders with updateNumber 0 showing OFF and no stepper', () => {
    render(<AlertForm {...defaultProps} updateNumber={0} />);
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('#0')).not.toBeInTheDocument();
  });

  it('renders with updateNumber 1 showing ON and stepper at #1', () => {
    render(<AlertForm {...defaultProps} updateNumber={1} />);
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('update toggle has active class when updateNumber > 0', () => {
    const { container } = render(<AlertForm {...defaultProps} updateNumber={1} />);
    const toggle = container.querySelector('.alerts-update-toggle.active');
    expect(toggle).toBeInTheDocument();
  });

  it('update toggle does not have active class when updateNumber is 0', () => {
    const { container } = render(<AlertForm {...defaultProps} updateNumber={0} />);
    const toggle = container.querySelector('.alerts-update-toggle.active');
    expect(toggle).not.toBeInTheDocument();
  });

  it('shows clear button when only eventTimeEnd is set but not eventTimeStart', () => {
    render(<AlertForm {...defaultProps} eventTimeStart="" eventTimeEnd="2026-05-01T14:00" />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('shows clear button when both event times are set', () => {
    render(
      <AlertForm
        {...defaultProps}
        eventTimeStart="2026-05-01T10:00"
        eventTimeEnd="2026-05-01T14:00"
      />,
    );
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('renders severity from props', () => {
    render(<AlertForm {...defaultProps} severity="RESOLVED" />);
    expect(screen.getByText('RESOLVED')).toBeInTheDocument();
  });

  it('renders event time end field', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByLabelText(/End/)).toBeInTheDocument();
  });

  it('renders footer logo label without extra hint text', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByText('Footer logo')).toBeInTheDocument();
    expect(screen.queryByText('Grayscale footer mark')).not.toBeInTheDocument();
  });
});
