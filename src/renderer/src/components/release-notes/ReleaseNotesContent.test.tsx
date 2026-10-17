import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReleaseNotesContent } from './ReleaseNotesContent';

describe('ReleaseNotesContent', () => {
  it('keeps underscores inside identifiers as literal text', () => {
    const { container } = render(
      <ReleaseNotesContent body="Clears the relay_web_session cookie and dt__entity__id state" />,
    );

    expect(container.querySelector('em, strong')).toBeNull();
    expect(container).toHaveTextContent(
      'Clears the relay_web_session cookie and dt__entity__id state',
    );
  });

  it('still renders underscore and asterisk emphasis around whole words', () => {
    const { container } = render(<ReleaseNotesContent body="Now _faster_ and *safer*" />);

    expect([...container.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'faster',
      'safer',
    ]);
  });
});
