import { useId, type ReactNode } from 'react';

type SettingsSwitchProps = Readonly<{
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  name?: string;
  /** Extra element ids that describe the switch, appended after the inline description. */
  describedBy?: string;
  onChange: (checked: boolean) => void;
}>;

/** The single on/off control for Settings; every boolean preference renders through it. */
export function SettingsSwitch({
  label,
  description,
  checked,
  disabled,
  name,
  describedBy,
  onChange,
}: SettingsSwitchProps) {
  const descriptionId = useId();
  const describedByIds =
    [description ? descriptionId : null, describedBy].filter(Boolean).join(' ') || undefined;

  return (
    <label className={`settings-switch${disabled ? ' settings-switch--disabled' : ''}`}>
      <span className="settings-switch__copy">
        <strong>{label}</strong>
        {description && <span id={descriptionId}>{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch__control"
        name={name}
        aria-label={label}
        aria-describedby={describedByIds}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
