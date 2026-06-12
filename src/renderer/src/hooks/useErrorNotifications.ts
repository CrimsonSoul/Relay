import { useEffect } from 'react';

type ShowToast = (message: string, type: 'success' | 'error' | 'info') => void;

/**
 * Surfaces main-process stability notifications (app:error-notification) and
 * PocketBase crash broadcasts (pb:crashed) as toasts. Without this, restarts
 * and recoveries happen with zero user feedback.
 */
export function useErrorNotifications(showToast: ShowToast): void {
  useEffect(() => {
    const api = globalThis.api;
    if (!api?.onErrorNotification) return;

    const offError = api.onErrorNotification(({ title, message }) => {
      showToast(`${title}: ${message}`, 'error');
    });
    const offCrash = api.onPbCrashed?.(({ error }) => {
      showToast(`PocketBase stopped unexpectedly: ${error}`, 'error');
    });

    return () => {
      offError();
      offCrash?.();
    };
  }, [showToast]);
}
