import React, { useEffect, useState } from 'react';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function PublisherAssignmentPanel({
  snapshot,
  execute,
}: Readonly<AdministrationPanelProps>) {
  const { reauthenticate, busy } = usePrivilegedAccess();
  const [selectedId, setSelectedId] = useState(snapshot.publisherOperatorId ?? '');
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(
    () => setSelectedId(snapshot.publisherOperatorId ?? ''),
    [snapshot.publisherOperatorId],
  );
  useEffect(() => () => setPassword(''), []);

  const assign = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const proof = await reauthenticate(password);
    setPassword('');
    if (!proof) return;
    const result = await execute({
      command: 'publisher.assign',
      payload: {
        operatorId: selectedId || null,
        expectedStateRevision: snapshot.assignmentRevision,
        reauthRequestId: proof.proofId,
      },
      expectedRevision: null,
    });
    if (result.ok) {
      setConfirming(false);
      setFeedback(
        selectedId ? 'Knowledge Publisher assignment updated.' : 'Publisher role removed.',
      );
    }
  };

  return (
    <section className="administration-panel" aria-labelledby="publisher-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Knowledge Base</div>
          <h3 id="publisher-title">Designated publisher</h3>
          <p>Exactly one existing operator can manage documents alongside the administrator.</p>
        </div>
      </header>
      <div className="administration-callout">
        <strong>Role changes are protected</strong>
        <span>
          Reassignment disables the previous publisher session and requires local password setup for
          the new publisher.
        </span>
      </div>
      <label className="administration-field">
        <span>Designated Knowledge Publisher</span>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">No publisher</option>
          {snapshot.operators
            .filter((operator) => operator.active && operator.id !== snapshot.adminOperatorId)
            .map((operator) => (
              <option key={operator.id} value={operator.id}>
                {operator.displayName}
              </option>
            ))}
        </select>
      </label>
      <div className="administration-actions">
        <TactileButton
          variant="primary"
          disabled={selectedId === (snapshot.publisherOperatorId ?? '')}
          onClick={() => setConfirming(true)}
        >
          Review publisher change
        </TactileButton>
      </div>
      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}

      {confirming && (
        <div className="administration-dialog-backdrop">
          <form
            className="administration-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publisher-confirm-title"
            onSubmit={(event) => void assign(event)}
          >
            <div className="settings-section-heading">High-risk change</div>
            <h4 id="publisher-confirm-title">Confirm publisher change</h4>
            <p>This immediately revokes the previous publisher’s protected sessions.</p>
            <label className="administration-field">
              <span>Administrator password</span>
              <input
                autoFocus
                type="password"
                className="tactile-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <div className="administration-actions">
              <TactileButton type="submit" variant="primary" loading={busy === 'reauthenticate'}>
                Assign publisher
              </TactileButton>
              <TactileButton
                type="button"
                onClick={() => {
                  setPassword('');
                  setConfirming(false);
                }}
              >
                Cancel
              </TactileButton>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
