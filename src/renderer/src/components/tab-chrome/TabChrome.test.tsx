import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabCommandBar, TabCommandGroup, TabPageHeader } from './TabChrome';

describe('TabPageHeader', () => {
  it('renders one name, a quiet qualifier and metadata with an h2 by default', () => {
    const { container } = render(
      <TabPageHeader
        title="Problems"
        subtitle="Dynatrace local response"
        metadata={<span role="status">6 open</span>}
        className="dt-problems-header"
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Problems' })).toHaveClass(
      'tab-page-header__title',
    );
    expect(screen.getByText('Dynatrace local response')).toHaveClass('tab-page-header__subtitle');
    expect(screen.getByRole('status')).toHaveTextContent('6 open');
    expect(screen.getByRole('status').parentElement).toHaveClass('tab-page-header__meta');
    expect(container.querySelector('header')).toHaveClass('tab-page-header', 'dt-problems-header');
  });

  it('renders an h1 when the destination owns the page heading', () => {
    render(<TabPageHeader title="Knowledge" headingId="knowledge-home-title" headingLevel={1} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Knowledge' })).toHaveAttribute(
      'id',
      'knowledge-home-title',
    );
  });

  it('renders no eyebrow, subtitle or metadata region it was not given', () => {
    const { container } = render(<TabPageHeader title="Compose" />);

    expect(container.querySelector('.tab-page-header__identity')?.children).toHaveLength(1);
    expect(container.querySelector('.tab-page-header__subtitle')).toBeNull();
    expect(container.querySelector('.tab-page-header__meta')).toBeNull();
  });
});

describe('TabCommandBar', () => {
  it('names the toolbar, preserves group order, and appends domain classes', () => {
    const { container } = render(
      <TabCommandBar ariaLabel="Compose actions" className="assembler-command-bar">
        <TabCommandGroup kind="utility" className="assembler-utility-group">
          <button type="button">Reset</button>
        </TabCommandGroup>
        <TabCommandGroup kind="workflow" className="assembler-workflow-group">
          <button type="button">Open Teams draft</button>
        </TabCommandGroup>
      </TabCommandBar>,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Compose actions' });
    const groups = container.querySelectorAll('.tab-command-group');

    expect(toolbar).toHaveClass('tab-command-bar', 'assembler-command-bar');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveClass('tab-command-group--utility', 'assembler-utility-group');
    expect(groups[1]).toHaveClass('tab-command-group--workflow', 'assembler-workflow-group');
    expect(within(groups[0] as HTMLElement).getByRole('button', { name: 'Reset' })).toBeVisible();
    expect(
      within(groups[1] as HTMLElement).getByRole('button', { name: 'Open Teams draft' }),
    ).toBeVisible();
  });
});
