import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ProviderIcon } from '../ProviderIcons';

describe('ProviderIcon', () => {
  it.each([
    ['Dynatrace cloud-status provider', 'dynatrace'],
    ['Dropbox cloud-status provider', 'dropbox'],
    ['Equinix provider portal', 'equinix'],
  ] as const)('renders an icon for the %s', (_label, provider) => {
    const { container } = render(<ProviderIcon provider={provider} size={20} />);

    expect(container.querySelector('svg')).toHaveAttribute('width', '20');
    expect(container.querySelector('svg')).toHaveAttribute('height', '20');
  });
});
