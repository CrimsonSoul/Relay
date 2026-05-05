import React from 'react';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertForm, type AlertFormHandle } from '../AlertForm';

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
  AlertBodyEditor: React.forwardRef(
    (
      { setBodyHtml }: { setBodyHtml: (s: string) => void },
      ref: React.Ref<{ setEditorContent: (html: string) => void }>,
    ) => {
      React.useImperativeHandle(ref, () => ({
        setEditorContent: vi.fn(),
      }));
      return (
        <div data-testid="body-editor">
          <button onClick={() => setBodyHtml('<p>test</p>')}>set-body</button>
        </div>
      );
    },
  ),
}));

vi.mock('../alerts/AlertLogoUpload', () => ({
  AlertLogoUpload: ({
    onSetLogo,
    onRemoveLogo,
  }: {
    logoDataUrl: string | null;
    onSetLogo: () => void;
    onRemoveLogo: () => void;
  }) => (
    <div data-testid="logo-upload">
      <button onClick={onSetLogo}>upload-logo</button>
      <button onClick={onRemoveLogo}>remove-logo</button>
    </div>
  ),
}));

const defaultProps = {
  severity: 'ISSUE' as const,
  setSeverity: vi.fn(),
  subject: '',
  setSubject: vi.fn(),
  bodyHtml: '',
  setBodyHtml: vi.fn(),
  sender: '',
  setSender: vi.fn(),
  recipient: '',
  setRecipient: vi.fn(),
  updateNumber: 0,
  setUpdateNumber: vi.fn(),
  eventTimeStart: '',
  setEventTimeStart: vi.fn(),
  eventTimeEnd: '',
  setEventTimeEnd: vi.fn(),
  eventTimeSourceTz: 'America/Chicago',
  setEventTimeSourceTz: vi.fn(),
  logoDataUrl: null,
  onSetLogo: vi.fn(),
  onRemoveLogo: vi.fn(),
  footerLogoDataUrl: null,
  onSetFooterLogo: vi.fn(),
  onRemoveFooterLogo: vi.fn(),
  isCompact: false,
  onToggleCompact: vi.fn(),
  isEnhanced: false,
  onToggleEnhanced: vi.fn(),
};

