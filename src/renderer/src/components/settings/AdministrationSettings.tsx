import React, { useState } from 'react';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { useRelayAdministration } from '../../hooks/useRelayAdministration';
import { TactileButton } from '../TactileButton';
import { PairedDevicesPanel } from './administration/PairedDevicesPanel';
import { RelayServerPanel } from './administration/RelayServerPanel';
import { RoleAccountsPanel } from './administration/RoleAccountsPanel';

type SectionId = 'roles' | 'devices' | 'server';
const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; eyebrow: string }> = [
  { id: 'roles', label: 'Accounts & roles', eyebrow: 'Authority' },
  { id: 'devices', label: 'Devices', eyebrow: 'Trust' },
  { id: 'server', label: 'Relay server', eyebrow: 'Configuration' },
];

export function AdministrationSettings({
  relayMode,
}: Readonly<{ relayMode: 'server' | 'client' | null }>) {
  const { session } = usePrivilegedAccess();
  const administration = useRelayAdministration();
  const [activeSection, setActiveSection] = useState<SectionId>('roles');

  if (
    session.state !== 'active' ||
    (session.role !== 'owner' && session.role !== 'admin') ||
    !administration.canAdminister
  )
    return null;

  const snapshot = administration.snapshot;
  return (
    <section
      className="settings-section administration-settings"
      aria-labelledby="relay-administration-title"
    >
      <header className="administration-settings__header">
        <div>
          <div className="settings-section-heading">Protected workspace</div>
          <h2 id="relay-administration-title">Relay administration</h2>
          <p>
            Signed changes are applied by the Relay server and synchronized to connected
            workstations.
          </p>
        </div>
        <div className="administration-settings__session">
          <span className={`administration-chip administration-chip--${session.role}`}>
            {session.role.toUpperCase()}
          </span>
          <strong>{session.displayName}</strong>
          <TactileButton
            size="sm"
            onClick={() => void administration.refresh()}
            loading={administration.loading}
          >
            Refresh
          </TactileButton>
        </div>
      </header>

      {administration.error && (
        <div className="administration-feedback administration-feedback--error" role="alert">
          {administration.error}
        </div>
      )}

      <label className="administration-settings__selector">
        <span>Administration section</span>
        <select
          value={activeSection}
          onChange={(event) => setActiveSection(event.target.value as SectionId)}
        >
          {SECTIONS.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </label>

      <div className="administration-settings__workspace">
        <div
          className="administration-settings__rail"
          aria-label="Administration sections"
          role="tablist"
          aria-orientation="vertical"
        >
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-label={section.label}
              aria-selected={activeSection === section.id}
              className={activeSection === section.id ? 'is-active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              <span>{section.eyebrow}</span>
              <strong>{section.label}</strong>
            </button>
          ))}
        </div>
        <div
          className="administration-settings__content"
          role="tabpanel"
          aria-label={SECTIONS.find((section) => section.id === activeSection)?.label}
        >
          {!snapshot && (
            <div className="administration-empty">
              {administration.loading
                ? 'Loading administration…'
                : 'Administration data is unavailable.'}
            </div>
          )}
          {snapshot && activeSection === 'roles' && (
            <RoleAccountsPanel
              snapshot={snapshot}
              execute={administration.execute}
              relayMode={relayMode}
            />
          )}
          {snapshot && activeSection === 'devices' && (
            <PairedDevicesPanel snapshot={snapshot} execute={administration.execute} />
          )}
          {snapshot && activeSection === 'server' && (
            <RelayServerPanel snapshot={snapshot} execute={administration.execute} />
          )}
        </div>
      </div>
    </section>
  );
}
