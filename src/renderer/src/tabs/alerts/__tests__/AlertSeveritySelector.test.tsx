import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Severity } from '../../alertUtils';
import { AlertSeveritySelector } from '../AlertSeveritySelector';

function Harness({ initialConfirmed = false }: Readonly<{ initialConfirmed?: boolean }>) {
  const [severity, setSeverity] = useState<Severity>('INFO');
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  return (
    <AlertSeveritySelector
      severity={severity}
      confirmed={confirmed}
      setSeverity={(next) => {
        setSeverity(next);
        setConfirmed(true);
      }}
    />
  );
}

describe('AlertSeveritySelector', () => {
  it('checks no option until the operator picks a severity, then fills the chosen one', () => {
    render(<Harness />);

    expect(screen.getByRole('radiogroup', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.queryByText('Default: INFO')).not.toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    for (const radio of radios) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
      expect(radio).not.toHaveClass('active');
    }
    // With nothing checked, the first radio is the group's single tab stop.
    expect(radios.filter((radio) => radio.getAttribute('tabindex') === '0')).toEqual([radios[0]]);
    expect(radios[0]).toHaveAttribute('id', 'alerts-severity');

    fireEvent.click(screen.getByRole('radio', { name: 'INFO' }));

    const info = screen.getByRole('radio', { name: 'INFO' });
    expect(info).toHaveAttribute('aria-checked', 'true');
    expect(info).toHaveClass('active');
    expect(info).toHaveAttribute('tabindex', '0');
  });

  it('selects with arrow keys from the first radio while nothing is checked', () => {
    render(<Harness />);
    const issue = screen.getByRole('radio', { name: 'ISSUE' });
    issue.focus();

    fireEvent.keyDown(issue, { key: 'ArrowRight' });

    const maintenance = screen.getByRole('radio', { name: 'MAINTENANCE' });
    expect(maintenance).toHaveAttribute('aria-checked', 'true');
    expect(maintenance).toHaveFocus();
  });

  it('moves the single checked radio with arrow keys and keeps it the only tab stop', () => {
    render(<Harness initialConfirmed />);
    const info = screen.getByRole('radio', { name: 'INFO' });
    info.focus();

    fireEvent.keyDown(info, { key: 'ArrowRight' });

    const resolved = screen.getByRole('radio', { name: 'RESOLVED' });
    expect(resolved).toHaveAttribute('aria-checked', 'true');
    expect(resolved).toHaveFocus();
    expect(
      screen.getAllByRole('radio').filter((radio) => radio.getAttribute('tabindex') === '0'),
    ).toEqual([resolved]);

    fireEvent.keyDown(resolved, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'ISSUE' })).toHaveAttribute('aria-checked', 'true');
  });
});
