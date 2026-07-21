const BUILT_IN_ALERT_SOUND = '/audio/reminder-alarm.mp3';
const MAX_DOWNLOAD_NAME_LENGTH = 120;

type BrowserActionsOptions = {
  openWindow?: typeof window.open;
  executeCopy?: (command: string) => boolean;
  AudioConstructor?: typeof Audio;
  pickImage?: (maxBytes: number) => Promise<string | null>;
};

function normalizedExternalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeDownloadName(value: string): string {
  const reserved = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);
  let normalized = [...value.normalize('NFKC')]
    .map((character) => (character.charCodeAt(0) < 32 || reserved.has(character) ? '_' : character))
    .join('')
    .replace(/\s+/gu, '_')
    .replace(/_+/gu, '_')
    .slice(0, MAX_DOWNLOAD_NAME_LENGTH);
  while (normalized.startsWith('.') || normalized.startsWith('_')) normalized = normalized.slice(1);
  while (normalized.endsWith('.') || normalized.endsWith(' ')) normalized = normalized.slice(0, -1);
  return normalized || 'relay-download';
}

function copyField(text: string): HTMLTextAreaElement {
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.setAttribute('data-relay-copy-fallback', '');
  field.setAttribute('aria-label', 'Copy failed. Press Ctrl or Command plus C to copy this text.');
  field.style.position = 'fixed';
  field.style.inset = '1rem';
  field.style.zIndex = '2147483647';
  document.body.append(field);
  field.focus();
  field.select();
  return field;
}

function launch(openWindow: typeof window.open, url: string): boolean {
  const opened = openWindow(url, '_blank', 'noopener,noreferrer');
  if (!opened) return false;
  opened.opener = null;
  return true;
}

function pickBrowserImage(maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.hidden = true;
    document.body.append(input);
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      globalThis.removeEventListener('focus', handleFocus);
      input.remove();
      resolve(value);
    };
    const handleFocus = () =>
      setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 50);
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (!file || file.size > maxBytes || !/^image\/(?:png|jpeg|webp)$/u.test(file.type)) {
          finish(null);
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => finish(null);
        reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(file);
      },
      { once: true },
    );
    globalThis.addEventListener('focus', handleFocus, { once: true });
    input.click();
  });
}

export function createBrowserActions(options: BrowserActionsOptions = {}) {
  const openWindow = options.openWindow ?? window.open.bind(window);
  const legacyDocument = document as unknown as { execCommand?: (command: string) => boolean };
  const executeCopy =
    options.executeCopy ?? ((command: string) => legacyDocument.execCommand?.(command) ?? false);

  return {
    openExternal(value: string): boolean {
      const url = normalizedExternalUrl(value);
      return url ? launch(openWindow, url) : false;
    },

    writeClipboard(text: string): boolean {
      document.querySelector('[data-relay-copy-fallback]')?.remove();
      const field = copyField(text);
      let copied = false;
      try {
        copied = executeCopy('copy');
      } catch {
        copied = false;
      }
      if (copied) field.remove();
      return copied;
    },

    downloadText(content: string, suggestedName: string, mimeType: string): boolean {
      const anchor = document.createElement('a');
      anchor.download = sanitizeDownloadName(suggestedName);
      anchor.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 0);
      return true;
    },

    downloadDataUrl(dataUrl: string, suggestedName: string): boolean {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/u.test(dataUrl)) return false;
      const anchor = document.createElement('a');
      anchor.download = sanitizeDownloadName(suggestedName);
      anchor.href = dataUrl;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 0);
      return true;
    },

    async playBuiltInAlert(): Promise<boolean> {
      try {
        const AudioConstructor = options.AudioConstructor ?? Audio;
        const audio = new AudioConstructor(BUILT_IN_ALERT_SOUND);
        audio.preload = 'auto';
        audio.currentTime = 0;
        await audio.play();
        return true;
      } catch {
        return false;
      }
    },

    openAuxWindow(route: string): boolean {
      if (!/^popout\/[A-Za-z0-9/_-]+$/u.test(route)) return false;
      return launch(openWindow, `/${route}`);
    },

    selectImage(maxBytes: number): Promise<string | null> {
      return (options.pickImage ?? pickBrowserImage)(maxBytes);
    },
  };
}

export type BrowserActions = ReturnType<typeof createBrowserActions>;
