import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  type DynatraceProblemsPublicSettings,
} from '@shared/dynatraceProblems';
import {
  getDynatraceStartUrlError,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceRuntimeState,
} from '@shared/dynatrace';
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
} from '../theme/accent';
import { PrivilegedAccessPanel } from './settings/PrivilegedAccessPanel';
import { AdministrationSettings } from './settings/AdministrationSettings';
import { RelayWebAccessSettings } from './settings/RelayWebAccessSettings';
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';
import { hasRelayCapability } from '../runtime/relayRuntime';

type DynatraceSettingsProps = {
  dashboards: DynatraceDashboardState[];
  addDashboard: (input: DynatraceDashboardInput) => Promise<boolean>;
  updateDashboard: (id: string, input: DynatraceDashboardInput) => Promise<boolean>;
  removeDashboard: (id: string) => Promise<boolean>;
  openDashboard: (id: string) => Promise<boolean>;
  clearSession: () => Promise<boolean>;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDataManager?: () => void;
  onReconfigure?: () => void;
  dynatrace?: DynatraceSettingsProps;
  presentation?: 'modal' | 'page';
};

type PbConfig = PublicRelayConfig | null;
type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
const CUSTOM_ACCENT_EXAMPLE = '#2dd4bf';
type DynatraceValidationError = {
  field: 'name' | 'url';
  message: string;
};

const DYNATRACE_STATE_LABELS: Record<DynatraceRuntimeState, string> = {
  live: 'Live',
  authenticating: 'Signed out',
  blocked: 'Blocked',
  'load-failed': 'Load failed',
  closed: 'Closed',
};

type SettingsSectionId = 'appearance' | 'connection' | 'access' | 'administration' | 'dynatrace';

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'connection', label: 'Relay data' },
  { id: 'access', label: 'Access' },
  { id: 'administration', label: 'Administration' },
  { id: 'dynatrace', label: 'Dynatrace' },
];

type SettingsShellProps = {
  isOpen: boolean;
  onClose: () => void;
  presentation: 'modal' | 'page';
  activeSection: SettingsSectionId;
  sections: { id: SettingsSectionId; label: string }[];
  onSectionChange: (section: SettingsSectionId) => void;
  children: React.ReactNode;
};

