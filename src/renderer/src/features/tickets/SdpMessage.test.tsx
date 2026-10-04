import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SdpMessage, sdpError, sdpInfo } from './SdpMessage';

afterEach(cleanup);

it('keeps the info status mounted and renders errors in the alarm grammar', () => {
  const view = render(<SdpMessage />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.queryByRole('alert')).toBeNull();

  view.rerender(<SdpMessage message={sdpInfo('Change confirmed by SDP.')} />);
  expect(screen.getByRole('status')).toHaveTextContent('Change confirmed by SDP.');

  view.rerender(<SdpMessage message={sdpError('The result is uncertain.')} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveClass('panel-error', 'ink-rail', 'ink-rail--alarm');
  expect(alert).toHaveTextContent('The result is uncertain.');
  expect(screen.getByRole('status')).toBeEmptyDOMElement();

  view.rerender(<SdpMessage placement="field" message={sdpError('Choose a file.')} />);
  expect(screen.getByRole('alert')).toHaveClass('field-error');
});
