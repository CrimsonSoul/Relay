import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AlertActionsMenu } from '../AlertActionsMenu';

const handlers = {
  onScheduleAlarm: vi.fn(),
  onOpenAlarms: vi.fn(),
  onPinTemplate: vi.fn(),
  onReset: vi.fn(),
};

describe('AlertActionsMenu', () => {
  it('keeps History out of the overflow and opens the remaining utilities in order', () => {
    render(<AlertActionsMenu {...handlers} captureBusy={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'More alert actions' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Schedule Alarm',
      'Alarms',
      'Pin Template',
      'Reset',
    ]);
  });

  it('supports arrow navigation, Escape, and focus return through ContextMenu', () => {
    render(<AlertActionsMenu {...handlers} captureBusy={false} />);
    const trigger = screen.getByRole('button', { name: 'More alert actions' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('disables the overflow while alert capture is busy', () => {
    render(<AlertActionsMenu {...handlers} captureBusy />);

    expect(screen.getByRole('button', { name: 'More alert actions' })).toBeDisabled();
  });
});
