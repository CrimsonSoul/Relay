import React, { useId } from 'react';
import type { Contact } from '@shared/ipc';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import type { BridgeHandoffRecipient } from './bridgeHandoff';

type BridgeHandoffModalProps = {
  isOpen: boolean;
  onClose: () => void;
  subject: string;
  recipients: BridgeHandoffRecipient[];
  duplicateCount: number;
  manualCount: number;
  groupNames: string[];
  contactMap: Map<string, Contact>;
  isCopying: boolean;
  isOpeningTeams: boolean;
  onCopy: () => void;
  onOpenTeams: () => void;
  onRemoveRecipient: (email: string) => void;
};

export const BridgeHandoffModal: React.FC<BridgeHandoffModalProps> = (props) => {
  const recordingTitleId = useId();
  const invalid = props.recipients.filter((recipient) => !recipient.valid);
  const isBusy = props.isCopying || props.isOpeningTeams;
  const canHandoff = props.recipients.length > 0 && invalid.length === 0 && !isBusy;
  const recipientNoun = props.recipients.length === 1 ? 'person' : 'people';
  const duplicateNoun = props.duplicateCount === 1 ? 'duplicate' : 'duplicates';
  const groupNoun = props.groupNames.length === 1 ? 'group' : 'groups';
  let recipientCheck = 'No address issues found';
  if (invalid.length === 1) recipientCheck = '1 address needs attention';
  if (invalid.length > 1) recipientCheck = `${invalid.length} addresses need attention`;

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="Open Teams meeting draft?"
      variant="wide"
      bodyClassName="bridge-handoff-body"
      dialogProps={{ className: 'bridge-handoff-dialog' }}
      dismissible={!isBusy}
      footer={
        <>
          <TactileButton onClick={props.onClose} disabled={isBusy}>
            Cancel
          </TactileButton>
          <TactileButton onClick={props.onCopy} loading={props.isCopying} disabled={!canHandoff}>
            Copy Recipients
          </TactileButton>
          <TactileButton
            variant="primary"
            onClick={props.onOpenTeams}
            loading={props.isOpeningTeams}
            disabled={!canHandoff}
          >
            Open Teams Draft
          </TactileButton>
        </>
      }
    >
      <section className="bridge-handoff-recording" aria-labelledby={recordingTitleId}>
        <span className="bridge-handoff-recording-icon" aria-hidden="true">
          ●
        </span>
        <div>
          <h3 id={recordingTitleId}>Enable recording in Teams</h3>
          <p>
            Start recording as soon as the bridge begins. Relay cannot enable or verify it for you.
          </p>
        </div>
      </section>

      <dl className="bridge-handoff-summary" aria-label="Teams handoff summary">
        <div>
          <dt>Draft subject</dt>
          <dd>{props.subject}</dd>
        </div>
        <div>
          <dt>Recipients</dt>
          <dd>
            {props.recipients.length} {recipientNoun} · {props.duplicateCount} {duplicateNoun}{' '}
            collapsed
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {props.groupNames.length} {groupNoun} · {props.manualCount} manual
          </dd>
        </div>
        <div>
          <dt>Groups</dt>
          <dd>{props.groupNames.join(' · ') || 'Manual recipients only'}</dd>
        </div>
        <div className={invalid.length ? 'is-warning' : 'is-valid'}>
          <dt>Recipient check</dt>
          <dd>{recipientCheck}</dd>
        </div>
      </dl>

      <details className="bridge-handoff-recipients">
        <summary>
          View all {props.recipients.length}{' '}
          {props.recipients.length === 1 ? 'recipient' : 'recipients'}
        </summary>
        <ul>
          {props.recipients.map((recipient) => {
            const contact = props.contactMap.get(recipient.normalizedEmail);
            return (
              <li
                key={recipient.normalizedEmail}
                className={recipient.valid ? undefined : 'is-invalid'}
              >
                <span>
                  <strong>{contact?.name || recipient.email}</strong>
                  {contact?.name && <small>{recipient.email}</small>}
                </span>
                {!recipient.valid && (
                  <TactileButton
                    size="sm"
                    variant="danger"
                    aria-label={`Remove ${recipient.email}`}
                    onClick={() => props.onRemoveRecipient(recipient.email)}
                    disabled={isBusy}
                  >
                    Remove
                  </TactileButton>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    </Modal>
  );
};
