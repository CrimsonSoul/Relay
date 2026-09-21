import { useState } from 'react';
import {
  RULE_FIELDS,
  TICKET_EVENTS,
  type TicketRule,
  type TicketPreferences,
  TicketPreferencesSchema,
} from '@shared/serviceDesk';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';

export function TicketNotificationRules({
  onClose,
  live,
}: Readonly<{
  onClose: () => void;
  live: { preferences: TicketPreferences; savePreferences: (value: TicketPreferences) => void };
}>) {
  const [draft, setDraft] = useState(live.preferences);
  const [error, setError] = useState('');
  const desktop = globalThis.api?.runtime.kind === 'electron';
  function update(id: string, patch: Partial<TicketRule>) {
    setDraft((value) => ({
      ...value,
      rules: value.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  }
  function updateCondition(
    rule: TicketRule,
    index: number,
    patch: Partial<TicketRule['conditions'][number]>,
  ) {
    update(rule.id, {
      conditions: rule.conditions.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    });
  }
  function removeCondition(rule: TicketRule, index: number) {
    update(rule.id, { conditions: rule.conditions.filter((_, i) => i !== index) });
  }
  function toggleEvent(rule: TicketRule, event: TicketRule['events'][number], checked: boolean) {
    update(rule.id, {
      events: checked ? [...rule.events, event] : rule.events.filter((value) => value !== event),
    });
  }
  function save() {
    const parsed = TicketPreferencesSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    live.savePreferences(parsed.data);
    onClose();
  }
  return (
    <Modal
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      isOpen
      onClose={onClose}
      title="Ticket notification rules"
      variant="wide"
      subtitle="Rules are saved on this device. Live notices stay in memory. Shared delivery preferences apply to these rules."
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton variant="primary" onClick={save}>
            Save rules
          </TactileButton>
        </>
      }
    >
      <div className="ticket-form">
        {error && (
          <p role="alert" className="ticket-error">
            {error}
          </p>
        )}
        <div className="ticket-fields">
          <label>
            <span>SLA warning (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={draft.warningMinutes}
              onChange={(e) => setDraft({ ...draft, warningMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
        <p>
          Choose events and optional conditions. No conditions means every ticket. Use group
          “Unassigned” for tickets without a support group, or assignee with an empty value for no
          technician.
        </p>
        {draft.rules.map((rule) => (
          <fieldset className="ticket-rule" key={rule.id}>
            <legend>{rule.name || 'New rule'}</legend>
            <div className="ticket-fields">
              <label>
                <span>Rule name</span>
                <input
                  maxLength={120}
                  value={rule.name}
                  onChange={(e) => update(rule.id, { name: e.target.value })}
                />
              </label>
              <label className="ticket-check">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                />
                <span>Enabled</span>
              </label>
            </div>
            <div className="ticket-chips">
              {TICKET_EVENTS.map((event) => (
                <label key={event} className="ticket-check">
                  <input
                    type="checkbox"
                    checked={rule.events.includes(event)}
                    onChange={(e) => toggleEvent(rule, event, e.target.checked)}
                  />
                  {event}
                </label>
              ))}
            </div>
            <label>
              <span>Match</span>
              <select
                aria-label="Match"
                value={rule.match}
                onChange={(e) => update(rule.id, { match: e.target.value as TicketRule['match'] })}
              >
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </select>
            </label>
            {rule.conditions.map((condition, index) => (
              <div className="ticket-condition" key={`${rule.id}-${index}`}>
                <select
                  aria-label="Condition field"
                  value={condition.field}
                  onChange={(e) =>
                    updateCondition(rule, index, {
                      field: e.target.value as typeof condition.field,
                    })
                  }
                >
                  {RULE_FIELDS.filter((field) => field !== 'majorIncident').map((field) => (
                    <option key={field}>{field}</option>
                  ))}
                </select>
                <select
                  aria-label="Condition comparison"
                  value={condition.operator}
                  onChange={(e) =>
                    updateCondition(rule, index, {
                      operator: e.target.value as typeof condition.operator,
                    })
                  }
                >
                  {['is', 'is not', 'contains'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <input
                  aria-label="Condition value"
                  placeholder="Value (true/false for flags)"
                  maxLength={250}
                  value={condition.value}
                  onChange={(e) => updateCondition(rule, index, { value: e.target.value })}
                />
                <TactileButton size="sm" onClick={() => removeCondition(rule, index)}>
                  Remove
                </TactileButton>
              </div>
            ))}
            <TactileButton
              size="sm"
              disabled={rule.conditions.length >= 20}
              onClick={() =>
                update(rule.id, {
                  conditions: [
                    ...rule.conditions,
                    { field: 'group', operator: 'is', value: 'NOC' },
                  ],
                })
              }
            >
              Add condition
            </TactileButton>
            <div className="ticket-chips">
              {(['inbox', 'toast', 'desktop', 'sound'] as const).map((channel) => (
                <label key={channel} className="ticket-check">
                  <input
                    type="checkbox"
                    checked={rule[channel]}
                    disabled={!desktop && (channel === 'desktop' || channel === 'sound')}
                    onChange={(e) => update(rule.id, { [channel]: e.target.checked })}
                  />
                  {channel === 'toast' ? 'In-app popup' : channel}
                </label>
              ))}
            </div>
            <div className="ticket-actions">
              <label>
                <span>Cooldown per ticket/event (minutes)</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={rule.cooldownMinutes}
                  onChange={(e) => update(rule.id, { cooldownMinutes: Number(e.target.value) })}
                />
              </label>
              <TactileButton
                size="sm"
                onClick={() =>
                  setDraft({ ...draft, rules: draft.rules.filter((value) => value.id !== rule.id) })
                }
              >
                Delete rule
              </TactileButton>
            </div>
          </fieldset>
        ))}
        <TactileButton
          disabled={draft.rules.length >= 30}
          onClick={() =>
            setDraft({
              ...draft,
              rules: [
                ...draft.rules,
                {
                  id: crypto.randomUUID(),
                  name: 'New rule',
                  enabled: true,
                  events: ['created'],
                  match: 'all',
                  conditions: [],
                  inbox: true,
                  toast: true,
                  desktop: false,
                  sound: false,
                  cooldownMinutes: 0,
                },
              ],
            })
          }
        >
          Add rule
        </TactileButton>
        <p>
          Initial load and reconnect establish a baseline without replaying old alerts. Desktop
          delivery depends on OS notification settings; desktop and sound are available in the
          Electron app.
        </p>
      </div>
    </Modal>
  );
}
