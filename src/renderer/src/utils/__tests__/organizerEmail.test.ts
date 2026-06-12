import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getOrganizerEmail,
  setOrganizerEmail,
  ORGANIZER_EMAIL_STORAGE_KEY,
} from '../organizerEmail';

describe('organizerEmail', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty string when nothing is stored', () => {
    expect(getOrganizerEmail()).toBe('');
  });

  it('persists and returns the organizer email', () => {
    setOrganizerEmail('ops@test.com');
    expect(localStorage.getItem(ORGANIZER_EMAIL_STORAGE_KEY)).toBe('ops@test.com');
    expect(getOrganizerEmail()).toBe('ops@test.com');
  });

  it('returns an empty string when localStorage read throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getOrganizerEmail()).toBe('');
  });

  it('does not throw when localStorage write fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setOrganizerEmail('ops@test.com')).not.toThrow();
  });
});
