import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionIcon } from './CommandIcons';

describe('ActionIcon', () => {
  it.each(['alerts', 'problems', 'servers', 'wiki'])(
    'renders a visible %s action glyph',
    (type) => {
      const { container } = render(<ActionIcon type={type} />);

      expect(container.querySelector('svg')).not.toBeNull();
    },
  );
});