function SettingsShell({
  isOpen,
  onClose,
  presentation,
  activeSection,
  sections,
  onSectionChange,
  children,
}: Readonly<SettingsShellProps>) {
  if (presentation === 'modal') {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Settings" variant="standard">
        {children}
      </Modal>
    );
  }

  if (!isOpen) return null;

  return (
    <section className="settings-page" aria-labelledby="settings-page-title">
      <header className="settings-page__header">
        <div>
          <div className="settings-page__context">Settings</div>
          <h1 id="settings-page-title" className="settings-page__title">
            Relay configuration
          </h1>
          <p className="settings-page__description">
            Manage this workstation, shared data, account access, and Dynatrace.
          </p>
        </div>
      </header>

      <div className="settings-page__tabs" aria-label="Settings sections" role="tablist">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            className={`settings-page__tab${
              activeSection === section.id ? ' settings-page__tab--active' : ''
            }`}
            onClick={() => onSectionChange(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div
        className="settings-page__workspace"
        role="tabpanel"
        aria-label={sections.find((section) => section.id === activeSection)?.label}
      >
        {children}
      </div>
    </section>
  );
}

function DynatraceProblemsSettingsSection() {
  const [settings, setSettings] = useState<DynatraceProblemsPublicSettings>({
    configured: false,
    environmentUrl: '',
    profileFilterConfigured: false,
    selectedAlertingProfiles: [],
  });
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [busy, setBusy] = useState<'load' | 'test' | 'save' | 'clear' | null>('load');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void globalThis.api
      ?.getDynatraceProblemsSettings?.()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setEnvironmentUrl(loaded.environmentUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setFeedback({ type: 'error', message: 'Could not load Dynatrace Problems settings.' });
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validate = () => {
    const urlError = getDynatraceEnvironmentUrlError(environmentUrl);
    if (urlError) return urlError;
    if (!settings.configured || apiToken.trim()) return getDynatraceApiTokenError(apiToken);
    return null;
  };

  const handleTest = async () => {
    const validation = validate();
    if (validation) {
      setFeedback({ type: 'error', message: validation });
      return;
    }
    setBusy('test');
    setFeedback({ type: 'info', message: 'Testing read-only Grail Problems access…' });
    try {
      const result = await globalThis.api?.testDynatraceProblemsSettings?.({
        environmentUrl,
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
      });
      if (!result?.success || !result.data) {
        throw new Error(result?.error || 'Dynatrace connection test failed.');
      }
      setFeedback({
        type: 'success',
        message: `Connected with platform-token access. ${result.data.problemCount.toLocaleString()} problems found in the last two hours.`,
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Dynatrace connection test failed.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const validation = validate();
    if (validation) {
      setFeedback({ type: 'error', message: validation });
      return;
    }
    setBusy('save');
    setFeedback(null);
    try {
      const result = await globalThis.api?.saveDynatraceProblemsSettings?.({
        environmentUrl,
        ...(apiToken.trim() ? { apiToken: apiToken.trim() } : {}),
      });
      if (!result?.success || !result.data) {
        throw new Error(result?.error || 'Could not save Dynatrace Problems settings.');
      }
      setSettings(result.data);
      setEnvironmentUrl(result.data.environmentUrl);
      setApiToken('');
      setFeedback({
        type: 'success',
        message: 'Saved. The Relay server will refresh Dynatrace Problems every minute.',
      });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not save Dynatrace settings.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    setBusy('clear');
    setFeedback(null);
    try {
      const result = await globalThis.api?.clearDynatraceProblemsSettings?.();
      if (!result?.success) throw new Error(result?.error || 'Could not remove configuration.');
      setSettings({
        configured: false,
        environmentUrl: '',
        profileFilterConfigured: false,
        selectedAlertingProfiles: [],
      });
      setEnvironmentUrl('');
      setApiToken('');
      setFeedback({ type: 'success', message: 'Dynatrace Problems sync disabled.' });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not remove configuration.',
      });
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null;
  let saveButtonLabel = 'Enable sync';
  if (settings.configured) saveButtonLabel = 'Save changes';
  if (busy === 'save') saveButtonLabel = 'Saving…';

  return (
    <div className="settings-section">
      <div className="settings-section-heading">Dynatrace Problems</div>
      <div className="settings-data-path">
        Server-only Grail access. The platform token is encrypted locally and is never sent to Relay
        clients. Requires storage:events:read and storage:buckets:read.
      </div>
      <form className="dynatrace-dashboard-form" onSubmit={(event) => void handleSave(event)}>
        <label className="dynatrace-dashboard-field">
          <span className="dynatrace-dashboard-label">Environment URL</span>
          <input
            className="tactile-input"
            value={environmentUrl}
            placeholder="https://abc123.apps.dynatrace.com"
            spellCheck={false}
            autoCapitalize="none"
            disabled={disabled}
            onChange={(event) => {
              setEnvironmentUrl(event.target.value);
              setFeedback(null);
            }}
          />
        </label>
        <label className="dynatrace-dashboard-field">
          <span className="dynatrace-dashboard-label">Platform token · read-only Grail access</span>
          <input
            className="tactile-input"
            type="password"
            value={apiToken}
            placeholder={
              settings.configured
                ? 'Leave blank to keep the stored platform token'
                : 'Paste platform token'
            }
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setApiToken(event.target.value);
              setFeedback(null);
            }}
          />
        </label>
        {feedback && (
          <div
            className={`dynatrace-problems-settings-feedback dynatrace-problems-settings-feedback--${feedback.type}`}
            role={feedback.type === 'error' ? 'alert' : 'status'}
          >
            {feedback.message}
          </div>
        )}
        <div className="settings-button-row">
          <TactileButton type="submit" variant="primary" disabled={disabled}>
            {saveButtonLabel}
          </TactileButton>
          <TactileButton type="button" disabled={disabled} onClick={() => void handleTest()}>
            {busy === 'test' ? 'Testing…' : 'Test access'}
          </TactileButton>
          {settings.configured && (
            <TactileButton type="button" disabled={disabled} onClick={() => void handleClear()}>
              {busy === 'clear' ? 'Disabling…' : 'Disable'}
            </TactileButton>
          )}
        </div>
      </form>
    </div>
  );
}

function getPocketBaseIp(config: PublicRelayConfig): string | null {
  if (config.mode === 'server') {
    if (config.bindHost === '127.0.0.1') return '127.0.0.1';
    return config.lanIp ?? null;
  }

  try {
    return new URL(config.serverUrl).hostname;
  } catch {
    return config.serverUrl || null;
  }
}

function getPocketBaseUrl(config: PublicRelayConfig): string | null {
  if (config.mode === 'client') return config.serverUrl;

  const ip = getPocketBaseIp(config);
  if (!ip) return null;
  return `http://${ip}:${config.port ?? 8090}`;
}

function getMaskedSecret(secret: string): string {
  return '•'.repeat(secret.length);
}

function DynatraceSettingsSection({ dynatrace }: Readonly<{ dynatrace: DynatraceSettingsProps }>) {
  const lifecycleRef = useRef({ mounted: false, generation: 0 });
  const [dashboardName, setDashboardName] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<DynatraceValidationError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingSession, setIsClearingSession] = useState(false);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    lifecycle.mounted = true;
    lifecycle.generation += 1;

    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
    };
  }, []);

  const isActiveGeneration = (generation: number) => {
    const lifecycle = lifecycleRef.current;
    return lifecycle.mounted && lifecycle.generation === generation;
  };

  const resetForm = () => {
    setDashboardName('');
    setDashboardUrl('');
    setEditingDashboardId(null);
    setValidationError(null);
  };

  const getDashboardInput = (): DynatraceDashboardInput | null => {
    const name = dashboardName.trim();
    if (!name) {
      setValidationError({ field: 'name', message: 'Enter a dashboard name.' });
      return null;
    }

    const url = dashboardUrl.trim();
    const urlError = getDynatraceStartUrlError(url);
    if (urlError) {
      setValidationError({ field: 'url', message: urlError });
      return null;
    }

    return { name, url };
  };

  const handleDashboardSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();

    const input = getDashboardInput();
    if (!input) return;

    setValidationError(null);
    setIsSaving(true);
    const generation = lifecycleRef.current.generation;
    try {
      const saved = editingDashboardId
        ? await dynatrace.updateDashboard(editingDashboardId, input)
        : await dynatrace.addDashboard(input);
      if (saved && isActiveGeneration(generation)) resetForm();
    } catch {
      // The Dynatrace hook owns failure toasts; keep form values for retry.
    } finally {
      if (isActiveGeneration(generation)) setIsSaving(false);
    }
  };

  const handleEditDashboard = (dashboard: DynatraceDashboardState) => {
    setDashboardName(dashboard.name);
    setDashboardUrl(dashboard.url);
    setEditingDashboardId(dashboard.id);
    setValidationError(null);
  };

  const handleOpenDashboard = async (id: string) => {
    try {
      await dynatrace.openDashboard(id);
    } catch {
      // Best-effort; the hook reports failures.
    }
  };

  const handleRemoveDashboard = async (id: string) => {
    const generation = lifecycleRef.current.generation;
    try {
      const removed = await dynatrace.removeDashboard(id);
      if (removed && editingDashboardId === id && isActiveGeneration(generation)) resetForm();
    } catch {
      // Best-effort; the hook reports failures.
    }
  };

  const handleClearSession = async () => {
    setIsClearingSession(true);
    const generation = lifecycleRef.current.generation;
    try {
      await dynatrace.clearSession();
    } catch {
      // Best-effort; the hook reports failures.
    } finally {
      if (isActiveGeneration(generation)) setIsClearingSession(false);
    }
  };

  const formActionLabel = editingDashboardId ? 'Save dashboard' : 'Add dashboard';
  const validationId = validationError ? 'dynatrace-dashboard-validation' : undefined;

  return (
    <div className="settings-section">
      <div className="settings-section-heading">Dynatrace Dashboards</div>

      {dynatrace.dashboards.length === 0 ? (
        <div className="settings-data-path">No dashboards configured</div>
      ) : (
        <div className="dynatrace-dashboard-list">
          {dynatrace.dashboards.map((dashboard) => (
            <div key={dashboard.id} className="dynatrace-dashboard-row">
              <div className="dynatrace-dashboard-main">
                <div className="dynatrace-dashboard-title-row">
                  <span className="dynatrace-dashboard-name">{dashboard.name}</span>
                  <span className="dynatrace-dashboard-state">
                    {DYNATRACE_STATE_LABELS[dashboard.state]}
                  </span>
                </div>
                <div className="dynatrace-dashboard-url">{dashboard.url}</div>
              </div>
              <div className="dynatrace-dashboard-actions">
                <button
                  type="button"
                  className="settings-inline-action"
                  aria-label={`Open ${dashboard.name}`}
                  onClick={() => void handleOpenDashboard(dashboard.id)}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="settings-inline-action"
                  aria-label={`Edit ${dashboard.name}`}
                  onClick={() => handleEditDashboard(dashboard)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="settings-inline-action"
                  aria-label={`Remove ${dashboard.name}`}
                  onClick={() => void handleRemoveDashboard(dashboard.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="dynatrace-dashboard-form"
        onSubmit={(event) => void handleDashboardSubmit(event)}
      >
        <label className="dynatrace-dashboard-field">
          <span className="dynatrace-dashboard-label">Dashboard name</span>
          <input
            className="tactile-input"
            value={dashboardName}
            onChange={(event) => {
              setDashboardName(event.target.value);
              if (validationError?.field === 'name') setValidationError(null);
            }}
            aria-invalid={validationError?.field === 'name' ? true : undefined}
            aria-describedby={validationError?.field === 'name' ? validationId : undefined}
          />
        </label>
        <label className="dynatrace-dashboard-field">
          <span className="dynatrace-dashboard-label">Dashboard URL</span>
          <input
            className="tactile-input"
            value={dashboardUrl}
            onChange={(event) => {
              setDashboardUrl(event.target.value);
              if (validationError?.field === 'url') setValidationError(null);
            }}
            aria-invalid={validationError?.field === 'url' ? true : undefined}
            aria-describedby={validationError?.field === 'url' ? validationId : undefined}
          />
        </label>
        {validationError && (
          <div
            id="dynatrace-dashboard-validation"
            className="dynatrace-dashboard-validation"
            role="alert"
          >
            {validationError.message}
          </div>
        )}
        <div className="settings-button-row">
          <TactileButton type="submit" variant="primary" disabled={isSaving}>
            {formActionLabel}
          </TactileButton>
          {editingDashboardId && (
            <TactileButton type="button" onClick={resetForm}>
              Cancel edit
            </TactileButton>
          )}
        </div>
      </form>

      <div className="settings-button-row">
        <TactileButton
          type="button"
          onClick={() => void handleClearSession()}
          disabled={isClearingSession}
        >
          Clear Dynatrace session
        </TactileButton>
      </div>
    </div>
  );
}

const RECONFIGURE_WARNING =
  'Reconfiguring erases the saved Relay server URL and the shared connection passphrase from this workstation. You will need the passphrase again to reconnect.';

function reconfigureWarning(pendingOfflineCount: number): string {
  if (pendingOfflineCount <= 0) return RECONFIGURE_WARNING;
  const plural = pendingOfflineCount === 1 ? '' : 's';
  return `${RECONFIGURE_WARNING} ${pendingOfflineCount} offline change${plural} queued on this workstation will be discarded if you point Relay at a different server.`;
}

/** Best-effort — the queued count only enriches the reconfigure warning. */
async function readPendingOfflineCount(): Promise<number> {
  try {
    return (await globalThis.api?.getPendingSyncStatus?.())?.pendingCount ?? 0;
  } catch {
    return 0;
  }
}

function ConnectionManagement({
  enabled,
  onReconfigure,
}: Readonly<{ enabled: boolean; onReconfigure: () => Promise<void> }>) {
  if (!enabled) {
    return (
      <div className="settings-data-path">
        Connection settings are managed by Relay Desktop on the server.
      </div>
    );
  }
  return (
    <div className="settings-button-row">
      <TactileButton onClick={() => void onReconfigure()} className="btn-flex-center">
        Reconfigure...
      </TactileButton>
    </div>
  );
}

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
  dynatrace,
  presentation = 'modal',
}) => {
  const { session: privilegedSession } = usePrivilegedAccess();
  const canConfigureConnection = hasRelayCapability('connectionConfiguration');
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');
  const [pbConfig, setPbConfig] = useState<PbConfig>(null);
  const [connectionSecret, setConnectionSecret] = useState<string | null>(null);
  const [pbConfigLoading, setPbConfigLoading] = useState(false);
  const [showConnectionSecret, setShowConnectionSecret] = useState(false);
  const [reconfigurePrompt, setReconfigurePrompt] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [accent, setAccent] = useState<AccentId>(() => getStoredAccent());
  const [savedCustomAccents, setSavedCustomAccents] = useState<string[]>(() =>
    getStoredCustomAccents(),
  );
  const [activeCustomAccent, setActiveCustomAccent] = useState<string | null>(() =>
    getStoredCustomAccent(),
  );
  const [customAccentInput, setCustomAccentInput] = useState(() => getStoredCustomAccent() ?? '');
  const [accentSchedule, setAccentSchedule] = useState(() => getStoredAccentSchedule());
  const settingsSections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter(
        (section) =>
          section.id !== 'administration' ||
          (privilegedSession.state === 'active' &&
            (privilegedSession.role === 'owner' || privilegedSession.role === 'admin')),
      ),
    [privilegedSession.role, privilegedSession.state],
  );

  useEffect(() => {
    if (
      activeSection === 'administration' &&
      !(
        privilegedSession.state === 'active' &&
        (privilegedSession.role === 'owner' || privilegedSession.role === 'admin')
      )
    ) {
      setActiveSection('access');
    }
  }, [activeSection, privilegedSession.role, privilegedSession.state]);

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

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setPbConfigLoading(true);
    setConnectionSecret(null);
    setShowConnectionSecret(false);
    globalThis.api
      ?.getConfig()
      .then((config) => {
        if (!cancelled) setPbConfig(config);
      })
      .catch(() => {
        if (!cancelled) setPbConfig(null);
      })
      .finally(() => {
        if (!cancelled) setPbConfigLoading(false);
      });
    if (canConfigureConnection) {
      globalThis.api
        ?.getConnectionSecret?.()
        .then((secret) => {
          if (!cancelled) setConnectionSecret(secret);
        })
        .catch(() => {
          if (!cancelled) setConnectionSecret(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [canConfigureConnection, isOpen]);

  // Clearing the config erases the saved server URL and the shared passphrase,
  // and the panel that displayed them goes with it — an operator who does not
  // know the passphrase by heart is locked out. Confirm before doing it.
  const handleReconfigureRequest = async () => {
    setPendingOfflineCount(await readPendingOfflineCount());
    setReconfigurePrompt(true);
  };

  const handleReconfigure = async () => {
    // Delete config on disk so the app returns to the setup screen on restart.
    try {
      await globalThis.api?.clearConfig();
    } catch {
      // Best-effort — onReconfigure() transitions to setup regardless.
    }
    onClose();
    onReconfigure?.();
  };

  const pbUrl = pbConfig ? getPocketBaseUrl(pbConfig) : null;
  let displayedConnectionSecret: string | null = null;
  if (connectionSecret) {
    displayedConnectionSecret = showConnectionSecret
      ? connectionSecret
      : getMaskedSecret(connectionSecret);
  }

  const copyText = async (text: string) => {
    await globalThis.api?.writeClipboard(text);
  };

  const appearanceSection = (
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
            <div className="accent-schedule-description">Fixed Central Time shift windows.</div>
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

  const connectionSections = (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      {onOpenDataManager && (
        <div className="settings-section">
          <div className="settings-section-heading">Relay data</div>
          <div className="settings-description">
            Review, import, or maintain the shared operational records used by Relay.
          </div>
          <TactileButton
            onClick={() => {
              if (presentation === 'modal') onClose();
              onOpenDataManager();
            }}
            variant="primary"
            className="btn-center"
          >
            Open Data Manager...
          </TactileButton>
        </div>
      )}

      {presentation === 'modal' && onOpenDataManager && <div className="settings-divider" />}

      <div className="settings-section">
        <div className="settings-section-heading">Relay connection</div>
        <div className="settings-description">
          This workstation&apos;s role and the address other Relay stations use.
        </div>
        {pbConfigLoading && <div className="settings-data-path">Loading...</div>}
        {!pbConfigLoading && !pbConfig && <div className="settings-data-path">Not configured</div>}
        {!pbConfigLoading && pbConfig && (
          <>
            <div className="settings-data-path">
              Mode: {pbConfig.mode === 'server' ? 'Embedded Server' : 'Remote Client'}
            </div>
            {pbUrl && (
              <div className="settings-data-path settings-copy-row">
                <span>URL: {pbUrl}</span>
                <button
                  type="button"
                  className="settings-inline-action"
                  onClick={() => void copyText(pbUrl)}
                >
                  Copy
                </button>
              </div>
            )}
            {canConfigureConnection && connectionSecret && displayedConnectionSecret && (
              <div className="settings-data-path settings-copy-row">
                <span>Passphrase: {displayedConnectionSecret}</span>
                <span className="settings-inline-actions">
                  <button
                    type="button"
                    className="settings-inline-action"
                    aria-label={showConnectionSecret ? 'Hide passphrase' : 'Show passphrase'}
                    onClick={() => setShowConnectionSecret((current) => !current)}
                  >
                    {showConnectionSecret ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    className="settings-inline-action"
                    onClick={() => void copyText(connectionSecret)}
                  >
                    Copy
                  </button>
                </span>
              </div>
            )}
            <ConnectionManagement
              enabled={canConfigureConnection}
              onReconfigure={handleReconfigureRequest}
            />
            <ConfirmModal
              isOpen={reconfigurePrompt}
              onClose={() => setReconfigurePrompt(false)}
              onConfirm={handleReconfigure}
              title="Reconfigure Relay connection?"
              message={reconfigureWarning(pendingOfflineCount)}
              confirmLabel="Erase and reconfigure"
              isDanger
            />
          </>
        )}
      </div>

      {canConfigureConnection && !pbConfigLoading && pbConfig?.mode === 'server' && (
        <RelayWebAccessSettings pocketBasePort={pbConfig.port} />
      )}
    </>
  );

  const dynatraceSections = (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      {!pbConfigLoading && pbConfig?.mode === 'server' && <DynatraceProblemsSettingsSection />}

      {!pbConfigLoading && pbConfig?.mode === 'client' && (
        <div className="settings-section">
          <div className="settings-section-heading">Dynatrace Problems</div>
          <div className="settings-data-path">
            Problems sync is configured and secured on the Relay server.
          </div>
        </div>
      )}

      {dynatrace && (
        <>
          {presentation === 'modal' && <div className="settings-divider" />}
          <DynatraceSettingsSection dynatrace={dynatrace} />
        </>
      )}
    </>
  );

  const accessSection = <PrivilegedAccessPanel relayMode={pbConfig?.mode ?? null} />;
  const administrationSection = <AdministrationSettings relayMode={pbConfig?.mode ?? null} />;

  const settingsContent = (
    <div
      className={`settings-body${
        presentation === 'page' ? ` settings-body--${activeSection}` : ''
      }`}
    >
      {(presentation === 'modal' || activeSection === 'appearance') && appearanceSection}
      {(presentation === 'modal' || activeSection === 'connection') && connectionSections}
      {presentation === 'page' && activeSection === 'access' && accessSection}
      {presentation === 'page' && activeSection === 'administration' && administrationSection}
      {(presentation === 'modal' || activeSection === 'dynatrace') && dynatraceSections}
    </div>
  );

  return (
    <SettingsShell
      isOpen={isOpen}
      onClose={onClose}
      presentation={presentation}
      activeSection={activeSection}
      sections={settingsSections}
      onSectionChange={setActiveSection}
    >
      {settingsContent}
    </SettingsShell>
  );
};
