import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  getOperatorDisplayNameError,
  normalizeOperatorDisplayName,
  type RelayOperatorRecord,
} from '@shared/operators';
import { useOperator } from '../../contexts/OperatorContext';
import { ConfirmModal } from '../ConfirmModal';
import { TactileButton } from '../TactileButton';

type Props = {
  relayMode: PublicRelayConfig['mode'] | null;
  modeLoading: boolean;
};

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

type BusyOperation =
  | { kind: 'create' }
  | { kind: 'rename' | 'deactivate' | 'reactivate'; id: string };

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function OperatorSettingsSection({ relayMode, modeLoading }: Readonly<Props>) {
  const { operators, loading, error } = useOperator();
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newDisplayNameError, setNewDisplayNameError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deactivationTarget, setDeactivationTarget] = useState<RelayOperatorRecord | null>(null);
  const [busy, setBusy] = useState<BusyOperation | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const newDisplayNameRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const operatorRowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingRenameFocusRef = useRef<string | null>(null);

  const activeOperators = useMemo(
    () => operators.filter((operator) => operator.active),
    [operators],
  );
  const inactiveOperators = useMemo(
    () => operators.filter((operator) => !operator.active),
    [operators],
  );
  const canManage = !modeLoading && relayMode === 'server';

  useEffect(() => {
    if (!editingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingId]);

  useLayoutEffect(() => {
    if (editingId !== null || !pendingRenameFocusRef.current) return;

    const operatorId = pendingRenameFocusRef.current;
    pendingRenameFocusRef.current = null;
    operatorRowRefs.current
      .get(operatorId)
      ?.querySelector<HTMLButtonElement>('[data-operator-rename-trigger]')
      ?.focus();
  }, [editingId]);

  const showFailure = (message: string) => {
    setFeedback({ type: 'error', message });
    return new Error(message);
  };

  const handleCreate = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const validation = getOperatorDisplayNameError(newDisplayName);
    if (validation) {
      setNewDisplayNameError(validation);
      setFeedback(null);
      newDisplayNameRef.current?.focus();
      return;
    }

    const displayName = normalizeOperatorDisplayName(newDisplayName);
    setNewDisplayNameError(null);
    setFeedback(null);
    setBusy({ kind: 'create' });
    try {
      const result = await globalThis.api?.createRelayOperator?.({ displayName });
      if (!result?.success) {
        throw showFailure(result?.error || 'Could not add the operator.');
      }
      setNewDisplayName('');
      setFeedback({ type: 'success', message: `Added ${displayName}.` });
    } catch (createError) {
      const message = getErrorMessage(createError, 'Could not add the operator.');
      setFeedback({ type: 'error', message });
      requestAnimationFrame(() => newDisplayNameRef.current?.focus());
    } finally {
      setBusy(null);
    }
  };

  const beginRename = (operator: RelayOperatorRecord) => {
    setEditingId(operator.id);
    setRenameValue(operator.displayName);
    setRenameError(null);
    setFeedback(null);
  };

  const closeRename = (operatorId: string) => {
    pendingRenameFocusRef.current = operatorId;
    setEditingId(null);
    setRenameValue('');
    setRenameError(null);
  };

  const handleRename = async (operator: RelayOperatorRecord) => {
    const validation = getOperatorDisplayNameError(renameValue);
    if (validation) {
      setRenameError(validation);
      renameInputRef.current?.focus();
      return;
    }

    const displayName = normalizeOperatorDisplayName(renameValue);
    setRenameError(null);
    setFeedback(null);
    setBusy({ kind: 'rename', id: operator.id });
    try {
      const result = await globalThis.api?.renameRelayOperator?.({
        id: operator.id,
        displayName,
        expectedUpdated: operator.updated,
      });
      if (!result?.success) {
        throw showFailure(result?.error || 'Could not rename the operator.');
      }
      closeRename(operator.id);
      setFeedback({
        type: 'success',
        message: `Renamed ${operator.displayName} to ${displayName}.`,
      });
    } catch (renameFailure) {
      const message = getErrorMessage(renameFailure, 'Could not rename the operator.');
      setFeedback({ type: 'error', message });
      requestAnimationFrame(() => renameInputRef.current?.focus());
    } finally {
      setBusy(null);
    }
  };

  const handleSetActive = async (operator: RelayOperatorRecord, active: boolean) => {
    const verb = active ? 'reactivate' : 'deactivate';
    setFeedback(null);
    setBusy({ kind: active ? 'reactivate' : 'deactivate', id: operator.id });
    try {
      const result = await globalThis.api?.setRelayOperatorActive?.({
        id: operator.id,
        active,
        expectedUpdated: operator.updated,
      });
      if (!result?.success) {
        throw showFailure(result?.error || `Could not ${verb} the operator.`);
      }
      setFeedback({
        type: 'success',
        message: `${active ? 'Reactivated' : 'Deactivated'} ${operator.displayName}.`,
      });
    } catch (activeFailure) {
      const failure = showFailure(
        getErrorMessage(activeFailure, `Could not ${verb} the operator.`),
      );
      if (!active) throw failure;
    } finally {
      setBusy(null);
    }
  };

  const handleRenameKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    operator: RelayOperatorRecord,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeRename(operator.id);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleRename(operator);
    }
  };

  const renderOperatorActions = (
    operator: RelayOperatorRecord,
    isEditing: boolean,
    isRenaming: boolean,
    isReactivating: boolean,
    disableRowActions: boolean,
  ) => {
    if (!canManage) return null;

    if (isEditing) {
      return (
        <div className="operator-settings__actions">
          <TactileButton
            size="sm"
            variant="primary"
            className="operator-settings__action"
            disabled={isRenaming}
            loading={isRenaming}
            onClick={() => void handleRename(operator)}
          >
            Save
          </TactileButton>
          <TactileButton
            size="sm"
            className="operator-settings__action"
            disabled={isRenaming}
            onClick={() => closeRename(operator.id)}
          >
            Cancel
          </TactileButton>
        </div>
      );
    }

    return (
      <div className="operator-settings__actions">
        <TactileButton
          data-operator-rename-trigger
          size="sm"
          className="operator-settings__action"
          aria-label={`Rename ${operator.displayName}`}
          disabled={disableRowActions}
          onClick={() => beginRename(operator)}
        >
          Rename
        </TactileButton>
        {operator.active ? (
          <TactileButton
            size="sm"
            className="operator-settings__action"
            aria-label={`Deactivate ${operator.displayName}`}
            disabled={disableRowActions}
            onClick={() => setDeactivationTarget(operator)}
          >
            Deactivate
          </TactileButton>
        ) : (
          <TactileButton
            size="sm"
            variant="primary"
            className="operator-settings__action"
            aria-label={
              isReactivating
                ? `Reactivating ${operator.displayName}…`
                : `Reactivate ${operator.displayName}`
            }
            disabled={disableRowActions || isReactivating}
            loading={isReactivating}
            onClick={() => void handleSetActive(operator, true)}
          >
            {isReactivating ? `Reactivating ${operator.displayName}…` : 'Reactivate'}
          </TactileButton>
        )}
      </div>
    );
  };

  const renderOperatorRow = (operator: RelayOperatorRecord) => {
    const isEditing = editingId === operator.id;
    const isRenaming = busy?.kind === 'rename' && busy.id === operator.id;
    const isReactivating = busy?.kind === 'reactivate' && busy.id === operator.id;
    const disableRowActions = busy !== null || editingId !== null;
    const renameErrorId = `operator-rename-error-${operator.id}`;

    return (
      <div
        ref={(element) => {
          if (element) operatorRowRefs.current.set(operator.id, element);
          else operatorRowRefs.current.delete(operator.id);
        }}
        className="operator-settings__row"
        key={operator.id}
      >
        {isEditing ? (
          <div className="operator-settings__rename">
            <label className="sr-only" htmlFor={`operator-rename-${operator.id}`}>
              Rename {operator.displayName}
            </label>
            <input
              ref={renameInputRef}
              id={`operator-rename-${operator.id}`}
              className="tactile-input operator-settings__rename-input"
              value={renameValue}
              disabled={isRenaming}
              aria-invalid={renameError ? true : undefined}
              aria-describedby={renameError ? renameErrorId : undefined}
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(null);
                setFeedback(null);
              }}
              onKeyDown={(event) => handleRenameKeyDown(event, operator)}
            />
            {renameError && (
              <div id={renameErrorId} className="operator-settings__validation" role="alert">
                {renameError}
              </div>
            )}
          </div>
        ) : (
          <div className="operator-settings__identity">
            <span className="operator-settings__name">{operator.displayName}</span>
            <span className="operator-settings__status">
              {operator.active ? 'Active' : 'Inactive'}
            </span>
          </div>
        )}

        {renderOperatorActions(operator, isEditing, isRenaming, isReactivating, disableRowActions)}
      </div>
    );
  };

  const renderGroup = (label: 'Active' | 'Inactive', groupOperators: RelayOperatorRecord[]) => (
    <section
      className="operator-settings__group"
      role="group"
      aria-label={`${label} operators, ${groupOperators.length}`}
    >
      <div className="operator-settings__group-heading" aria-hidden="true">
        <span>{label}</span>
        <span className="operator-settings__count">{groupOperators.length}</span>
      </div>
      <div className="operator-settings__rows">
        {groupOperators.length === 0 ? (
          <div className="operator-settings__group-empty">No {label.toLowerCase()} operators.</div>
        ) : (
          groupOperators.map(renderOperatorRow)
        )}
      </div>
    </section>
  );

  let capabilityMessage = 'Relay is not configured.';
  if (modeLoading) capabilityMessage = 'Checking this workstation’s Relay role…';
  else if (relayMode === 'server') capabilityMessage = 'Server management controls available.';
  else if (relayMode === 'client') {
    capabilityMessage = 'Operator management is available only on the Relay server.';
  }

  const createBusy = busy?.kind === 'create';
  const newDisplayNameErrorId = newDisplayNameError ? 'operator-create-error' : undefined;

  return (
    <section className="settings-section operator-settings" aria-labelledby="operator-roster-title">
      <div className="operator-settings__header">
        <h2 id="operator-roster-title" className="operator-settings__title">
          Operator roster
        </h2>
        <p className="settings-description">
          Keep attribution names current while preserving the operator attached to existing history.
        </p>
        <div className="operator-settings__capability">{capabilityMessage}</div>
      </div>

      {canManage && (
        <form className="operator-settings__add" onSubmit={(event) => void handleCreate(event)}>
          <div className="operator-settings__field">
            <label className="operator-settings__label" htmlFor="operator-create-name">
              New operator name
            </label>
            <input
              ref={newDisplayNameRef}
              id="operator-create-name"
              className="tactile-input"
              value={newDisplayName}
              disabled={createBusy}
              aria-invalid={newDisplayNameError ? true : undefined}
              aria-describedby={newDisplayNameErrorId}
              onChange={(event) => {
                setNewDisplayName(event.target.value);
                setNewDisplayNameError(null);
                setFeedback(null);
              }}
            />
            {newDisplayNameError && (
              <div
                id="operator-create-error"
                className="operator-settings__validation"
                role="alert"
              >
                {newDisplayNameError}
              </div>
            )}
          </div>
          <TactileButton
            type="submit"
            variant="primary"
            className="operator-settings__add-button"
            disabled={busy !== null || editingId !== null}
            loading={createBusy}
          >
            {createBusy ? 'Adding…' : 'Add operator'}
          </TactileButton>
        </form>
      )}

      {feedback && (
        <div
          className={`operator-settings__feedback operator-settings__feedback--${feedback.type}`}
          role={feedback.type === 'error' ? 'alert' : 'status'}
          aria-live={feedback.type === 'error' ? 'assertive' : 'polite'}
        >
          {feedback.message}
        </div>
      )}

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
            {renderGroup('Active', activeOperators)}
            {renderGroup('Inactive', inactiveOperators)}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={deactivationTarget !== null}
        onClose={() => setDeactivationTarget(null)}
        onConfirm={() =>
          deactivationTarget ? handleSetActive(deactivationTarget, false) : Promise.resolve()
        }
        title={`Deactivate ${deactivationTarget?.displayName ?? 'operator'}?`}
        message={`Existing history stays attributed to ${deactivationTarget?.displayName ?? 'this operator'}. They will no longer be available for new attributed actions until reactivated.`}
        confirmLabel="Deactivate"
        isDanger
      />
    </section>
  );
}
