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
import { Tooltip } from '../Tooltip';
import { getRelayRuntime } from '../../runtime/relayRuntime';
import { SettingsSwitch } from './SettingsSwitch';

// The hex field's placeholder names the format, not a colour, so an empty field never reads as set.
const CUSTOM_ACCENT_PLACEHOLDER = '#rrggbb';
// Where the native picker opens when there is no draft, active or saved custom accent yet.
const CUSTOM_ACCENT_PICKER_FALLBACK = '#2dd4bf';
const ACCENT_SCHEDULE_REASON_ID = 'accent-schedule-reason';
const CUSTOM_ACCENT_INPUT_ID = 'custom-accent-input';
const CUSTOM_ACCENT_ERROR_ID = 'custom-accent-error';

const RADIO_STEP_KEYS: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Roving radiogroup keys: arrows move focus and select, Home/End jump to the ends. */
function handleRadioGroupKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
  const group = event.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const currentIndex = radios.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex: number | null = null;
  const step = RADIO_STEP_KEYS[event.key];
  if (step) nextIndex = (currentIndex + step + radios.length) % radios.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = radios.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const nextRadio = radios[nextIndex];
  nextRadio?.focus();
  nextRadio?.click();
}

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

/** Roving tab stop for the saved custom swatches: the active one, else the first. */
function getCustomTabStop(
  accent: AccentId,
  activeCustomAccent: string | null,
  savedCustomAccents: readonly string[],
): string | undefined {
  return accent === 'custom' &&
    activeCustomAccent &&
    savedCustomAccents.includes(activeCustomAccent)
    ? activeCustomAccent
    : savedCustomAccents[0];
}

