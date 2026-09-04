import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  ACCENT_SCHEMES,
  ACCENT_SCHEDULE_SLOTS,
  customAccentScheduleChoice,
  customHexFromScheduleChoice,
  getStoredAccent,
  getStoredAccentSchedule,
  getStoredCustomAccent,
  getStoredCustomAccents,
  normalizeHexAccent,
  removeCustomAccent,
  setAccent as persistAccent,
  setAccentScheduleEnabled,
  setAccentScheduleSlot,
  setCustomAccent,
  setSavedCustomAccent,
  type AccentScheduleChoice,
  type AccentScheduleSlotId,
  type AccentId,
} from '../../theme/accent';
import { TactileButton } from '../TactileButton';
import { getRelayRuntime } from '../../runtime/relayRuntime';

const CUSTOM_ACCENT_EXAMPLE = '#2dd4bf';

type AppearanceSettingsState = {
  accent: AccentId;
  setAccent: React.Dispatch<React.SetStateAction<AccentId>>;
  savedCustomAccents: string[];
  setSavedCustomAccents: React.Dispatch<React.SetStateAction<string[]>>;
  activeCustomAccent: string | null;
  setActiveCustomAccent: React.Dispatch<React.SetStateAction<string | null>>;
  customAccentInput: string;
  setCustomAccentInput: React.Dispatch<React.SetStateAction<string>>;
  accentSchedule: ReturnType<typeof getStoredAccentSchedule>;
  setAccentSchedule: React.Dispatch<
    React.SetStateAction<ReturnType<typeof getStoredAccentSchedule>>
  >;
};

const AppearanceSettingsContext = createContext<AppearanceSettingsState | null>(null);

export function AppearanceSettingsProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [accent, setAccent] = useState<AccentId>(() => getStoredAccent());
  const [savedCustomAccents, setSavedCustomAccents] = useState<string[]>(() =>
    getStoredCustomAccents(),
  );
  const [activeCustomAccent, setActiveCustomAccent] = useState<string | null>(() =>
    getStoredCustomAccent(),
  );
  const [customAccentInput, setCustomAccentInput] = useState(() => getStoredCustomAccent() ?? '');
  const [accentSchedule, setAccentSchedule] = useState(() => getStoredAccentSchedule());

  const value = useMemo<AppearanceSettingsState>(
    () => ({
      accent,
      setAccent,
      savedCustomAccents,
      setSavedCustomAccents,
      activeCustomAccent,
      setActiveCustomAccent,
      customAccentInput,
      setCustomAccentInput,
      accentSchedule,
      setAccentSchedule,
    }),
    [accent, accentSchedule, activeCustomAccent, customAccentInput, savedCustomAccents],
  );

  return (
    <AppearanceSettingsContext.Provider value={value}>
      {children}
    </AppearanceSettingsContext.Provider>
  );
}

function useAppearanceSettings(): AppearanceSettingsState {
  const context = useContext(AppearanceSettingsContext);
  if (!context) {
    throw new Error('useAppearanceSettings must be used within AppearanceSettingsProvider');
  }
  return context;
}

