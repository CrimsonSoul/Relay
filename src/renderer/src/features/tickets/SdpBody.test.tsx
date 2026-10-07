import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BridgeAPI } from '@shared/ipc';
import { SdpBody } from './SdpBody';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
});
const pixel =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const stored = (path: string, alt: string) =>
  `<img alt="${alt}" width="120" height="29" ` +
  `src="/app/itdesk/servlet/SDODAuthServlet?path=${path}&amp;ACTION=FILE">`;

it('loads images SDP stored from email, shows embedded ones and never loads remote images', async () => {
  const sdpAccount = vi.fn().mockResolvedValue({
    success: true,
    data: {
      configured: true,
      status: 'connected',
      inlineImages: {
        id: '9',
        images: [{ path: '41', contentType: 'image/png', data: pixel.split(',')[1] }],
        deferred: [],
      },
    },
  });
  globalThis.api = { sdpAccount } as unknown as BridgeAPI;
  render(
    <SdpBody
      ticketId="9"
      html={
        `<table>\n  <tr>\n    <td>${stored('41', 'Company logo')}</td>` +
        '<td>Example Person<br>Network Operations</td></tr></table>' +
        `<p><img alt="Pasted screenshot" width="40" src="${pixel}"></p>` +
        '<img alt="Tracker" src="https://example.com/track.png">' +
        '<table border="1"><tr><td colspan="2">Field</td></tr></table>'
      }
    />,
  );
  const logo = await screen.findByRole('img', { name: 'Company logo' });
  expect(logo.getAttribute('src')).toBe(pixel);
  expect(logo.getAttribute('width')).toBe('120');
  expect(sdpAccount).toHaveBeenCalledExactlyOnceWith({
    action: 'readInlineImages',
    id: '9',
    paths: ['41'],
  });
  const screenshot = screen.getByRole('img', { name: 'Pasted screenshot' });
  expect(screenshot.getAttribute('src')).toBe(pixel);
  expect(screen.queryByRole('img', { name: 'Tracker' })).toBeNull();
  expect(screen.getByText('[Image omitted]')).toBeTruthy();
  const [signature, grid] = Array.from(document.querySelectorAll('table'));
  expect(signature?.className).toBe('');
  expect(grid?.className).toBe('sdp-live-grid');
  expect(grid?.querySelector('td')?.getAttribute('colspan')).toBe('2');
});

it('reads deferred images in a later batch and links an image SDP cannot provide to SDP', async () => {
  const openExternal = vi.fn().mockResolvedValue(true);
  const sdpAccount = vi
    .fn()
    .mockResolvedValueOnce({
      success: true,
      data: {
        configured: true,
        status: 'connected',
        inlineImages: {
          id: '10',
          images: [{ path: '51', contentType: 'image/png', data: pixel.split(',')[1] }],
          deferred: ['52'],
        },
      },
    })
    .mockResolvedValueOnce({ success: false, error: 'SDP could not complete this action.' });
  globalThis.api = { sdpAccount, openExternal } as unknown as BridgeAPI;
  render(<SdpBody ticketId="10" html={stored('51', 'First') + stored('52', 'Second')} />);
  expect(await screen.findByRole('img', { name: 'First' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Image: Second · View in SDP' }));
  expect(sdpAccount.mock.calls.map(([command]) => command.paths)).toEqual([['51', '52'], ['52']]);
  expect(openExternal).toHaveBeenCalledWith(
    'https://support.campingworld.com/app/itdesk/ui/requests/10/details',
  );
});
