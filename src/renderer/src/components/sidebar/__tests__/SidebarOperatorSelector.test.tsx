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

function renderSelector({ includeAction = false }: { includeAction?: boolean } = {}) {
  return render(
    <OperatorProvider>
      <SidebarOperatorSelector />
      {includeAction && <AttributionAction />}
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

  it('compacts every sidebar control when vertical space is constrained', () => {
    expect(sidebarCss).toMatch(
      /@media \(max-height: 760px\) \{\s*\.sidebar-button\s*\{\s*--sidebar-button-height: 48px;/,
    );
  });

  it('preserves operator display-name casing in the sidebar trigger', () => {
    expect(sidebarCss).toMatch(
      /\.sidebar-operator-selector \.sidebar-button-label\s*\{\s*text-transform: none;/,
    );
  });
});
