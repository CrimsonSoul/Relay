export const ORGANIZER_EMAIL_STORAGE_KEY = 'relay-organizer-email';

export function getOrganizerEmail(): string {
  try {
    return localStorage.getItem(ORGANIZER_EMAIL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setOrganizerEmail(value: string): void {
  try {
    localStorage.setItem(ORGANIZER_EMAIL_STORAGE_KEY, value);
  } catch {
    // Persistence is best-effort; the current composition still works without it.
  }
}
