import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import { AdministrationSettings } from './settings/AdministrationSettings';
import { AboutSettings } from './settings/AboutSettings';
import { WorkstationSettings } from './settings/WorkstationSettings';
import { AppearanceSettings, AppearanceSettingsProvider } from './settings/AppearanceSettings';
import { PrivilegedAccessPanel } from './settings/PrivilegedAccessPanel';
import {
  RelayConfigurationProvider,
  useRelayConfiguration,
} from './settings/RelayConfigurationContext';
import {
  RelayConnectionSettings,
  RelayConnectionUiProvider,
} from './settings/RelayConnectionSettings';
import './settings/settings.css';

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
  initialSection?: SettingsSectionId;
};

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
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

type SettingsSectionId =
  'appearance' | 'workstation' | 'connection' | 'access' | 'administration' | 'dynatrace' | 'about';

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'workstation', label: 'Workstation' },
  { id: 'connection', label: 'Relay data' },
  { id: 'access', label: 'Access' },
  { id: 'administration', label: 'Administration' },
  { id: 'dynatrace', label: 'Dynatrace' },
  { id: 'about', label: 'About' },
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

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % sections.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = sections.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextSection = sections[nextIndex];
    if (!nextSection) return;
    onSectionChange(nextSection.id);
    globalThis.document.getElementById(`settings-tab-${nextSection.id}`)?.focus();
  };

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

      <div
        className="settings-page__tabs"
        aria-label="Settings sections"
        aria-orientation="horizontal"
        role="tablist"
      >
        {sections.map((section, index) => (
          <button
            key={section.id}
            id={`settings-tab-${section.id}`}
            type="button"
            role="tab"
            aria-selected={activeSection === section.id}
            aria-controls="settings-panel"
            tabIndex={activeSection === section.id ? 0 : -1}
            className={`settings-page__tab${
              activeSection === section.id ? ' settings-page__tab--active' : ''
            }`}
            onClick={() => onSectionChange(section.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div
        id="settings-panel"
        className="settings-page__workspace"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeSection}`}
        tabIndex={0}
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

const SettingsModalContent: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
  dynatrace,
  presentation = 'modal',
  initialSection = 'appearance',
}) => {
  const { session: privilegedSession } = usePrivilegedAccess();
  const { relayMode, loading: relayConfigLoading } = useRelayConfiguration();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const settingsSections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => {
        if (section.id === 'about') {
          return presentation === 'page' && Boolean(globalThis.api?.getAppVersion);
        }
        if (section.id === 'workstation') {
          return Boolean(globalThis.api?.getWorkstationAwakeState);
        }
        return (
          section.id !== 'administration' ||
          (privilegedSession.state === 'active' &&
            (privilegedSession.role === 'owner' || privilegedSession.role === 'admin'))
        );
      }),
    [presentation, privilegedSession.role, privilegedSession.state],
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

  const dynatraceSections = (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      {!relayConfigLoading && relayMode === 'server' && <DynatraceProblemsSettingsSection />}

      {!relayConfigLoading && relayMode === 'client' && (
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

  const settingsContent = (
    <div
      className={`settings-body${
        presentation === 'page' ? ` settings-body--${activeSection}` : ''
      }`}
    >
      <AppearanceSettings active={presentation === 'modal' || activeSection === 'appearance'} />
      {(presentation === 'modal' || activeSection === 'workstation') && <WorkstationSettings />}
      <RelayConnectionSettings
        active={presentation === 'modal' || activeSection === 'connection'}
        onClose={onClose}
        onOpenDataManager={onOpenDataManager}
        onReconfigure={onReconfigure}
        presentation={presentation}
      />
      {presentation === 'page' && activeSection === 'access' && (
        <PrivilegedAccessPanel relayMode={relayMode} />
      )}
      {presentation === 'page' && activeSection === 'administration' && (
        <AdministrationSettings relayMode={relayMode} />
      )}
      {presentation === 'page' && activeSection === 'about' && <AboutSettings />}
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

export const SettingsModal: React.FC<Props> = (props) => (
  <AppearanceSettingsProvider>
    <RelayConnectionUiProvider isOpen={props.isOpen}>
      <RelayConfigurationProvider isOpen={props.isOpen}>
        <SettingsModalContent {...props} />
      </RelayConfigurationProvider>
    </RelayConnectionUiProvider>
  </AppearanceSettingsProvider>
);
