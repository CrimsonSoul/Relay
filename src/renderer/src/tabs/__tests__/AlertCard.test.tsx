import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AlertCard, type AlertCardProps } from '../AlertCard';

// Mock the EventTimeBanner dependency
vi.mock('../alerts/EventTimeBanner', () => ({
  EventTimeBanner: ({ severity, startTime }: { severity: string; startTime?: string }) =>
    startTime ? <div data-testid="event-time-banner">{severity}</div> : null,
}));

// Stub ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Stub canvas/image operations used by makeGrayscale / makeWhite
beforeEach(() => {
  // HTMLCanvasElement.getContext returns a minimal stub
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

function makeProps(overrides: Partial<AlertCardProps> = {}): AlertCardProps {
  return {
    cardRef: React.createRef<HTMLDivElement>(),
    severity: 'ISSUE',
    displaySubject: 'Server Down',
    displaySender: 'ops@example.com',
    displayRecipient: 'team@example.com',
    formattedDate: 'Apr 2, 2026 10:00 AM',
    bodyHtml: '<p>Server is unreachable.</p>',
    logoDataUrl: null,
    ...overrides,
  };
}

describe('AlertCard', () => {
  it('renders subject, sender, recipient, and date', () => {
    render(<AlertCard {...makeProps()} />);

    expect(screen.getByText('Server Down')).toBeInTheDocument();
    expect(screen.getByText('ops@example.com')).toBeInTheDocument();
    expect(screen.getByText('team@example.com')).toBeInTheDocument();
    expect(screen.getByText('Apr 2, 2026 10:00 AM')).toBeInTheDocument();
  });

  it('renders the severity label', () => {
    render(<AlertCard {...makeProps({ severity: 'MAINTENANCE' })} />);

    expect(screen.getByText('MAINTENANCE')).toBeInTheDocument();
    expect(screen.getByText('ALERT')).toBeInTheDocument();
  });

  it('applies severity-specific banner color via CSS variable', () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(<AlertCard {...makeProps({ cardRef: ref, severity: 'INFO' })} />);

    const card = container.querySelector('.alerts-email-card') as HTMLElement;
    expect(card.style.getPropertyValue('--email-banner')).toBe('#1565c0');
  });

  it.each(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'] as const)(
    'renders with %s severity without errors',
    (severity) => {
      expect(() => render(<AlertCard {...makeProps({ severity })} />)).not.toThrow();
    },
  );

  it('shows placeholder when body has no visible text', () => {
    render(<AlertCard {...makeProps({ bodyHtml: '' })} />);

    const body = document.querySelector('.alerts-email-body');
    expect(body?.innerHTML).toContain('Your message will appear here...');
  });

  it('renders body HTML content when present', () => {
    render(<AlertCard {...makeProps({ bodyHtml: '<p>Alert details here</p>' })} />);

    const body = document.querySelector('.alerts-email-body');
    expect(body?.textContent).toContain('Alert details here');
    expect(body).not.toHaveClass('empty');
  });

  it('adds empty class when body has no content', () => {
    render(<AlertCard {...makeProps({ bodyHtml: '' })} />);

    const body = document.querySelector('.alerts-email-body');
    expect(body).toHaveClass('empty');
  });

  it('renders FROM and TO labels in meta section', () => {
    render(<AlertCard {...makeProps()} />);

    expect(screen.getByText('FROM')).toBeInTheDocument();
    expect(screen.getByText('TO')).toBeInTheDocument();
  });

  it('renders EventTimeBanner when eventTimeStart is provided', () => {
    render(<AlertCard {...makeProps({ eventTimeStart: '2026-04-05T07:00:00Z' })} />);

    expect(screen.getByTestId('event-time-banner')).toBeInTheDocument();
  });

  it('does not render EventTimeBanner when no event time', () => {
    render(<AlertCard {...makeProps()} />);

    expect(screen.queryByTestId('event-time-banner')).not.toBeInTheDocument();
  });

  it('does not render header logo when logoDataUrl is null', () => {
    const { container } = render(<AlertCard {...makeProps({ logoDataUrl: null })} />);

    expect(container.querySelector('.alerts-email-header-logo')).not.toBeInTheDocument();
  });

  it('accepts logoDataUrl prop without error', () => {
    // The makeWhite promise won't resolve in jsdom (Image.onload doesn't fire),
    // but the component should render without throwing.
    expect(() =>
      render(<AlertCard {...makeProps({ logoDataUrl: 'data:image/png;base64,TEST' })} />),
    ).not.toThrow();
  });

  it('accepts footerLogoDataUrl prop without error', () => {
    expect(() =>
      render(<AlertCard {...makeProps({ footerLogoDataUrl: 'data:image/png;base64,FOOTER' })} />),
    ).not.toThrow();
  });

  it('renders footer spacer when no footer logo', () => {
    const { container } = render(<AlertCard {...makeProps()} />);

    expect(container.querySelector('.alerts-email-footer-spacer')).toBeInTheDocument();
    expect(container.querySelector('.alerts-email-footer-logo')).not.toBeInTheDocument();
  });

  it('clears whiteLogoUrl when logoDataUrl changes to null', () => {
    const { rerender, container } = render(
      <AlertCard {...makeProps({ logoDataUrl: 'data:image/png;base64,TEST' })} />,
    );
    // Rerender with null logo
    rerender(<AlertCard {...makeProps({ logoDataUrl: null })} />);
    expect(container.querySelector('.alerts-email-header-logo')).not.toBeInTheDocument();
  });

  it('clears grayFooterLogoUrl when footerLogoDataUrl changes to null', () => {
    const { rerender, container } = render(
      <AlertCard {...makeProps({ footerLogoDataUrl: 'data:image/png;base64,FOOTER' })} />,
    );
    rerender(<AlertCard {...makeProps({ footerLogoDataUrl: null })} />);
    expect(container.querySelector('.alerts-email-footer-logo')).not.toBeInTheDocument();
    expect(container.querySelector('.alerts-email-footer-spacer')).toBeInTheDocument();
  });

  it('applies empty class to body when bodyHtml has only whitespace', () => {
    render(<AlertCard {...makeProps({ bodyHtml: '   ' })} />);
    const body = document.querySelector('.alerts-email-body');
    expect(body).toHaveClass('empty');
  });

  it('renders body without empty class when bodyHtml has content', () => {
    render(<AlertCard {...makeProps({ bodyHtml: '<p>Real content</p>' })} />);
    const body = document.querySelector('.alerts-email-body');
    expect(body).not.toHaveClass('empty');
  });

  it('renders meta dot separator between FROM and TO', () => {
    const { container } = render(<AlertCard {...makeProps()} />);
    expect(container.querySelector('.alerts-email-meta-dot')).toBeInTheDocument();
  });

  it('renders all severity colors correctly', () => {
    const severities = ['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED'] as const;
    for (const sev of severities) {
      const { container, unmount } = render(<AlertCard {...makeProps({ severity: sev })} />);
      const card = container.querySelector('.alerts-email-card') as HTMLElement;
      expect(card.style.getPropertyValue('--email-banner')).toBeTruthy();
      unmount();
    }
  });

  it('renders white logo in header when logoDataUrl resolves', async () => {
    // Simulate Image.onload firing by patching the Image constructor
    const origImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width = 10;
      height = 10;
      set src(_url: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const { container } = render(
      <AlertCard {...makeProps({ logoDataUrl: 'data:image/png;base64,TEST' })} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.alerts-email-header-logo')).toBeInTheDocument();
    });

    vi.stubGlobal('Image', origImage);
  });

  it('renders gray footer logo when footerLogoDataUrl resolves', async () => {
    const origImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width = 10;
      height = 10;
      set src(_url: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const { container } = render(
      <AlertCard {...makeProps({ footerLogoDataUrl: 'data:image/png;base64,FOOTER' })} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.alerts-email-footer-logo')).toBeInTheDocument();
    });
    // When footer logo is present, spacer should not be rendered
    expect(container.querySelector('.alerts-email-footer-spacer')).not.toBeInTheDocument();

    vi.stubGlobal('Image', origImage);
  });

  it('falls back to null whiteLogoUrl when makeWhite rejects', async () => {
    const origImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width = 10;
      height = 10;
      set src(_url: string) {
        setTimeout(() => this.onerror?.(new Error('fail')), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const { container } = render(
      <AlertCard {...makeProps({ logoDataUrl: 'data:image/png;base64,BAD' })} />,
    );

    // Wait for the rejection to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.querySelector('.alerts-email-header-logo')).not.toBeInTheDocument();

    vi.stubGlobal('Image', origImage);
  });

  it('falls back to null grayFooterLogoUrl when makeGrayscale rejects', async () => {
    const origImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      width = 10;
      height = 10;
      set src(_url: string) {
        setTimeout(() => this.onerror?.(new Error('fail')), 0);
      }
    }
    vi.stubGlobal('Image', MockImage);

    const { container } = render(
      <AlertCard {...makeProps({ footerLogoDataUrl: 'data:image/png;base64,BAD' })} />,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(container.querySelector('.alerts-email-footer-logo')).not.toBeInTheDocument();
    expect(container.querySelector('.alerts-email-footer-spacer')).toBeInTheDocument();

    vi.stubGlobal('Image', origImage);
  });

  it('applies badge CSS variables for each severity', () => {
    const { container } = render(<AlertCard {...makeProps({ severity: 'RESOLVED' })} />);
    const card = container.querySelector('.alerts-email-card') as HTMLElement;
    expect(card.style.getPropertyValue('--email-badge-bg')).toBeTruthy();
    expect(card.style.getPropertyValue('--email-badge-text')).toBeTruthy();
  });

  it('renders EventTimeBanner with both start and end time', () => {
    render(
      <AlertCard
        {...makeProps({
          eventTimeStart: '2026-04-05T07:00:00Z',
          eventTimeEnd: '2026-04-05T09:00:00Z',
        })}
      />,
    );
    expect(screen.getByTestId('event-time-banner')).toBeInTheDocument();
  });

  it('renders severity icon', () => {
    const { container } = render(<AlertCard {...makeProps({ severity: 'ISSUE' })} />);
    const iconWrapper = container.querySelector('.alerts-email-icon');
    expect(iconWrapper).toBeInTheDocument();
    expect(iconWrapper?.innerHTML).toBeTruthy();
  });
});
