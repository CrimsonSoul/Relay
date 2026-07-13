export const SELECTED_OPERATOR_STORAGE_KEY = 'relay.selectedOperatorId';

export function loadSelectedOperatorId(): string | null {
  try {
    return globalThis.localStorage.getItem(SELECTED_OPERATOR_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function persistSelectedOperatorId(id: string | null): void {
  try {
    const normalizedId = id?.trim();
    if (normalizedId) {
      globalThis.localStorage.setItem(SELECTED_OPERATOR_STORAGE_KEY, normalizedId);
    } else {
      globalThis.localStorage.removeItem(SELECTED_OPERATOR_STORAGE_KEY);
    }
  } catch {
    // Persistence is best-effort; the active window still owns the selection state.
  }
}