export function AppearanceSettings({ active }: Readonly<{ active: boolean }>) {
  const {
    accent,
    setAccent,
    savedCustomAccents,
    setSavedCustomAccents,
    activeCustomAccent,
    setActiveCustomAccent,
    customAccentInput,
    setCustomAccentInput,
    accentSchedule,
    setAccentSchedule,
  } = useAppearanceSettings();

  const handleAccentSelect = (id: AccentId) => {
    persistAccent(id);
    setAccent(id);
    if (id !== 'custom') setActiveCustomAccent(getStoredCustomAccent());
  };

  const normalizedCustomAccent = normalizeHexAccent(customAccentInput);
  const customAccentHasInput = customAccentInput.trim().length > 0;
  const customAccentInvalid = customAccentHasInput && !normalizedCustomAccent;
  const customAccentPreview =
    normalizedCustomAccent ??
    activeCustomAccent ??
    savedCustomAccents.at(-1) ??
    CUSTOM_ACCENT_EXAMPLE;

  const handleCustomAccentSave = () => {
    const saved = setCustomAccent(customAccentInput);
    if (!saved) return;
    setSavedCustomAccents(getStoredCustomAccents());
    setActiveCustomAccent(saved);
    setCustomAccentInput(saved);
    setAccent('custom');
  };

  const handleSavedCustomAccentSelect = (hex: string) => {
    const selected = setSavedCustomAccent(hex);
    if (!selected) return;
    setActiveCustomAccent(selected);
    setCustomAccentInput(selected);
    setAccent('custom');
  };

  const handleCustomAccentRemove = (hex: string) => {
    const remainingCustomAccents = removeCustomAccent(hex);
    const nextActiveCustomAccent = getStoredCustomAccent();
    setSavedCustomAccents(remainingCustomAccents);
    setActiveCustomAccent(nextActiveCustomAccent);
    setAccent(getStoredAccent());
    if (nextActiveCustomAccent) setCustomAccentInput(nextActiveCustomAccent);
  };

  const scheduledCustomAccents = useMemo(
    () =>
      Object.values(accentSchedule.slots)
        .map((choice) => customHexFromScheduleChoice(choice))
        .filter((hex): hex is string => hex !== null),
    [accentSchedule.slots],
  );

  const accentScheduleChoices = useMemo(() => {
    const customChoices = [...savedCustomAccents, ...scheduledCustomAccents].filter(
      (hex, index, values) => values.indexOf(hex) === index,
    );

    return [
      ...ACCENT_SCHEMES.map((scheme) => ({
        value: scheme.id as AccentScheduleChoice,
        label: scheme.label,
        swatch: scheme.swatch,
      })),
      ...customChoices.flatMap((hex, index) => {
        const value = customAccentScheduleChoice(hex);
        return value ? [{ value, label: `Custom ${index + 1} ${hex}`, swatch: hex }] : [];
      }),
    ];
  }, [savedCustomAccents, scheduledCustomAccents]);

  const getScheduleChoiceSwatch = (choice: AccentScheduleChoice) =>
    accentScheduleChoices.find((option) => option.value === choice)?.swatch ?? '#ffffff';

  const syncAccentStateFromStorage = () => {
    setAccent(getStoredAccent());
    setActiveCustomAccent(getStoredCustomAccent());
  };

  const handleAccentScheduleToggle = () => {
    const nextSchedule = setAccentScheduleEnabled(!accentSchedule.enabled);
    setAccentSchedule(nextSchedule);
    syncAccentStateFromStorage();
  };

  const handleAccentScheduleSlotChange = (
    slotId: AccentScheduleSlotId,
    choice: AccentScheduleChoice,
  ) => {
    const nextSchedule = setAccentScheduleSlot(slotId, choice);
    setAccentSchedule(nextSchedule);
    syncAccentStateFromStorage();
  };

  if (!active) return null;

  return (
    <div className="settings-section settings-section--appearance">
      <div className="settings-section-heading">Appearance</div>
      <div className="settings-appearance-accent">
        <div className="settings-description">
          Choose the signal color used for navigation, focus, and primary actions.
        </div>
        <div className="settings-subsection-label">Accent color</div>
        <div className="accent-picker" role="radiogroup" aria-label="Accent color">
          {ACCENT_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              role="radio"
              aria-checked={accent === scheme.id}
              title={scheme.label}
              className={`accent-picker-swatch${accent === scheme.id ? ' accent-picker-swatch--active' : ''}`}
              style={{ ['--swatch' as string]: scheme.swatch }}
              onClick={() => handleAccentSelect(scheme.id)}
            >
              <span className="accent-picker-swatch-label">{scheme.label}</span>
            </button>
          ))}
        </div>
        <div className="custom-accent-control">
          <label className="custom-accent-label" htmlFor="custom-accent-input">
            Custom
          </label>
          {savedCustomAccents.length > 0 && (
            <div
              className="custom-accent-saved"
              role="radiogroup"
              aria-label="Saved custom accent colors"
            >
              {savedCustomAccents.map((hex, index) => {
                const isActive = accent === 'custom' && activeCustomAccent === hex;
                return (
                  <div className="custom-accent-saved-item" key={hex}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={`Custom accent ${hex}`}
                      title={`Custom ${hex}`}
                      className={`accent-picker-swatch custom-accent-saved-swatch${isActive ? ' accent-picker-swatch--active' : ''}`}
                      style={{ ['--swatch' as string]: hex }}
                      onClick={() => handleSavedCustomAccentSelect(hex)}
                    >
                      <span className="accent-picker-swatch-label">Custom {index + 1}</span>
                    </button>
                    <button
                      type="button"
                      className="custom-accent-remove"
                      aria-label={`Remove custom accent ${hex}`}
                      title={`Remove ${hex}`}
                      onClick={() => handleCustomAccentRemove(hex)}
                    >
                      x
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="custom-accent-row">
            <input
              type="color"
              className="custom-accent-color-input"
              value={customAccentPreview}
              aria-label="Pick custom accent color"
              onChange={(event) => setCustomAccentInput(event.target.value)}
            />
            <input
              id="custom-accent-input"
              type="text"
              className="custom-accent-hex-input"
              value={customAccentInput}
              placeholder={CUSTOM_ACCENT_EXAMPLE}
              aria-label="Custom accent hex code"
              aria-invalid={customAccentInvalid}
              aria-describedby={customAccentInvalid ? 'custom-accent-error' : undefined}
              spellCheck={false}
              onChange={(event) => setCustomAccentInput(event.target.value)}
            />
            <TactileButton
              type="button"
              size="sm"
              variant="primary"
              className="custom-accent-save-button"
              aria-label="Save custom accent color"
              disabled={!normalizedCustomAccent}
              onClick={handleCustomAccentSave}
            >
              Save
            </TactileButton>
          </div>
          {customAccentInvalid && (
            <div id="custom-accent-error" className="settings-field-error">
              Enter a 3 or 6 digit hex color.
            </div>
          )}
        </div>
      </div>
      <div className="accent-schedule-control">
        <div className="accent-schedule-header">
          <div className="accent-schedule-heading-group">
            <div className="custom-accent-label">Accent Schedule</div>
            <div className="accent-schedule-description">
              Fixed Central Time shift windows.
              {getRelayRuntime().kind === 'web' && ' Saved only in this browser.'}
            </div>
          </div>
          <button
            type="button"
            className={`settings-inline-action accent-schedule-toggle${
              accentSchedule.enabled ? ' accent-schedule-toggle--active' : ''
            }`}
            aria-label="Auto accent schedule"
            aria-pressed={accentSchedule.enabled}
            onClick={handleAccentScheduleToggle}
          >
            {accentSchedule.enabled ? 'On' : 'Off'}
          </button>
        </div>
        <div className="accent-schedule-list">
          {ACCENT_SCHEDULE_SLOTS.map((slot) => {
            const selectedChoice = accentSchedule.slots[slot.id];
            return (
              <div className="accent-schedule-row" key={slot.id}>
                <span
                  className="accent-schedule-swatch"
                  style={
                    {
                      '--schedule-swatch': getScheduleChoiceSwatch(selectedChoice),
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                />
                <label className="accent-schedule-label" htmlFor={`accent-schedule-${slot.id}`}>
                  <span className="accent-schedule-name">{slot.label}</span>
                  <span className="accent-schedule-time">{slot.rangeLabel}</span>
                </label>
                <select
                  id={`accent-schedule-${slot.id}`}
                  className="accent-schedule-select"
                  aria-label={`${slot.label} accent`}
                  value={selectedChoice}
                  onChange={(event) =>
                    handleAccentScheduleSlotChange(
                      slot.id,
                      event.target.value as AccentScheduleChoice,
                    )
                  }
                >
                  {accentScheduleChoices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
