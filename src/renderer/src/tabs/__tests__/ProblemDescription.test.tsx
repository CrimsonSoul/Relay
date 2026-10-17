import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  describesMoreThan,
  leadingHeading,
  parseProblemDescription,
  ProblemDescription,
} from '../ProblemDescription';

const DYNATRACE_DESCRIPTION = [
  '# NPS EVT-13 flood on depw-npsap01',
  '',
  'The problem **affects 1 entity** overall.',
  '',
  'Following entities were affected by the problem:',
  '',
  '**Host, depw-npsap01**',
  '',
  '- NPS event 13 flood on HOST-5A33. Check offender IPs in the `event 13` entries.',
].join('\n');

describe('ProblemDescription', () => {
  it('parses headings, paragraphs and bullet lists', () => {
    expect(parseProblemDescription(DYNATRACE_DESCRIPTION).map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'list',
    ]);
    expect(leadingHeading(DYNATRACE_DESCRIPTION)).toBe('NPS EVT-13 flood on depw-npsap01');
  });

  it('renders Markdown as formatted text with no literal markup', () => {
    const { container } = render(<ProblemDescription source={DYNATRACE_DESCRIPTION} />);

    expect(container).not.toHaveTextContent(/[#*`]/u);
    expect(screen.getByRole('heading', { name: 'NPS EVT-13 flood on depw-npsap01' })).toBeVisible();
    expect(screen.getByText('event 13').tagName).toBe('CODE');
    expect(screen.getByRole('listitem')).toHaveTextContent(/^NPS event 13 flood/u);
  });

  it('never turns description text into markup', () => {
    const { container } = render(
      <ProblemDescription source={'<img src=x onerror="alert(1)"> **bold**'} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)"> bold');
  });

  it('keeps underscores inside names and unclosed markers literal', () => {
    const { container } = render(
      <ProblemDescription
        source={'Root cause PRD_XCNTR - backup_agent_main at 5 * 3 and _italic_'}
      />,
    );

    expect(container).toHaveTextContent(
      'Root cause PRD_XCNTR - backup_agent_main at 5 * 3 and italic',
    );
    expect(container.querySelectorAll('em')).toHaveLength(1);
  });

  it('skips a heading that repeats a title already on screen', () => {
    render(
      <ProblemDescription
        source={DYNATRACE_DESCRIPTION}
        omitTitles={['nps evt-13 flood on DEPW-NPSAP01']}
      />,
    );

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText('Host, depw-npsap01')).toBeVisible();
  });

  it('drops the stock sentences and opens each bold-only line as an entity group', () => {
    const { container } = render(<ProblemDescription source={DYNATRACE_DESCRIPTION} />);

    // Root cause and Systems affected already say these.
    expect(container).not.toHaveTextContent(/affects 1 entity|Following entities/u);
    expect(screen.getByText('Host, depw-npsap01')).toHaveClass(
      'dt-problem-detail__workflow-entity',
    );
    expect(screen.getByText(/Check offender IPs/u).tagName).toBe('LI');
  });

  it('starts a long description collapsed behind Show full description', () => {
    const source = [
      '# Multiple infrastructure problems',
      '**Host, bgpl-kckstrt01**',
      'Availability: Host or monitoring unavailable',
      '- Host unavailable due to connectivity issues',
      '**Process, backup_agent_main**',
      '- Monitoring connection lost',
    ].join('\n\n');
    render(<ProblemDescription source={source} />);

    const toggle = screen.getByRole('button', { name: 'Show full description' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Monitoring connection lost')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Monitoring connection lost')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows a short description whole, with no toggle', () => {
    render(<ProblemDescription source={DYNATRACE_DESCRIPTION} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports whether a description adds anything beyond the titles', () => {
    expect(describesMoreThan('# Checkout down', ['Checkout down'])).toBe(false);
    expect(describesMoreThan('**Checkout down**', ['checkout   down'])).toBe(false);
    expect(describesMoreThan(DYNATRACE_DESCRIPTION, ['Checkout down'])).toBe(true);
    // Stock sentences are hidden when rendered, so they alone do not make a description.
    expect(
      describesMoreThan('# Checkout down\n\nThe problem affects 2 entities overall.', [
        'Checkout down',
      ]),
    ).toBe(false);
  });
});
