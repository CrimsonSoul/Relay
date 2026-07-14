import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayOperatorRecord } from '@shared/operators';

const { mockUseCollection } = vi.hoisted(() => ({
  mockUseCollection: vi.fn(),
}));

vi.mock('../../../hooks/useCollection', () => ({
  useCollection: mockUseCollection,
}));

vi.mock('../../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { OperatorProvider, useOperator } from '../../../contexts/OperatorContext';
import { SELECTED_OPERATOR_STORAGE_KEY } from '../../../services/operatorSelection';
import { SidebarOperatorSelector } from '../SidebarOperatorSelector';

type CollectionState = {
  data: RelayOperatorRecord[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
};

let collectionState: CollectionState;
const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/sidebar/sidebar.css'),
  'utf8',
);

const makeOperator = (id: string, displayName: string, active = true): RelayOperatorRecord => ({
  id,
  displayName,
  active,
  created: '2026-07-13 12:00:00.000Z',
  updated: '2026-07-13 12:00:00.000Z',
});

function AttributionAction() {
  const { requireAttribution } = useOperator();
  return (
    <button type="button" onClick={requireAttribution}>
      Save attributed action
    </button>
  );
}

function PickerAction() {
  const { setPickerOpen } = useOperator();
  return (
    <button type="button" onClick={() => setPickerOpen(true)}>
      Open operator picker
    </button>
  );
}

function renderSelector({
  includeAction = false,
  includePickerAction = false,
  includeTabStops = false,
}: {
  includeAction?: boolean;
  includePickerAction?: boolean;
  includeTabStops?: boolean;
} = {}) {
  return render(
    <OperatorProvider>
      {includeTabStops && <button type="button">Before operator selector</button>}
      <SidebarOperatorSelector />
      {includeTabStops && <button type="button">After operator selector</button>}
      {includeAction && <AttributionAction />}
      {includePickerAction && <PickerAction />}
    </OperatorProvider>,
  );
}

describe('SidebarOperatorSelector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    collectionState = {
      data: [
        makeOperator('zulu', 'Zulu Operator'),
        makeOperator('inactive', 'Inactive Operator', false),
        makeOperator('alpha', 'Alpha Operator'),
      ],
      loading: false,
      error: null,
      hasLoadedSnapshot: true,
    };
    mockUseCollection.mockImplementation(() => collectionState);
  });

  it('shows the selected operator name in the compact trigger', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'alpha');

    renderSelector();

    expect(
      screen.getByRole('button', { name: 'Selected operator: Alpha Operator' }),
    ).toHaveTextContent('Alpha Operator');
  });

  it('shows Select operator when no workstation operator is selected', () => {
    renderSelector();

    expect(screen.getByRole('button', { name: 'Select operator' })).toHaveTextContent(
      'Select operator',
    );
  });

  it('lists only active operators in alphabetical order with radio semantics', () => {
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));

    const menu = screen.getByRole('menu', { name: 'Select operator' });
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Alpha Operator',
      'Zulu Operator',
    ]);
    expect(options[0]).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).queryByText('Inactive Operator')).not.toBeInTheDocument();
  });

  it('selects an operator, closes the menu, and restores focus to the trigger', () => {
    renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select operator' });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Zulu Operator' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected operator: Zulu Operator' })).toHaveFocus();
  });

  it('marks the selected option checked and focuses it when opened', () => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'zulu');
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Selected operator: Zulu Operator' }));

    const selectedOption = screen.getByRole('menuitemradio', { name: 'Zulu Operator' });
    expect(selectedOption).toHaveAttribute('aria-checked', 'true');
    expect(selectedOption).toHaveFocus();
  });

  it('scrolls the selected option into view when the roster opens', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'zulu');
    renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Selected operator: Zulu Operator' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('supports Arrow, Home, and End navigation within the operator menu', () => {
    collectionState.data = [
      makeOperator('charlie', 'Charlie'),
      makeOperator('alpha', 'Alpha'),
      makeOperator('bravo', 'Bravo'),
    ];
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));
    const menu = screen.getByRole('menu', { name: 'Select operator' });
    const [alpha, bravo, charlie] = within(menu).getAllByRole('menuitemradio');

    expect(alpha).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(bravo).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(charlie).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(alpha).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(charlie).toHaveFocus();
  });

  it('uses roving tab stops as arrow keys move menu focus', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));
    const menu = screen.getByRole('menu', { name: 'Select operator' });
    const [alpha, zulu] = within(menu).getAllByRole('menuitemradio');

    expect(alpha).toHaveAttribute('tabindex', '0');
    expect(zulu).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    expect(alpha).toHaveAttribute('tabindex', '-1');
    expect(zulu).toHaveAttribute('tabindex', '0');
    expect(zulu).toHaveFocus();
  });

  it('closes on Tab and continues forward from the compact trigger', () => {
    renderSelector({ includeTabStops: true });
    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Select operator' }), { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'After operator selector' })).toHaveFocus();
  });

  it('closes on Shift+Tab and continues backward from the compact trigger', () => {
    renderSelector({ includeTabStops: true });
    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));

    fireEvent.keyDown(screen.getByRole('menu', { name: 'Select operator' }), {
      key: 'Tab',
      shiftKey: true,
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Before operator selector' })).toHaveFocus();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select operator' });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when a pointer press occurs outside the trigger and portal menu', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Select operator' }));

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the same selector when another action requires missing attribution', () => {
    renderSelector({ includeAction: true });

    fireEvent.click(screen.getByRole('button', { name: 'Save attributed action' }));

    expect(screen.getByRole('menu', { name: 'Select operator' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Alpha Operator' })).toHaveFocus();
  });

  it('keeps the fixed portal menu within a constrained viewport', () => {
    vi.stubGlobal('innerWidth', 240);
    vi.stubGlobal('innerHeight', 180);
    renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select operator' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 124,
      width: 120,
      height: 48,
      top: 124,
      right: 120,
      bottom: 172,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);

    const menu = screen.getByRole('menu', { name: 'Select operator' });
    expect(menu).toHaveStyle({ left: '8px', bottom: '8px', maxHeight: '164px' });
  });

  it('caps the operator menu height for a scan-friendly roster', () => {
    vi.stubGlobal('innerHeight', 800);
    renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select operator' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 704,
      width: 120,
      height: 56,
      top: 704,
      right: 120,
      bottom: 760,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);

    expect(screen.getByRole('menu', { name: 'Select operator' })).toHaveStyle({
      maxHeight: '360px',
    });
  });

  it('exposes explicit loading, error, and empty-roster states', () => {
    collectionState = { ...collectionState, data: [], loading: true };
    const { rerender } = renderSelector();
    expect(screen.getByRole('button', { name: 'Loading operators' })).toBeDisabled();

    collectionState = { ...collectionState, loading: false, error: 'offline' };
    rerender(
      <OperatorProvider>
        <SidebarOperatorSelector />
      </OperatorProvider>,
    );
    expect(screen.getByRole('button', { name: 'Operators unavailable' })).toBeDisabled();

    collectionState = { ...collectionState, error: null };
    rerender(
      <OperatorProvider>
        <SidebarOperatorSelector />
      </OperatorProvider>,
    );
    expect(screen.getByRole('button', { name: 'No active operators' })).toBeDisabled();
  });

  it('keeps the trigger disabled while loading even when an attribution request opens status', () => {
    collectionState = { ...collectionState, data: [], loading: true };
    renderSelector({ includeAction: true });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Save attributed action' }));
    });

    expect(screen.getByRole('button', { name: 'Loading operators' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading operators');
  });

  it.each([
    { loading: true, error: null, label: 'Loading operators' },
    { loading: false, error: 'offline', label: 'Operators unavailable' },
  ])('gates retained operator data while showing $label', ({ loading, error, label }) => {
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'alpha');
    collectionState = { ...collectionState, loading, error };
    renderSelector({ includePickerAction: true });
    const action = screen.getByRole('button', { name: 'Open operator picker' });
    action.focus();

    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(screen.getByRole('button', { name: label })).toHaveTextContent(label);

    fireEvent.click(action);

    const menu = screen.getByRole('menu', { name: 'Select operator' });
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
    const statusItem = within(menu).getByRole('menuitem', { name: label });
    expect(statusItem).toHaveAttribute('aria-disabled', 'true');
    expect(statusItem).toHaveAttribute('tabindex', '0');
    expect(statusItem).toHaveFocus();
    expect(within(statusItem).getByRole('status')).toHaveTextContent(label);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(action).toHaveFocus();
  });

  it('provides a focusable menu status when no active operators exist', () => {
    collectionState = { ...collectionState, data: [] };
    renderSelector({ includeAction: true });
    const action = screen.getByRole('button', { name: 'Save attributed action' });
    action.focus();

    fireEvent.click(action);

    const menu = screen.getByRole('menu', { name: 'Select operator' });
    const statusItem = within(menu).getByRole('menuitem', { name: 'No active operators' });
    expect(statusItem).toHaveFocus();
    expect(within(menu).queryByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('compacts every sidebar control when vertical space is constrained', () => {
    expect(sidebarCss).toMatch(
      /@media \(max-height: 760px\) \{\s*\.sidebar-button\s*\{\s*--sidebar-button-height: 48px;/,
    );
  });

  it('preserves operator display-name casing in the sidebar trigger', () => {
    expect(sidebarCss).toMatch(/\.sidebar-operator-selector-label\s*\{\s*text-transform: none;/);
  });

  it('uses the high-contrast sidebar focus vocabulary on the operator trigger', () => {
    expect(sidebarCss).toMatch(
      /\.sidebar-operator-selector:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent-bright\) !important;[^}]*outline-offset: -2px !important;/,
    );
  });

  it('truncates a long visible name while retaining its full accessible text', () => {
    const longName =
      'Alexandria Montgomery-Worthington the Third, Overnight Network Operations Commander';
    collectionState.data = [makeOperator('long-name', longName)];
    localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, 'long-name');
    renderSelector();

    const trigger = screen.getByRole('button', { name: `Selected operator: ${longName}` });
    const label = within(trigger).getByTitle(longName);
    expect(label).toHaveTextContent(longName);
    expect(label).toHaveClass('sidebar-operator-selector-label');
    expect(sidebarCss).toMatch(
      /\.sidebar-operator-selector-label\s*\{[^}]*min-width: 0;[^}]*max-width: calc\(var\(--sidebar-button-width\) - 24px\);[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/,
    );
  });
});
