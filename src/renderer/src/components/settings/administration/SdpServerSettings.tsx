import { useEffect, useState } from 'react';
import { SDP_CALLBACK, type SdpServerCommand, type SdpServerView } from '@shared/sdpAccount';
import { TactileButton } from '../../TactileButton';

export function SdpServerSettings() {
  const [view, setView] = useState<SdpServerView>();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const invoke = globalThis.api?.sdpServer;
  useEffect(() => {
    let active = true;
    if (invoke)
      void invoke({ action: 'status' })
        .then((result) => {
          if (!active) return;
          if (result.success && result.data) {
            setView(result.data);
            setMinutes(result.data.cacheMinutes);
          } else setFeedback(result.error ?? 'Open these settings on the Relay server computer.');
        })
        .catch(() => {
          if (active) setFeedback('Server settings are unavailable.');
        });
    return () => {
      active = false;
    };
  }, [invoke]);
  async function run(command: SdpServerCommand) {
    setBusy(true);
    setFeedback('');
    try {
      const result = await invoke!(command);
      if (!result.success || !result.data)
        throw new Error(result.error ?? 'Could not save SDP settings.');
      setView(result.data);
      setMinutes(result.data.cacheMinutes);
      setClientId('');
      setClientSecret('');
      setFeedback(
        command.action === 'clear'
          ? 'SDP disconnected. Saved copies removed.'
          : 'Server setup saved. Users can connect their work accounts.',
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'SDP settings unavailable.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="administration-setting" aria-label="SDP server connection">
      <strong>ServiceDesk Plus</strong>
      <p>One server setup. Each person signs in with their own work account.</p>
      {!invoke && <p>Configure this on the Relay server computer.</p>}
      {view && (
        <form
          className="administration-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run({
              action: 'save',
              expectedRevision: view.revision,
              client: { clientId, clientSecret },
              cacheMinutes: minutes,
            });
          }}
        >
          <p>
            {view.configured
              ? 'Configured. Replacing setup signs everyone out and removes saved copies.'
              : 'Create one Zoho server-based application.'}{' '}
            Register callback <code>{SDP_CALLBACK}</code>.
          </p>
          <label className="administration-field">
            <span>Client ID</span>
            <input
              className="tactile-input"
              required
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              maxLength={200}
            />
          </label>
          <label className="administration-field">
            <span>Client secret</span>
            <input
              className="tactile-input"
              required
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              maxLength={500}
            />
          </label>
          <label className="administration-field">
            <span>Saved copy lifetime (minutes)</span>
            <input
              className="tactile-input"
              required
              type="number"
              min={5}
              max={240}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <p>
            Encrypted copies stay on this server and are available only during an SDP outage, to the
            same signed-in person. No ticket copies are saved on client computers. Live testing
            remains limited to ticket 810129 metadata.
          </p>
          {!view.gatewayEnabled && (
            <p>
              Enable Relay Web in the server connection settings so desktop clients can reach the
              sign-in service over your trusted LAN or VPN.
            </p>
          )}
          <TactileButton type="submit" disabled={busy || !clientId.trim() || !clientSecret.trim()}>
            Save server setup
          </TactileButton>
          {view.configured && (
            <TactileButton
              type="button"
              disabled={busy}
              onClick={() => void run({ action: 'clear', expectedRevision: view.revision })}
            >
              Disconnect SDP and clear saved copies
            </TactileButton>
          )}
        </form>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
