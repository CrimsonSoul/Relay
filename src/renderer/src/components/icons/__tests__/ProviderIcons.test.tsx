import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderIcon } from '../ProviderIcons';

describe('ProviderIcon', () => {
  it('renders an icon for the Dynatrace cloud-status provider', () => {
    const { container } = render(<ProviderIcon provider="dynatrace" size={20} />);

    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    expect(container.querySelector('svg')).toHaveAttribute('height', '20');
  });
});
