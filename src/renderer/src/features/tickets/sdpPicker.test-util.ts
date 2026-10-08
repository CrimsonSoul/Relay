import { fireEvent, screen, within } from '@testing-library/react';

/** The picker for a field, by the field's name. */
export const sdpPicker = (name: string) => screen.getByRole('combobox', { name });

/** Opens an SDP choice picker (unless it is open) and chooses one option, as a click would. */
export async function chooseSdpOption(field: string | HTMLElement, option: string) {
  const trigger = typeof field === 'string' ? sdpPicker(field) : field;
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  const list = await screen.findByRole('listbox', { name: trigger.getAttribute('aria-label')! });
  fireEvent.click(await within(list).findByRole('option', { name: option }));
}
