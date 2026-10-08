import { useId, useState, type CSSProperties } from 'react';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { ACCENT_SCHEMES } from '../../theme/accent';
import {
  SDP_ROW_STATUSES,
  type SdpRowColors,
  type SdpRowStatus,
  type SdpRowStrength,
} from './sdpQueuePreferences';

/** The accent picker's presets, alert-like hues included: row colors are the operator's choice. */
const PRESETS = ACCENT_SCHEMES.map(({ label, swatch }) => ({
  name: label === 'Signal Red' ? 'Red' : label,
  color: swatch.toLowerCase(),
}));
const swatch = (color: string) => ({ ['--swatch' as string]: color }) as CSSProperties;
const tint = (color: string) => ({ ['--sdp-row-tint' as string]: color }) as CSSProperties;
const STRENGTHS: readonly { value: SdpRowStrength; label: string }[] = [
  { value: 'subtle', label: 'Subtle' },
  { value: 'vibrant', label: 'Vibrant' },
];
/** The class a table or list of tinted rows takes for the strong wash. */
export const VIBRANT_ROWS = 'has-vibrant-rows';

/**
 * The main status a ticket's status counts as, if any. SDP accounts add their own waiting states
 * (such as Waiting for Feedback), so any status starting with Waiting counts as Waiting.
 */
export function rowStatus(status: string | undefined): SdpRowStatus | undefined {
  const name = (status ?? '').trim().toLowerCase();
  if (name.startsWith('waiting')) return 'Waiting';
  return SDP_ROW_STATUSES.find((main) => main.toLowerCase() === name);
}
/** The row's tint, or nothing for a status without a color. */
export function rowTint(ticket: SdpQueueTicket, colors: SdpRowColors): CSSProperties | undefined {
  const status = rowStatus(ticket.status);
  const color = status && colors[status];
  return color ? tint(color) : undefined;
}

/** The colored statuses on this page; each row's Status column names its status too. */
export function SdpRowColorLegend({
  tickets,
  colors,
}: Readonly<{ tickets: readonly SdpQueueTicket[]; colors: SdpRowColors }>) {
  const present = new Set(tickets.map((ticket) => rowStatus(ticket.status)));
  const shown = SDP_ROW_STATUSES.filter((status) => present.has(status) && colors[status]);
  if (!shown.length) return null;
  return (
    <ul className="sdp-row-legend" aria-label="Row colors">
      {shown.map((status) => (
        <li key={status} style={swatch(colors[status]!)}>
          {status}
        </li>
      ))}
    </ul>
  );
}

/**
 * Chooses a color for each main status (a preset or any custom color) and how strongly rows are
 * tinted; each status previews its row. Saving is explicit, so Cancel leaves the rows unchanged.
 */
export function SdpRowColorsDialog({
  colors,
  strength,
  onSave,
  onClose,
}: Readonly<{
  colors: SdpRowColors;
  strength: SdpRowStrength;
  onSave: (colors: SdpRowColors, strength: SdpRowStrength) => void;
  onClose: () => void;
}>) {
  const [draft, setDraft] = useState<Partial<Record<SdpRowStatus, string>>>({ ...colors });
  const [draftStrength, setDraftStrength] = useState(strength);
  const id = useId();
  function choose(status: SdpRowStatus, color?: string) {
    setDraft((old) => {
      const next = { ...old };
      if (color) next[status] = color.toLowerCase();
      else delete next[status];
      return next;
    });
  }
  return (
    <Modal
      isOpen
      title="Row colors"
      subtitle="Tint queue rows by status. Saved on this device."
      width="640px"
      dialogClassName="modal-dialog-generic sdp-ticket-dialog"
      onClose={onClose}
      footer={
        <>
          <TactileButton onClick={onClose}>Cancel</TactileButton>
          <TactileButton variant="primary" onClick={() => onSave(draft, draftStrength)}>
            Save Colors
          </TactileButton>
        </>
      }
    >
      <fieldset className="sdp-row-strength">
        <legend>Strength</legend>
        {STRENGTHS.map(({ value, label }) => (
          <TactileButton
            key={value}
            size="sm"
            active={draftStrength === value}
            aria-pressed={draftStrength === value}
            onClick={() => setDraftStrength(value)}
          >
            {label}
          </TactileButton>
        ))}
      </fieldset>
      <p className="ticket-mode-note">
        Waiting includes statuses such as Waiting for Feedback. Other statuses stay uncolored.
      </p>
      <ul className={`sdp-row-colors ${draftStrength === 'vibrant' ? VIBRANT_ROWS : ''}`}>
        {SDP_ROW_STATUSES.map((status, index) => (
          <li
            key={status}
            className={draft[status] ? 'sdp-tinted-row' : undefined}
            style={draft[status] ? tint(draft[status]) : undefined}
          >
            <fieldset>
              <legend>{status}</legend>
              <RowColorChoices
                name={`${id}-${index}`}
                first={index === 0}
                status={status}
                current={draft[status]}
                onChoose={(color) => choose(status, color)}
              />
            </fieldset>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function RowColorChoices({
  name,
  first,
  status,
  current,
  onChoose,
}: Readonly<{
  name: string;
  /** The dialog opens on the first status's current choice. */
  first: boolean;
  status: SdpRowStatus;
  current?: string;
  onChoose: (color?: string) => void;
}>) {
  const custom = !!current && !PRESETS.some((preset) => preset.color === current);
  return (
    <div className="sdp-row-color-choices">
      {[undefined, ...PRESETS].map((preset) => (
        <label
          key={preset?.name ?? 'none'}
          className="sdp-row-color"
          title={preset?.name ?? 'No color'}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            data-autofocus={(first && current === preset?.color) || undefined}
            checked={current === preset?.color}
            onChange={() => onChoose(preset?.color)}
          />
          <span
            className={`sdp-row-color-swatch ${preset ? '' : 'is-none'}`}
            style={preset ? swatch(preset.color) : undefined}
            aria-hidden="true"
          />
          <span className="sr-only">{preset?.name ?? 'No color'}</span>
        </label>
      ))}
      {/* Any other color: the native picker, shown as a rainbow swatch until a custom color is set. */}
      <label
        className={`sdp-row-color ${custom ? 'is-chosen' : ''}`}
        title={custom ? `Custom color ${current}` : 'Custom color'}
      >
        <input
          type="color"
          className="sr-only"
          aria-label={`Custom color for ${status}`}
          data-autofocus={(first && custom) || undefined}
          value={current ?? '#808080'}
          onChange={(event) => onChoose(event.target.value)}
        />
        <span
          className={`sdp-row-color-swatch ${custom ? '' : 'is-custom'}`}
          style={custom ? swatch(current) : undefined}
          aria-hidden="true"
        />
      </label>
    </div>
  );
}
