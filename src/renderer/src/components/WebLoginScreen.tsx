import { useState, type ComponentProps } from 'react';
import { Input } from './Input';
import { TactileButton } from './TactileButton';

type Props = {
  serverLabel: string;
  onLogin: (passphrase: string) => Promise<boolean>;
};

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

export function WebLoginScreen({ serverLabel, onLogin }: Readonly<Props>) {
  const [passphrase, setPassphrase] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (pending || passphrase.length < 8) return;
    const submittedPassphrase = passphrase;
    setPending(true);
    setFailed(false);
    try {
      const accepted = await onLogin(submittedPassphrase);
      setFailed(!accepted);
    } catch {
      setFailed(true);
    } finally {
      setPassphrase('');
      setPending(false);
    }
  };

  return (
    <main className="web-login" aria-labelledby="relay-web-sign-in-title">
      <section className="web-login__panel">
        <header className="web-login__header">
          <div className="web-login__context">Browser backup</div>
          <h1 id="relay-web-sign-in-title" className="web-login__title">
            Relay Web
          </h1>
          <p className="web-login__server">{serverLabel}</p>
        </header>

        <div className="web-login__warning" role="note">
          Trusted LAN/VPN only - browser traffic is not encrypted
        </div>

        <form className="web-login__form" onSubmit={handleSubmit}>
          <Input
            label="Connection passphrase"
            name="relay-passphrase"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            autoFocus
            disabled={pending}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          {failed && (
            <div className="web-login__error" role="alert">
              Sign-in failed. Check the passphrase and try again.
            </div>
          )}
          <TactileButton
            type="submit"
            variant="primary"
            block
            disabled={pending || passphrase.length < 8}
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </TactileButton>
        </form>
      </section>
    </main>
  );
}
