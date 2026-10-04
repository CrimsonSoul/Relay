export type SettingsSectionId =
  'appearance' | 'workstation' | 'connection' | 'access' | 'administration' | 'dynatrace' | 'about';

export const SETTINGS_NAVIGATION_EVENT = 'relay:open-settings-section';

/** Opens the Settings page at one section, e.g. a degraded banner's "Open Dynatrace Settings". */
export function openSettingsSection(section: SettingsSectionId): void {
  globalThis.dispatchEvent(new CustomEvent(SETTINGS_NAVIGATION_EVENT, { detail: section }));
}
