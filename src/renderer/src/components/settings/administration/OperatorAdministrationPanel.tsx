import React, { useState } from 'react';
import { getOperatorDisplayNameError, normalizeOperatorDisplayName } from '@shared/operators';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function OperatorAdministrationPanel({
  snapshot,
  execute,
}: Readonly<AdministrationPanelProps>) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const createOperator = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const validation = getOperatorDisplayNameError(newName);
    if (validation) return setFeedback(validation);
    const displayName = normalizeOperatorDisplayName(newName);
    setBusyId('create');
    const result = await execute({
      command: 'operator.create',
      payload: { displayName },
      expectedRevision: null,
    });
    setBusyId(null);
    if (result.ok) {
      setNewName('');
      setFeedback(`Added ${displayName}.`);
    }
  };

  const renameOperator = async (operatorId: string, revision: number) => {
    const validation = getOperatorDisplayNameError(editName);
    if (validation) return setFeedback(validation);
    const displayName = normalizeOperatorDisplayName(editName);
    setBusyId(operatorId);
    const result = await execute({
      command: 'operator.rename',
      payload: { operatorId, displayName, expectedRevision: revision },
      expectedRevision: null,
    });
    setBusyId(null);
    if (result.ok) {
      setEditingId(null);
      setEditName('');
      setFeedback(`Renamed operator to ${displayName}.`);
    }
  };

  const setActive = async (operatorId: string, active: boolean, expectedRevision: number) => {
    setBusyId(operatorId);
    const result = await execute({
      command: 'operator.active.set',
      payload: { operatorId, active, expectedRevision },
      expectedRevision: null,
    });
    setBusyId(null);
    if (result.ok) setFeedback(active ? 'Operator reactivated.' : 'Operator deactivated.');
  };

  return (
    <section className="administration-panel" aria-labelledby="admin-operators-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">People</div>
          <h3 id="admin-operators-title">Operators & roles</h3>
          <p>Normal profiles remain passwordless. Roles only unlock protected administration.</p>
        </div>
        <span className="administration-panel__metric">{snapshot.operators.length} profiles</span>
      </header>

      <form className="administration-create" onSubmit={(event) => void createOperator(event)}>
        <label>
          <span>New operator</span>
          <input
            className="tactile-input"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={80}
          />
        </label>
        <TactileButton type="submit" variant="primary" loading={busyId === 'create'}>
          Add operator
        </TactileButton>
      </form>

      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}

      <div className="administration-list">
        {snapshot.operators.map((operator) => (
          <div className="administration-row" key={operator.id}>
            <div className="administration-row__identity">
              {editingId === operator.id ? (
                <label>
                  <span className="sr-only">Rename {operator.displayName}</span>
                  <input
                    autoFocus
                    className="tactile-input"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                  />
                </label>
              ) : (
                <strong>{operator.displayName}</strong>
              )}
              <span>{operator.active ? 'Active operator' : 'Inactive operator'}</span>
            </div>
            <div className="administration-row__badges">
              {operator.role && (
                <span className={`administration-chip administration-chip--${operator.role}`}>
                  {operator.role.toUpperCase()}
                </span>
              )}
            </div>
            <div className="administration-row__actions">
              {editingId === operator.id ? (
                <>
                  <TactileButton
                    size="sm"
                    variant="primary"
                    loading={busyId === operator.id}
                    onClick={() => void renameOperator(operator.id, operator.revision)}
                  >
                    Save
                  </TactileButton>
                  <TactileButton size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </TactileButton>
                </>
              ) : (
                <>
                  <TactileButton
                    size="sm"
                    onClick={() => {
                      setEditingId(operator.id);
                      setEditName(operator.displayName);
                    }}
                  >
                    Rename
                  </TactileButton>
                  <TactileButton
                    size="sm"
                    disabled={operator.role !== null || busyId !== null}
                    onClick={() => void setActive(operator.id, !operator.active, operator.revision)}
                  >
                    {operator.active ? 'Deactivate' : 'Reactivate'}
                  </TactileButton>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
