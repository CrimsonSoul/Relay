function isMacPlatform(): boolean {
  const desktopPlatform = globalThis.api?.platform;
  if (typeof desktopPlatform === 'string') return desktopPlatform === 'darwin';
  return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
}

/**
 * Keycap text for an Alerts body-editor shortcut. The editor accepts Cmd or Ctrl, so the label
 * follows the operator's platform: `⌘B` on macOS, `Ctrl+B` elsewhere (desktop and Relay Web).
 */
export function getEditorShortcutLabel(key: string): string {
  return isMacPlatform() ? `\u2318${key}` : `Ctrl+${key}`;
}
