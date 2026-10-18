import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  RelayAdministrationSettingSummary,
  RelayAdministrationSnapshot,
} from '@shared/privilegedAccess';
import { DynatraceServerPanel } from '../DynatraceServerPanel';

vi.mock('../DynatraceConnectionSettings', () => ({
  DynatraceConnectionSettings: () => null,
}));

const scope = (revision: number, valueSummary: string[]): RelayAdministrationSettingSummary => ({
  setting: 'dynatrace.alerting-profiles',
  configured: true,
  summary: 'Configured',
  valueSummary,
  availableValues: ['NOC Core', 'Retail Stores'],
  revision,
});

const snapshot = (setting: RelayAdministrationSettingSummary): RelayAdministrationSnapshot => ({
  accounts: [],
  devices: [],
  settings: [setting],
  ownerAccountId: 'owner',
  publisherAccountId: null,
  assignmentRevision: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
});

describe('DynatraceServerPanel', () => {
  it('reseeds the problem scope draft when the stored scope revision changes', () => {
    const execute = vi.fn();
    const { rerender } = render(
      <DynatraceServerPanel snapshot={snapshot(scope(4, ['NOC Core']))} execute={execute} />,
    );
    const retail = screen.getByRole('checkbox', { name: 'Retail Stores' });
    fireEvent.click(retail);
    expect(retail).toBeChecked();

    rerender(
      <DynatraceServerPanel snapshot={snapshot(scope(5, ['NOC Core']))} execute={execute} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Retail Stores' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'NOC Core' })).toBeChecked();
  });
});
