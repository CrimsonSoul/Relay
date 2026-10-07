import { useId, useState } from 'react';
import { SDP_MAX_QUEUES, SDP_QUEUES, type SdpQueue } from '@shared/sdpAccount';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { SdpStandardSelect } from './SdpStandardSelect';
import { cleanSdpQueues } from './sdpQueuePreferences';

/**
 * Reorders, removes and adds queue tabs. An added queue is an SDP support group; removed default
 * queues can be added back. Saving is explicit, so Cancel leaves the tabs unchanged.
 */
export function SdpQueueManager({
  queues,
  onSave,
  onClose,
}: Readonly<{
  queues: readonly SdpQueue[];
  onSave: (queues: SdpQueue[]) => void;
  onClose: () => void;
}>) {
  const [draft, setDraft] = useState<SdpQueue[]>([...queues]);
  const [group, setGroup] = useState('');
  const [message, setMessage] = useState('');
  const listId = useId();
  const full = draft.length >= SDP_MAX_QUEUES;
  const has = (name: string) => draft.some((queue) => queue.toUpperCase() === name.toUpperCase());
  const missingDefaults = SDP_QUEUES.filter((queue) => !has(queue));
  function move(index: number, step: -1 | 1) {
    setDraft((old) => {
      const next = [...old];
      [next[index], next[index + step]] = [next[index + step]!, next[index]!];
      return next;
    });
    setMessage(`${draft[index]} moved ${step < 0 ? 'up' : 'down'}.`);
  }
  function remove(index: number) {
    setMessage(`${draft[index]} removed.`);
    setDraft((old) => old.filter((_, at) => at !== index));
  }
  function add(name: string) {
    const [queue] = cleanSdpQueues([name.trim()]);
    if (!queue) return setMessage('Choose a support group to add.');
    if (has(queue)) return setMessage(`${queue} is already a queue.`);
    if (full) return setMessage(`Keep at most ${SDP_MAX_QUEUES} queues.`);
    setDraft((old) => [...old, queue]);
    setGroup('');
    setMessage(`${queue} added.`);
  }
  return (
    <Modal
      isOpen
      title="Manage queues"
      subtitle="Tabs appear in this order. Saved on this device."
      width="560px"
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      onClose={onClose}
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton variant="primary" disabled={!draft.length} onClick={() => onSave(draft)}>
            Save Queues
          </TactileButton>
        </>
      }
    >
      <div className="sdp-queue-manager-heading">
        <h3 id={listId} className="toolbar-title">
          Queue tabs
        </h3>
        <span>
          {draft.length} of {SDP_MAX_QUEUES}
        </span>
      </div>
      <ol className="sdp-queue-manager" aria-labelledby={listId}>
        {draft.map((queue, index) => (
          <li key={queue}>
            <TactileButton
              size="xs"
              aria-label={`Move ${queue} up`}
              icon={<span aria-hidden="true">↑</span>}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            />
            <TactileButton
              size="xs"
              aria-label={`Move ${queue} down`}
              icon={<span aria-hidden="true">↓</span>}
              disabled={index === draft.length - 1}
              onClick={() => move(index, 1)}
            />
            <span className="sdp-queue-manager-name">{queue}</span>
            <TactileButton
              size="xs"
              variant="ghost"
              aria-label={`Remove ${queue}`}
              tooltip={draft.length === 1 ? 'Keep at least one queue' : undefined}
              disabled={draft.length === 1}
              onClick={() => remove(index)}
            >
              Remove
            </TactileButton>
          </li>
        ))}
      </ol>
      <div className="sdp-queue-manager-add">
        <SdpStandardSelect
          field="group"
          label="Support group"
          value={group}
          disabled={full}
          onChange={(name) => setGroup(name)}
        />
        <div className="ticket-actions">
          <TactileButton size="sm" disabled={full || !group} onClick={() => add(group)}>
            Add Queue
          </TactileButton>
          {missingDefaults.map((queue) => (
            <TactileButton key={queue} size="sm" disabled={full} onClick={() => add(queue)}>
              Add {queue}
            </TactileButton>
          ))}
          {full && <span className="ticket-mode-note">Remove a queue to add another.</span>}
        </div>
      </div>
      <p className="ticket-mode-note">
        NOC, SOX and Unassigned are always checked for notification rules, even without a tab.
      </p>
      <output className="sr-only" aria-live="polite">
        {message}
      </output>
    </Modal>
  );
}
