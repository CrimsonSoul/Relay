import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePopoverDismiss } from '../usePopoverDismiss';

function Popover({
  open,
  keys,
  onDismiss,
}: Readonly<{
  open: boolean;
  keys: readonly string[];
  onDismiss: (restoreFocus: boolean) => void;
}>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, trigger, panel, keys, onDismiss);
  return (
    <>
      <button ref={trigger}>Trigger</button>
      <div ref={panel}>
        <input aria-label="Inside" />
      </div>
      <p>Outside</p>
    </>
  );
}

describe('usePopoverDismiss', () => {
  it('closes on an outside press without restoring focus, but not on the trigger or panel', () => {
    const onDismiss = vi.fn();
    render(<Popover open keys={['Escape']} onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.pointerDown(screen.getByLabelText('Inside'));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('closes on its own keys inside the panel and stops them reaching other handlers', () => {
    const onDismiss = vi.fn();
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<Popover open keys={['Escape', 'Tab']} onDismiss={onDismiss} />);
    const inside = screen.getByLabelText('Inside');

    fireEvent.keyDown(inside, { key: 'Enter' });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(inside, { key: 'Tab' });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(true);
    expect(outer).toHaveBeenCalledTimes(1);

    document.removeEventListener('keydown', outer);
  });

  it('ignores keys outside the panel and does nothing while closed', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Popover open keys={['Escape']} onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByText('Outside'), { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();

    rerender(<Popover open={false} keys={['Escape']} onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByText('Outside'));
    fireEvent.keyDown(screen.getByLabelText('Inside'), { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