/** Empty well without a valid draft, inset mat for a draft, plain swatch for the current accent. */
function getCustomSwatchModifier(draft: string | null, isCurrentAccent: boolean): string {
  if (!draft) return ' custom-accent-color-input--empty';
  return isCurrentAccent ? '' : ' custom-accent-color-input--draft';
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

  // Before the first Save the field only flags a typed value that can never be a colour; once Save
  // has been tried, an empty field is flagged too.
  const [customAccentSaveAttempted, setCustomAccentSaveAttempted] = useState(false);
  const normalizedCustomAccent = normalizeHexAccent(customAccentInput);
  const customAccentHasInput = customAccentInput.trim().length > 0;
  const customAccentInvalid =
    !normalizedCustomAccent && (customAccentHasInput || customAccentSaveAttempted);
  // The swatch previews only a valid draft. Empty or invalid input shows a neutral empty swatch
  // (never the picker fallback colour) and no "Preview only" note; the native picker still opens at
  // the current custom accent so picking a colour starts somewhere familiar.
  const customAccentPickerValue =
    normalizedCustomAccent ??
    activeCustomAccent ??
    savedCustomAccents.at(-1) ??
    CUSTOM_ACCENT_PICKER_FALLBACK;
  // The picker swatch only reads as "current" when it shows the custom accent actually in use.
  const customPreviewIsActive =
    accent === 'custom' &&
    activeCustomAccent?.toLowerCase() === normalizedCustomAccent?.toLowerCase();
  const customDraftNoteShown = Boolean(normalizedCustomAccent) && !customPreviewIsActive;
  const customSwatchModifier = getCustomSwatchModifier(
    normalizedCustomAccent,
    customPreviewIsActive,
  );

  const handleCustomAccentSave = () => {
    if (!normalizedCustomAccent) {
      setCustomAccentSaveAttempted(true);
      document.getElementById(CUSTOM_ACCENT_INPUT_ID)?.focus();
      return;
    }
    const saved = setCustomAccent(customAccentInput);
    if (!saved) return;
    setCustomAccentSaveAttempted(false);
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

  const handleAccentScheduleToggle = (enabled: boolean) => {
    const nextSchedule = setAccentScheduleEnabled(enabled);
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

  const firstPresetTabStop = ACCENT_SCHEMES.some((scheme) => scheme.id === accent)
    ? accent
    : ACCENT_SCHEMES[0]?.id;
  const customTabStop = getCustomTabStop(accent, activeCustomAccent, savedCustomAccents);

  if (!active) return null;

  return (
    <div className="settings-section settings-section--appearance">
      <h2 className="settings-section-heading settings-section-heading--tab-echo">Appearance</h2>
      <div className="settings-appearance-accent">
        <div className="settings-description">
          Choose the signal color used for navigation, focus, and primary actions.
        </div>
        <h3 className="settings-subsection-label">Accent color</h3>
        <div className="accent-picker" role="radiogroup" aria-label="Accent color">
          {ACCENT_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              role="radio"
              aria-checked={accent === scheme.id}
              tabIndex={scheme.id === firstPresetTabStop ? 0 : -1}
              className={`accent-picker-swatch${accent === scheme.id ? ' accent-picker-swatch--active' : ''}`}
              style={{ ['--swatch' as string]: scheme.swatch }}
              onClick={() => handleAccentSelect(scheme.id)}
              onKeyDown={handleRadioGroupKeyDown}
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
                const swatchName = `Custom ${index + 1}, ${hex}`;
                const removeName = `Remove custom accent ${hex}`;
                return (
                  <div className="custom-accent-saved-item" key={hex}>
                    <Tooltip content={swatchName}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={swatchName}
                        tabIndex={hex === customTabStop ? 0 : -1}
                        className={`accent-picker-swatch custom-accent-saved-swatch${isActive ? ' accent-picker-swatch--active' : ''}`}
                        style={{ ['--swatch' as string]: hex }}
                        onClick={() => handleSavedCustomAccentSelect(hex)}
                        onKeyDown={handleRadioGroupKeyDown}
                      >
                        <span className="accent-picker-swatch-label">Custom {index + 1}</span>
                      </button>
                    </Tooltip>
                    <Tooltip content={removeName}>
                      <button
                        type="button"
                        className="custom-accent-remove"
                        aria-label={removeName}
                        onClick={() => handleCustomAccentRemove(hex)}
                      >
                        <svg
                          viewBox="0 0 12 12"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="m3 3 6 6M9 3 3 9" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
          <div className="custom-accent-row">
            <input
              type="color"
              className={`custom-accent-color-input${customSwatchModifier}`}
              value={customAccentPickerValue}
              aria-label="Pick custom accent color"
              aria-describedby={customDraftNoteShown ? 'custom-accent-draft-note' : undefined}
              onChange={(event) => setCustomAccentInput(event.target.value)}
            />
            <input
              id={CUSTOM_ACCENT_INPUT_ID}
              type="text"
              className="custom-accent-hex-input"
              value={customAccentInput}
              placeholder={CUSTOM_ACCENT_PLACEHOLDER}
              aria-label="Custom accent hex code"
              aria-invalid={customAccentInvalid}
              aria-describedby={customAccentInvalid ? CUSTOM_ACCENT_ERROR_ID : undefined}
              spellCheck={false}
              onChange={(event) => setCustomAccentInput(event.target.value)}
            />
            <TactileButton
              type="button"
              size="sm"
              variant="primary"
              className="custom-accent-save-button"
              aria-label="Save custom accent color"
              onClick={handleCustomAccentSave}
            >
              Save
            </TactileButton>
          </div>
          {customDraftNoteShown && (
            <p id="custom-accent-draft-note" className="settings-description">
              Preview only. {normalizedCustomAccent} is not the current accent until you save it.
            </p>
          )}
          {customAccentInvalid && (
            <div id={CUSTOM_ACCENT_ERROR_ID} className="field-error" role="alert">
              Enter a 3 or 6 digit hex color.
            </div>
          )}
        </div>
      </div>
      <div className="accent-schedule-control">
        <div className="accent-schedule-heading-group">
          <h3 className="custom-accent-label">Accent schedule</h3>
          <div className="accent-schedule-description">
            {'Switches the Relay accent color automatically at set times of day'}
            <span className="sr-only"> (fixed Central Time shift windows)</span>.
            {getRelayRuntime().kind === 'web' && ' Saved only in this browser.'}
          </div>
        </div>
        <SettingsSwitch
          label="Auto accent schedule"
          checked={accentSchedule.enabled}
          onChange={handleAccentScheduleToggle}
        />
        {!accentSchedule.enabled && (
          <span id={ACCENT_SCHEDULE_REASON_ID} className="sr-only">
            Turn on Auto accent schedule to choose accents
          </span>
        )}
        <div
          className={`accent-schedule-list${
            accentSchedule.enabled ? '' : ' accent-schedule-list--inactive'
          }`}
        >
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
                  disabled={!accentSchedule.enabled}
                  aria-describedby={accentSchedule.enabled ? undefined : ACCENT_SCHEDULE_REASON_ID}
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
