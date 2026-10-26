/** Whether the alert body fills the definition pane: a layout choice for this device. */
const expandedKey = 'relay:alerts-editor-expanded';

export function readAlertEditorExpanded(): boolean {
  try {
    return localStorage.getItem(expandedKey) === 'true';
  } catch {
    return false;
  }
}

export function saveAlertEditorExpanded(expanded: boolean): void {
  try {
    if (expanded) localStorage.setItem(expandedKey, 'true');
    else localStorage.removeItem(expandedKey);
  } catch {
    // Device storage is unavailable; the layout still applies for this session.
  }
}
