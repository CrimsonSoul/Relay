import React, { useMemo } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import type { RelayOperatorRecord } from '@shared/operators';
import { useOperator } from '../../contexts/OperatorContext';
import { useRelayAdministration } from '../../hooks/useRelayAdministration';

type Props = {
  relayMode: PublicRelayConfig['mode'] | null;
  modeLoading: boolean;
};

export function OperatorSettingsSection({ relayMode, modeLoading }: Readonly<Props>) {
  const { operators, loading, error } = useOperator();
  const { snapshot, canAdminister } = useRelayAdministration();
  const roles = useMemo(
    () => new Map(snapshot?.operators.map((operator) => [operator.id, operator.role]) ?? []),
    [snapshot?.operators],
  );
  const groups = useMemo(
    () => ({
      active: operators.filter((operator) => operator.active),
      inactive: operators.filter((operator) => !operator.active),
    }),
    [operators],
  );

  let capabilityMessage = 'Relay is not configured.';
  if (modeLoading) capabilityMessage = 'Checking this workstation’s Relay role…';
  else if (canAdminister) {
    capabilityMessage = 'Manage names, roles, and access in the Administration section.';
  } else if (relayMode === 'server' || relayMode === 'client') {
    capabilityMessage = 'The synchronized roster is read-only without administrator access.';
  }

  const renderRow = (operator: RelayOperatorRecord) => {
    const role = roles.get(operator.id);
    return (
      <div className="operator-settings__row" key={operator.id}>
        <div className="operator-settings__identity">
          <span className="operator-settings__name">{operator.displayName}</span>
          <span className="operator-settings__status">
            {operator.active ? 'Active operator' : 'Inactive operator'}
          </span>
        </div>
        {role && (
          <span className={`administration-chip administration-chip--${role}`}>
            {role.toUpperCase()}
          </span>
        )}
      </div>
    );
  };

  const renderGroup = (label: 'Active' | 'Inactive', group: RelayOperatorRecord[]) => (
    <section
      className="operator-settings__group"
      role="group"
      aria-label={`${label} operators, ${group.length}`}
    >
      <div className="operator-settings__group-heading" aria-hidden="true">
        <span>{label}</span>
        <span className="operator-settings__count">{group.length}</span>
      </div>
      <div className="operator-settings__rows">
        {group.length ? (
          group.map(renderRow)
        ) : (
          <div className="operator-settings__group-empty">No {label.toLowerCase()} operators.</div>
        )}
      </div>
    </section>
  );

  return (
    <section className="settings-section operator-settings" aria-labelledby="operator-roster-title">
      <div className="operator-settings__header">
        <div className="settings-section-heading">Attribution</div>
        <h2 id="operator-roster-title" className="operator-settings__title">
          Operator roster
        </h2>
        <p className="settings-description">
          Operator selection remains passwordless and identifies who performed an attributed action.
        </p>
        <div className="operator-settings__capability">{capabilityMessage}</div>
      </div>

      <div className="operator-settings__roster">
        {loading && <div className="operator-settings__state">Loading operator roster…</div>}
        {!loading && error && (
          <div className="operator-settings__state operator-settings__state--error" role="alert">
            Could not load the operator roster. {error.message}
          </div>
        )}
        {!loading && !error && operators.length === 0 && (
          <div className="operator-settings__state">No operators have been added yet.</div>
        )}
        {!loading && !error && operators.length > 0 && (
          <div className="operator-settings__list">
            {renderGroup('Active', groups.active)}
            {renderGroup('Inactive', groups.inactive)}
          </div>
        )}
      </div>
    </section>
  );
}
