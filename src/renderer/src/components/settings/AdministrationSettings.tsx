import { useMemo } from 'react';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import type { useRelayAdministration } from '../../hooks/useRelayAdministration';
import { DynatraceServerPanel } from './administration/DynatraceServerPanel';
import { LocalOnlyNote } from './administration/LocalOnlyNote';
import { PairedDevicesPanel } from './administration/PairedDevicesPanel';
import { RoleAccountsPanel } from './administration/RoleAccountsPanel';
import { SdpServerSettings } from './administration/SdpServerSettings';
import { WorkstationPairing } from './privileged-access/PrivilegedActiveSession';

export type AdministrationSectionId = 'accounts' | 'pairing' | 'dynatrace' | 'service-desk';

/**
 * One Settings section backed by the signed Relay administration snapshot. Settings shows these
 * only to a signed-in Owner or Admin; the snapshot is loaded once by the Settings page.
 */
export function AdministrationSettings({
  section,
  relayMode,
  administration,
}: Readonly<{
  section: AdministrationSectionId;
  relayMode: 'server' | 'client' | null;
  administration: ReturnType<typeof useRelayAdministration>;
}>) {
  const { busy, pairingChallenge, createPairingChallenge } = usePrivilegedAccess();
  const snapshot = administration.snapshot;
  const pairingTargets = useMemo<PrivilegedPairingChallengeTarget[]>(
    () =>
      (snapshot?.accounts ?? []).flatMap((account) =>
        account.active && account.effectiveRole
          ? [
              {
                accountId: account.accountId,
                username: account.username,
                displayName: account.displayName,
                role: account.effectiveRole,
              },
            ]
          : [],
      ),
    [snapshot?.accounts],
  );

  const content = () => {
    if (section === 'service-desk') {
      // ServiceDesk Plus setup reads its own server state, not the administration snapshot.
      return (
        <section className="administration-panel" aria-labelledby="service-desk-title">
          <header className="administration-panel__header">
            <div>
              <h3 id="service-desk-title">Service Desk</h3>
              <p>The Relay server&apos;s connection to ServiceDesk Plus.</p>
            </div>
          </header>
          <SdpServerSettings />
          <LocalOnlyNote />
        </section>
      );
    }
    if (!snapshot) {
      return (
        <div className="administration-panel">
          <div className="administration-empty">
            {administration.loading
              ? 'Loading administration…'
              : 'Administration data is unavailable.'}
          </div>
        </div>
      );
    }
    if (section === 'accounts') {
      return (
        <RoleAccountsPanel
          snapshot={snapshot}
          execute={administration.execute}
          relayMode={relayMode}
        />
      );
    }
    if (section === 'dynatrace') {
      return <DynatraceServerPanel snapshot={snapshot} execute={administration.execute} />;
    }
    return (
      <section className="administration-panel" aria-labelledby="pairing-title">
        <header className="administration-panel__header">
          <div>
            <h3 id="pairing-title">Workstation pairing</h3>
            <p>Pair a workstation to an account, or revoke one that should stop.</p>
          </div>
        </header>
        <WorkstationPairing
          relayMode={relayMode}
          busy={busy}
          pairingTargets={pairingTargets}
          pairingChallenge={pairingChallenge}
          administrationLoading={administration.loading}
          onCreatePairingChallenge={createPairingChallenge}
        />
        <PairedDevicesPanel snapshot={snapshot} execute={administration.execute} />
      </section>
    );
  };

  return (
    <div className="administration-settings">
      {administration.error && (
        <div
          className="administration-feedback--error panel-error ink-rail ink-rail--alarm"
          role="alert"
        >
          {administration.error}
        </div>
      )}
      {content()}
    </div>
  );
}
