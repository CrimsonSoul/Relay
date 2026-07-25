import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Input } from './Input';
import { TactileButton } from './TactileButton';

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function WebReauthenticationOverlay({
  onAuthenticate,
  onAuthenticated,
  onDiscard,
}: Readonly<{
  onAuthenticate(passphrase: string): Promise<boolean>;
  onAuthenticated(): void;
  onDiscard(): void;
}>) {
  const [passphrase, setPassphrase] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null,
  );

  useLayoutEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    const containFocus = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      const activeElement = globalThis.document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.document.addEventListener('keydown', containFocus, true);
    return () => {
      globalThis.document.removeEventListener('keydown', containFocus, true);
      queueMicrotask(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
    };
  }, []);

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (pending || passphrase.length < 8) return;
    const submitted = passphrase;
    setPending(true);
    setFailed(false);
    try {
      const accepted = await onAuthenticate(submitted);
      setFailed(!accepted);
      if (accepted) onAuthenticated();
    } catch {
      setFailed(true);
    } finally {
      setPassphrase('');
      setPending(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="web-reauthentication"
      role="dialog"
      aria-modal="true"
      aria-labelledby="web-reauthentication-title"
    >
      <form className="web-reauthentication__panel" onSubmit={submit}>
        <div className="web-reauthentication__context">Session expired</div>
        <h2 id="web-reauthentication-title">Sign in to keep working</h2>
        <p>Your open work stays in this tab. Changes remain disabled until Relay reconnects.</p>
        <Input
          label="Connection passphrase"
          name="relay-reauthentication-passphrase"
          type="password"
          autoComplete="current-password"
          autoFocus
          disabled={pending}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        {failed && <div role="alert">Sign-in failed. Check the passphrase and try again.</div>}
        <div className="web-reauthentication__actions">
          <TactileButton
            type="submit"
            variant="primary"
            disabled={pending || passphrase.length < 8}
          >
            {pending ? 'Signing in…' : 'Sign in again'}
          </TactileButton>
          <TactileButton type="button" variant="secondary" disabled={pending} onClick={onDiscard}>
            Discard and return to sign in
          </TactileButton>
        </div>
      </form>
    </div>
  );
}
