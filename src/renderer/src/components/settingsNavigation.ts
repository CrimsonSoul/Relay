/** `access` and `administration` are kept for older links; they open Sign-in or Accounts & roles. */
export type SettingsSectionId =
  | 'appearance'
  | 'notifications'
  | 'workstation'
  | 'connection'
  | 'sign-in'
  | 'approvals'
  | 'dynatrace'
  | 'service-desk'
  | 'accounts'
  | 'pairing'
  | 'about'
  | 'access'
  | 'administration';

export const SETTINGS_NAVIGATION_EVENT = 'relay:open-settings-section';

/** Opens the Settings page at one section, e.g. a degraded banner's "Open Dynatrace Settings". */
export function openSettingsSection(section: SettingsSectionId): void {
  globalThis.dispatchEvent(new CustomEvent(SETTINGS_NAVIGATION_EVENT, { detail: section }));
}
