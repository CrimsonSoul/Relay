import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertLinkPopover } from '../AlertLinkPopover';

function renderLabelMode(initialLabel = '') {
  const onApply = vi.fn();
  render(
    <AlertLinkPopover
      initialUrl=""
      labelMode={{ initialLabel }}
      onApply={onApply}
      onRemove={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const fill = (label: string, url: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Button label' }), {
      target: { value: label },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Link address' }), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Insert Button' }));
  };
  return { onApply, fill };
}

describe('AlertLinkPopover label mode', () => {
  it('requires a label', () => {
    const { onApply, fill } = renderLabelMode();
    fill('   ', 'https://example.test/');
    expect(screen.getByText('Enter a button label.')).toHaveClass('field-error');
    expect(screen.getByRole('textbox', { name: 'Button label' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it('limits the label to 60 characters', () => {
    const { onApply, fill } = renderLabelMode();
    fill('x'.repeat(61), 'https://example.test/');
    expect(screen.getByText('Use 60 characters or fewer.')).toHaveClass('field-error');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('still validates the address', () => {
    const { onApply, fill } = renderLabelMode();
    fill('Open portal', 'mailto:ops@example.test');
    expect(screen.getByText('Enter an HTTP or HTTPS address')).toHaveClass('field-error');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies a safe address with a trimmed label', () => {
    const { onApply, fill } = renderLabelMode();
    fill('  Open portal ', 'example.test/portal');
    expect(onApply).toHaveBeenCalledWith('https://example.test/portal', 'Open portal');
  });

  it('hides the label field for an ordinary link', () => {
    render(
      <AlertLinkPopover initialUrl="" onApply={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('textbox', { name: 'Button label' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply Link' })).toBeInTheDocument();
  });

  it('focuses the label field for a button', () => {
    renderLabelMode();
    expect(screen.getByRole('textbox', { name: 'Button label' })).toHaveFocus();
  });

  it('focuses the address field for an ordinary link', () => {
    render(
      <AlertLinkPopover initialUrl="" onApply={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: 'Link address' })).toHaveFocus();
  });
});

/** A toolbar wrapper whose trigger opens the popover on mousedown, committed as a real press is. */
function AnchoredPopover({ onClose }: Readonly<{ onClose: () => void }>) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = triggerRef.current!;
    // Chromium commits a discrete update and runs its effects while the press is still
    // bubbling; flushSync inside a native listener reproduces that ordering under jsdom.
    const openNow = () => flushSync(() => setOpen(true));
    trigger.addEventListener('mousedown', openNow);
    return () => trigger.removeEventListener('mousedown', openNow);
  }, []);
  return (
    <div>
      <button ref={triggerRef} type="button">
        Insert Link
      </button>
      {open && (
        <AlertLinkPopover
          initialUrl=""
          onApply={vi.fn()}
          onRemove={vi.fn()}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

describe('AlertLinkPopover dismissal', () => {
  it('stays open through the mouse press that opened it and closes on an outside press', () => {
    const onClose = vi.fn();
    render(<AnchoredPopover onClose={onClose} />);

    screen
      .getByRole('button', { name: 'Insert Link' })
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Link address' })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull();
  });
});
