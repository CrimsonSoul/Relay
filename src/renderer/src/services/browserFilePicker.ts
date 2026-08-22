export type BrowserFileSelection =
  { kind: 'selected'; text: string; buffer: ArrayBuffer; name: string } | { kind: 'cancelled' };

export type BrowserFilePickerOptions = {
  accept: string;
  maxBytes: number;
};

const FILE_PICKER_FOCUS_GRACE_MS = 300;

/** Open a browser file picker without letting focus-return outrun its change event. */
export function pickBrowserFile({
  accept,
  maxBytes,
}: BrowserFilePickerOptions): Promise<BrowserFileSelection> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    let settled = false;
    let selectionClaimed = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    const clearFocusTimer = (): void => {
      if (focusTimer === null) return;
      clearTimeout(focusTimer);
      focusTimer = null;
    };

    const cleanup = (): void => {
      clearFocusTimer();
      globalThis.removeEventListener('focus', handleWindowFocus);
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleCancel);
      input.remove();
    };

    const resolveOnce = (value: BrowserFileSelection): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    async function handleChange(): Promise<void> {
      if (selectionClaimed || settled) return;
      const file = input.files?.[0];
      if (!file) {
        resolveOnce({ kind: 'cancelled' });
        return;
      }
      selectionClaimed = true;
      clearFocusTimer();
      if (file.size > maxBytes) {
        rejectOnce(new Error('Import file is too large. Choose a file under 25 MB.'));
        return;
      }
      try {
        const [text, buffer] = await Promise.all([file.text(), file.arrayBuffer()]);
        resolveOnce({ kind: 'selected', text, buffer, name: file.name });
      } catch {
        rejectOnce(new Error('Could not read the selected import file.'));
      }
    }

    function handleCancel(): void {
      if (selectionClaimed || settled) return;
      resolveOnce({ kind: 'cancelled' });
    }

    function handleWindowFocus(): void {
      if (selectionClaimed || settled) return;
      clearFocusTimer();
      focusTimer = setTimeout(() => {
        if (!selectionClaimed && !settled && !input.files?.length) {
          resolveOnce({ kind: 'cancelled' });
        }
      }, FILE_PICKER_FOCUS_GRACE_MS);
    }

    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleCancel);
    globalThis.addEventListener('focus', handleWindowFocus);
    input.click();
  });
}
