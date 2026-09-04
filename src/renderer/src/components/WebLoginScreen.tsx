import { useEffect, useState, type ComponentProps } from 'react';
import { RELAY_WEB_API_PREFIX } from '@shared/webApi';
import { Input } from './Input';
import { TactileButton } from './TactileButton';

export type WebLoginOutcome = 'accepted' | 'rejected' | 'rate-limited' | 'unavailable';

type WebLoginFailure = Exclude<WebLoginOutcome, 'accepted'>;

// A throttled sign-in must never read as a wrong passphrase: the operator's next action differs.
const FAILURE_MESSAGE: Readonly<Record<WebLoginFailure, string>> = {
  rejected: 'Sign-in failed. Check the passphrase and try again.',
  'rate-limited': 'Too many attempts. Wait a minute, then try the same passphrase again.',
  unavailable: 'Relay Web is unavailable right now. Try again in a moment.',
};

type Props = {
  serverLabel: string;
  onLogin: (passphrase: string) => Promise<WebLoginOutcome>;
};

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

export function WebLoginScreen({ serverLabel, onLogin }: Readonly<Props>) {
  const [serverName, setServerName] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch(`${RELAY_WEB_API_PREFIX}/session/server-name`, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const info: unknown = await response.json();
        if (
          active &&
          info &&
          typeof info === 'object' &&
          'serverName' in info &&
          typeof info.serverName === 'string' &&
          info.serverName.length <= 255
        )
          setServerName(info.serverName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const [passphrase, setPassphrase] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<WebLoginFailure | null>(null);

  const handleSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (pending || passphrase.length < 8) return;
    const submittedPassphrase = passphrase;
    setPending(true);
    setFailure(null);
    try {
      const outcome = await onLogin(submittedPassphrase);
      setFailure(outcome === 'accepted' ? null : outcome);
    } catch {
      setFailure('unavailable');
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
          <p className="web-login__server">
            {serverName ? `${serverName} · ${serverLabel}` : serverLabel}
          </p>
        </header>

        <div className="web-login__warning" role="note">
          Trusted LAN/VPN only - browser traffic is not encrypted
        </div>

        <form className="web-login__form" onSubmit={handleSubmit}>
          <p>
            Get the connection passphrase from Settings → Relay data on the Relay server PC, or ask
            its operator.
          </p>
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
          {failure && (
            <div className="web-login__error" role="alert">
              {FAILURE_MESSAGE[failure]}
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
