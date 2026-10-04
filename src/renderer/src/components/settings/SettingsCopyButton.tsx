import { useEffect, useState } from 'react';
import { TactileButton } from '../TactileButton';

const FEEDBACK_MS = 1500;

type CopyState = 'idle' | 'copied' | 'failed';

/** Inline Copy action for read-only Settings values; confirms the copy visibly and to screen readers. */
export function SettingsCopyButton({
  text,
  label,
}: Readonly<{
  text: string;
  /** Accessible name, e.g. "Copy browser URL". */
  label: string;
}>) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const handleCopy = async () => {
    try {
      const copied = await globalThis.api?.writeClipboard(text);
      setState(copied === false ? 'failed' : 'copied');
    } catch {
      setState('failed');
    }
  };

  let visibleLabel = 'Copy';
  let announcement = '';
  if (state === 'copied') {
    visibleLabel = 'Copied';
    announcement = 'Copied to clipboard';
  } else if (state === 'failed') {
    visibleLabel = 'Copy failed';
    announcement = 'Copy failed';
  }

  return (
    <>
      <TactileButton
        size="xs"
        className={state === 'copied' ? 'settings-copy-confirmed' : undefined}
        aria-label={label}
        onClick={() => void handleCopy()}
      >
        {visibleLabel}
      </TactileButton>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