describe('AlertForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the base font for alert form labels and controls', () => {
    const css = readFileSync('src/renderer/src/tabs/alerts.css', 'utf8');
    const baseFontSelectors = [
      '.alerts-step-index',
      '.alerts-step-status',
      '.alerts-delivery-group-title',
      '.alerts-branding-summary::after',
      '.alerts-sev-btn',
      '.alerts-update-toggle',
      '.alerts-stepper-value',
      '.alerts-logo-action',
      '.alerts-hl-popover-label',
      '.alerts-hl-popover-key',
    ];

    for (const selector of baseFontSelectors) {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, 'm').exec(css);
      expect(match?.[0]).not.toContain('var(--font-family-mono)');
    }
  });

  it('uses the app accent color for guided step numbers', () => {
    const css = readFileSync('src/renderer/src/tabs/alerts.css', 'utf8');
    const stepIndex = /\.alerts-step-index\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(stepIndex).toContain('color: var(--color-accent-text)');
    expect(stepIndex).toContain('background: var(--color-accent-dim)');
    expect(stepIndex).toContain('border: 1px solid var(--color-accent-dim)');
    expect(stepIndex).not.toContain('color-accent-secondary');
    expect(stepIndex).not.toContain('34, 211, 238');
  });

  it('keeps select arrows and collapsed branding controls comfortably spaced', () => {
    const css = readFileSync('src/renderer/src/tabs/alerts.css', 'utf8');
    const inputFocus =
      /\.alerts-input:focus,[\s\S]*?\.alerts-input:focus-visible\s*\{[^}]*\}/m.exec(css)?.[0];
    const timezoneSelect = /\.alerts-event-time-tz\s*\{[^}]*\}/m.exec(css)?.[0];
    const brandingToggle = /\.alerts-branding-summary::after\s*\{[^}]*\}/m.exec(css)?.[0];

    expect(inputFocus).toContain('background-color: var(--color-bg-surface)');
    expect(inputFocus).not.toContain('background:');
    expect(timezoneSelect).toContain('padding-right: 46px');
    expect(timezoneSelect).toContain('appearance: none');
    expect(timezoneSelect).toContain('background-position: right 18px center');
    expect(brandingToggle).toContain('border-radius: 6px');
  });

  it('renders the severity selector', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByTestId('severity-selector')).toBeInTheDocument();
  });

  it('renders the guided alert creation sections', () => {
    render(<AlertForm {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Set alert posture' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Write the message' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add delivery details' })).toBeInTheDocument();
  });

  it('uses concise step descriptions', () => {
    render(<AlertForm {...defaultProps} />);

    expect(screen.getByText('Card tone and icon.')).toBeInTheDocument();
    expect(screen.getByText('Subject and body.')).toBeInTheDocument();
    expect(screen.getByText('Routing, timing, and updates.')).toBeInTheDocument();
  });

  it('keeps branding controls collapsed by default', () => {
    render(<AlertForm {...defaultProps} />);

    const brandingGroup = screen.getByText('Branding options').closest('details');
    expect(brandingGroup).toBeInTheDocument();
    expect(brandingGroup).not.toHaveAttribute('open');
  });

  it('uses one optional marker for the delivery section', () => {
    render(<AlertForm {...defaultProps} />);

    const deliveryStep = screen.getByRole('region', { name: 'Add delivery details' });
    expect(within(deliveryStep).getAllByText('OPTIONAL')).toHaveLength(1);
  });

  it('marks the message step done when subject and body both have content', () => {
    render(<AlertForm {...defaultProps} subject="POS outage" bodyHtml="<p>Investigating.</p>" />);

    const messageStep = screen.getByRole('region', { name: 'Write the message' });
    expect(messageStep).toHaveTextContent('DONE');
    expect(messageStep).not.toHaveTextContent('ACTIVE');
  });

  it('keeps the message step active when body only has invisible editor content', () => {
    render(<AlertForm {...defaultProps} subject="POS outage" bodyHtml={'<p>\u200b</p>'} />);

    const messageStep = screen.getByRole('region', { name: 'Write the message' });
    expect(messageStep).toHaveTextContent('ACTIVE');
    expect(messageStep).not.toHaveTextContent('DONE');
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

  it('calls setSubject on subject input change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'Test Subject' } });
    expect(defaultProps.setSubject).toHaveBeenCalledWith('Test Subject');
  });

  it('calls setSender on sender input change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/Sender/), { target: { value: 'IT Team' } });
    expect(defaultProps.setSender).toHaveBeenCalledWith('IT Team');
  });

  it('calls setRecipient on recipient input change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/To \/ Recipient/), {
      target: { value: 'All Staff' },
    });
    expect(defaultProps.setRecipient).toHaveBeenCalledWith('All Staff');
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
    expect(screen.getByText('OFF')).toBeInTheDocument();
  });

  it('toggles update number on click', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('OFF'));
    expect(defaultProps.setUpdateNumber).toHaveBeenCalledWith(1);
  });

  it('shows stepper when updateNumber > 0', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    expect(screen.getByText('ON')).toBeInTheDocument();
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

  it('renders logo upload', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByTestId('logo-upload')).toBeInTheDocument();
  });

  it('renders footer logo upload button when no logo', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByText('UPLOAD')).toBeInTheDocument();
  });

  it('renders footer logo with REMOVE when logo exists', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,abc" />);
    expect(screen.getByText('REMOVE')).toBeInTheDocument();
    expect(screen.getByAltText('Footer logo')).toBeInTheDocument();
  });

  it('exposes setEditorContent via ref', () => {
    const ref = React.createRef<AlertFormHandle>();
    render(<AlertForm {...defaultProps} ref={ref} />);
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current!.setEditorContent).toBe('function');
  });

  it('clicks ON to turn off update number', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    fireEvent.click(screen.getByText('ON'));
    expect(defaultProps.setUpdateNumber).toHaveBeenCalledWith(0);
  });

  it('increments update number with + button', () => {
    render(<AlertForm {...defaultProps} updateNumber={2} />);
    fireEvent.click(screen.getByText('+'));
    expect(defaultProps.setUpdateNumber).toHaveBeenCalledWith(3);
  });

  it('decrements update number with - button but not below 1', () => {
    render(<AlertForm {...defaultProps} updateNumber={1} />);
    // The minus button text is a unicode minus
    const minusBtn = screen.getByText('\u2212');
    fireEvent.click(minusBtn);
    expect(defaultProps.setUpdateNumber).toHaveBeenCalledWith(1); // max(1, 1-1) = 1
  });

  it('decrements update number correctly when > 1', () => {
    render(<AlertForm {...defaultProps} updateNumber={3} />);
    const minusBtn = screen.getByText('\u2212');
    fireEvent.click(minusBtn);
    expect(defaultProps.setUpdateNumber).toHaveBeenCalledWith(2);
  });

  it('does not show stepper when updateNumber is 0', () => {
    render(<AlertForm {...defaultProps} updateNumber={0} />);
    expect(screen.queryByText('+')).not.toBeInTheDocument();
  });

  it('calls setEventTimeStart on start time change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-04-01T10:00' } });
    expect(defaultProps.setEventTimeStart).toHaveBeenCalledWith('2026-04-01T10:00');
  });

  it('calls setEventTimeEnd on end time change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText(/End/), { target: { value: '2026-04-01T14:00' } });
    expect(defaultProps.setEventTimeEnd).toHaveBeenCalledWith('2026-04-01T14:00');
  });

  it('calls setEventTimeSourceTz on timezone change', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Source TZ'), { target: { value: 'UTC' } });
    expect(defaultProps.setEventTimeSourceTz).toHaveBeenCalledWith('UTC');
  });

  it('clears both event times when Clear is clicked', () => {
    render(<AlertForm {...defaultProps} eventTimeStart="2026-01-01T10:00" />);
    fireEvent.click(screen.getByText('Clear'));
    expect(defaultProps.setEventTimeStart).toHaveBeenCalledWith('');
    expect(defaultProps.setEventTimeEnd).toHaveBeenCalledWith('');
  });

  it('does not show clear button when no event time is set', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('shows clear button when only eventTimeEnd is set', () => {
    render(<AlertForm {...defaultProps} eventTimeEnd="2026-01-01T14:00" />);
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onSetFooterLogo when UPLOAD clicked', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('UPLOAD'));
    expect(defaultProps.onSetFooterLogo).toHaveBeenCalled();
  });

  it('calls onRemoveFooterLogo when REMOVE clicked', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,abc" />);
    fireEvent.click(screen.getByText('REMOVE'));
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

  it('calls setSeverity through severity selector mock', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('change-severity'));
    expect(defaultProps.setSeverity).toHaveBeenCalledWith('MAINTENANCE');
  });

  it('calls setBodyHtml through body editor mock', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('set-body'));
    expect(defaultProps.setBodyHtml).toHaveBeenCalledWith('<p>test</p>');
  });

  it('calls onSetLogo through logo upload mock', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('upload-logo'));
    expect(defaultProps.onSetLogo).toHaveBeenCalled();
  });

  it('calls onRemoveLogo through logo upload mock', () => {
    render(<AlertForm {...defaultProps} />);
    fireEvent.click(screen.getByText('remove-logo'));
    expect(defaultProps.onRemoveLogo).toHaveBeenCalled();
  });

  it('renders footer logo UPLOAD button when footerLogoDataUrl is null', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl={null} />);
    expect(screen.getByText('UPLOAD')).toBeInTheDocument();
    expect(screen.queryByText('REMOVE')).not.toBeInTheDocument();
  });

  it('renders footer logo REMOVE button and thumbnail when footerLogoDataUrl is set', () => {
    render(<AlertForm {...defaultProps} footerLogoDataUrl="data:image/png;base64,xyz" />);
    expect(screen.getByText('REMOVE')).toBeInTheDocument();
    const img = screen.getByAltText('Footer logo');
    expect(img).toHaveAttribute('src', 'data:image/png;base64,xyz');
    expect(screen.queryByText('UPLOAD')).not.toBeInTheDocument();
  });

  it('renders the event time hint text', () => {
    render(<AlertForm {...defaultProps} />);
    expect(screen.getByText('Displays as Central Time on card')).toBeInTheDocument();
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
    expect(screen.getByText('OFF')).toBeInTheDocument();
    expect(screen.queryByText('#0')).not.toBeInTheDocument();
  });

  it('renders with updateNumber 1 showing ON and stepper at #1', () => {
    render(<AlertForm {...defaultProps} updateNumber={1} />);
    expect(screen.getByText('ON')).toBeInTheDocument();
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
    expect(screen.getByText('Footer Logo')).toBeInTheDocument();
    expect(screen.queryByText('Grayscale footer mark')).not.toBeInTheDocument();
  });
});
