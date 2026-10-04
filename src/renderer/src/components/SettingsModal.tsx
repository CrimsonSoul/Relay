import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getDynatraceStartUrlSaveError,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceRuntimeState,
} from '@shared/dynatrace';
import { usePrivilegedAccess } from '../contexts/PrivilegedAccessContext';
import { ConfirmModal } from './ConfirmModal';
import { Modal } from './Modal';
import { StatusBar, StatusBarLive } from './StatusBar';
import { TactileButton } from './TactileButton';
import type { SettingsSectionId } from './settingsNavigation';
import { TabPageHeader } from './tab-chrome/TabChrome';
import { useToast } from './Toast';
import { AdministrationSettings } from './settings/AdministrationSettings';
import { AboutSettings } from './settings/AboutSettings';
import { WebAboutSettings } from './settings/WebAboutSettings';
import { getRelayRuntime } from '../runtime/relayRuntime';
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
type DynatraceDashboardReadiness =
  { ready: true; input: DynatraceDashboardInput } | { ready: false; field: DashboardField };

type DashboardField = 'name' | 'url';
type DashboardFieldErrors = Partial<Record<DashboardField, string>>;

const DYNATRACE_FIELD_INPUT_IDS: Record<DashboardField, string> = {
  name: 'dynatrace-dashboard-name',
  url: 'dynatrace-dashboard-url',
};
const DYNATRACE_URL_HINT_ID = 'dynatrace-dashboard-url-hint';
const DYNATRACE_FIELD_ERROR_IDS: Record<DashboardField, string> = {
  name: 'dynatrace-dashboard-name-error',
  url: 'dynatrace-dashboard-url-error',
};

/**
 * Inline errors under each dashboard field. A value that can never be saved (an unsafe URL, a
 * blank-only name) shows as it is typed; an empty field shows once the operator has left it.
 */
function getDashboardFieldErrors(
  name: string,
  url: string,
  savedUrl: string | undefined,
  touched: Readonly<Record<DashboardField, boolean>>,
): DashboardFieldErrors {
  const errors: DashboardFieldErrors = {};
  if (!name.trim() && (name.length > 0 || touched.name)) errors.name = 'Enter a dashboard name.';
  const trimmedUrl = url.trim();
  if (trimmedUrl) {
    const urlError = getDynatraceStartUrlSaveError(trimmedUrl, savedUrl);
    if (urlError) errors.url = urlError;
  } else if (touched.url) {
    errors.url = 'Enter the dashboard URL.';
  }
  return errors;
}

/** Whether the form can be saved; otherwise the first field (in form order) that needs fixing. */
function getDashboardReadiness(
  name: string,
  url: string,
  savedUrl: string | undefined,
): DynatraceDashboardReadiness {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) return { ready: false, field: 'name' };
  if (!trimmedUrl || getDynatraceStartUrlSaveError(trimmedUrl, savedUrl)) {
    return { ready: false, field: 'url' };
  }
  return { ready: true, input: { name: trimmedName, url: trimmedUrl } };
}

const DYNATRACE_STATE_LABELS: Record<DynatraceRuntimeState, string> = {
  live: 'Live',
  authenticating: 'Signed out',
  blocked: 'Blocked',
  'load-failed': 'Load failed',
  closed: 'Closed',
};

const SETTINGS_SECTIONS: { id: SettingsSectionId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'workstation', label: 'Workstation' },
  { id: 'connection', label: 'Relay Data' },
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
      <TabPageHeader
        title="Settings"
        subtitle="Relay and this workstation"
        headingId="settings-page-title"
        headingLevel={1}
      />

      <div
        className="settings-page__tabs tab-strip"
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
            className="tab-strip__tab"
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

      <StatusBar left={<StatusBarLive />} />
    </section>
  );
}

/** Whether this machine can run keep-awake; the Workstation tab is hidden when it cannot. */
function useWorkstationAwakeSupported(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const getState = globalThis.api?.getWorkstationAwakeState;
    if (!getState) return;
    let cancelled = false;
    getState()
      .then((state) => {
        if (!cancelled) setSupported(state.supported);
      })
      .catch(() => {
        // Show the tab so it can report the read failure instead of silently vanishing.
        if (!cancelled) setSupported(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return supported;
}

function DynatraceSettingsSection({ dynatrace }: Readonly<{ dynatrace: DynatraceSettingsProps }>) {
  const { showToast } = useToast();
  const lifecycleRef = useRef({ mounted: false, generation: 0 });
  const [dashboardName, setDashboardName] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');
  // The URL already stored for the dashboard being edited; it may predate the save-time URL rules.
  const [editingDashboard, setEditingDashboard] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [confirmingClearSession, setConfirmingClearSession] = useState(false);

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

  const [touched, setTouched] = useState({ name: false, url: false });

  const resetForm = () => {
    setDashboardName('');
    setDashboardUrl('');
    setEditingDashboard(null);
    setTouched({ name: false, url: false });
  };

  const readiness = getDashboardReadiness(dashboardName, dashboardUrl, editingDashboard?.url);
  const fieldErrors = getDashboardFieldErrors(
    dashboardName,
    dashboardUrl,
    editingDashboard?.url,
    touched,
  );
  const markTouched = (field: DashboardField) =>
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));

  const handleDashboardSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!readiness.ready) {
      // Submit stays enabled: a blocked attempt reveals every field error and focuses the first.
      setTouched({ name: true, url: true });
      document.getElementById(DYNATRACE_FIELD_INPUT_IDS[readiness.field])?.focus();
      return;
    }

    const { input } = readiness;
    setIsSaving(true);
    const generation = lifecycleRef.current.generation;
    try {
      const saved = editingDashboard
        ? await dynatrace.updateDashboard(editingDashboard.id, input)
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
    setEditingDashboard({ id: dashboard.id, url: dashboard.url });
  };

  const handleOpenDashboard = async (id: string) => {
    try {
      await dynatrace.openDashboard(id);
    } catch {
      // Best-effort; the hook reports failures.
    }
  };

  const handleRemoveDashboard = async (dashboard: DynatraceDashboardState) => {
    const generation = lifecycleRef.current.generation;
    try {
      const removed = await dynatrace.removeDashboard(dashboard.id);
      if (!removed) return;
      showToast(`Removed ${dashboard.name}`, 'info', {
        action: {
          label: 'Undo',
          onClick: () => {
            void dynatrace.addDashboard({ name: dashboard.name, url: dashboard.url }).catch(() => {
              // Best-effort; the hook reports failures.
            });
          },
        },
      });
      if (editingDashboard?.id === dashboard.id && isActiveGeneration(generation)) resetForm();
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

  const formActionLabel = editingDashboard ? 'Save Dashboard' : 'Add Dashboard';
  const nameErrorId = fieldErrors.name ? DYNATRACE_FIELD_ERROR_IDS.name : undefined;
  const urlErrorId = fieldErrors.url ? DYNATRACE_FIELD_ERROR_IDS.url : undefined;

  return (
    <>
      <section className="settings-section">
        <h2 className="settings-section-heading">Dynatrace dashboards</h2>

        {dynatrace.dashboards.length === 0 ? (
          <p className="settings-description">No dashboards yet. Add one below.</p>
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
                  <TactileButton
                    size="xs"
                    aria-label={`Open ${dashboard.name}`}
                    onClick={() => void handleOpenDashboard(dashboard.id)}
                  >
                    Open
                  </TactileButton>
                  <TactileButton
                    size="xs"
                    aria-label={`Edit ${dashboard.name}`}
                    onClick={() => handleEditDashboard(dashboard)}
                  >
                    Edit
                  </TactileButton>
                  <TactileButton
                    size="xs"
                    aria-label={`Remove ${dashboard.name}`}
                    onClick={() => void handleRemoveDashboard(dashboard)}
                  >
                    Remove
                  </TactileButton>
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
              id={DYNATRACE_FIELD_INPUT_IDS.name}
              className="tactile-input"
              placeholder="e.g. NOC Overview"
              value={dashboardName}
              onChange={(event) => setDashboardName(event.target.value)}
              onBlur={() => markTouched('name')}
              aria-invalid={nameErrorId ? true : undefined}
              aria-describedby={nameErrorId}
            />
          </label>
          {fieldErrors.name && (
            <p id={nameErrorId} className="field-error" role="alert">
              {fieldErrors.name}
            </p>
          )}
          <label className="dynatrace-dashboard-field">
            <span className="dynatrace-dashboard-label">Dashboard URL</span>
            <input
              id={DYNATRACE_FIELD_INPUT_IDS.url}
              className="tactile-input dynatrace-dashboard-url-input"
              inputMode="url"
              placeholder="https://<env>.live.dynatrace.com/…"
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.target.value)}
              onBlur={() => markTouched('url')}
              aria-invalid={urlErrorId ? true : undefined}
              aria-describedby={
                urlErrorId ? `${DYNATRACE_URL_HINT_ID} ${urlErrorId}` : DYNATRACE_URL_HINT_ID
              }
            />
          </label>
          {/* Outside the label so the hint describes the field without joining its name. */}
          <p id={DYNATRACE_URL_HINT_ID} className="dynatrace-dashboard-hint">
            Copy the HTTPS dynatrace.com address from the dashboard&apos;s address bar, for example{' '}
            <span className="dynatrace-dashboard-example">
              https://abc12345.live.dynatrace.com/ui/apps/dynatrace.dashboards/…
            </span>
          </p>
          {fieldErrors.url && (
            <p id={urlErrorId} className="field-error" role="alert">
              {fieldErrors.url}
            </p>
          )}
          <div className="settings-button-row">
            <TactileButton type="submit" size="sm" disabled={isSaving}>
              {formActionLabel}
            </TactileButton>
            {editingDashboard && (
              <TactileButton type="button" size="sm" onClick={resetForm}>
                Cancel Edit
              </TactileButton>
            )}
          </div>
        </form>
      </section>

      <section className="settings-section">
        <h2 className="settings-section-heading">Dynatrace session</h2>
        <div className="dynatrace-session-row">
          <p className="settings-description">
            Signs Relay out of Dynatrace in every dashboard window. Saved dashboards stay.
          </p>
          <TactileButton
            type="button"
            size="sm"
            onClick={() => setConfirmingClearSession(true)}
            disabled={isClearingSession}
          >
            Clear Dynatrace Session
          </TactileButton>
        </div>
      </section>

      <ConfirmModal
        isOpen={confirmingClearSession}
        onClose={() => setConfirmingClearSession(false)}
        onConfirm={() => {
          void handleClearSession();
        }}
        title="Clear Dynatrace session?"
        message="Relay will sign out of Dynatrace in every dashboard window. Saved dashboards stay, but each one asks you to sign in again."
        confirmLabel="Clear Session"
        isDanger
      />
    </>
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
  const workstationSupported = useWorkstationAwakeSupported();
  const canAdminister =
    privilegedSession.state === 'active' &&
    (privilegedSession.role === 'owner' || privilegedSession.role === 'admin');
  const settingsSections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((section) => {
        if (section.id === 'about') {
          return (
            presentation === 'page' &&
            (getRelayRuntime().kind === 'web' || Boolean(globalThis.api?.getAppVersion))
          );
        }
        if (section.id === 'workstation') return workstationSupported;
        return section.id !== 'administration' || canAdminister;
      }),
    [canAdminister, presentation, workstationSupported],
  );

  useEffect(() => {
    if (activeSection === 'administration' && !canAdminister) setActiveSection('access');
  }, [activeSection, canAdminister]);

  const goToSection = (section: SettingsSectionId) => {
    setActiveSection(section);
    globalThis.document.getElementById(`settings-tab-${section}`)?.focus();
  };

  const dynatraceSections = (
    <>
      {presentation === 'modal' && <div className="settings-divider" />}
      {!relayConfigLoading && relayMode === 'server' && (
        <section className="settings-section">
          <h2 className="settings-section-heading">Dynatrace Problems</h2>
          <p className="settings-description">
            {canAdminister
              ? 'Configure or disable Dynatrace Problems in Administration.'
              : 'Sign in as an Administrator to configure or disable Dynatrace Problems.'}
          </p>
          {presentation === 'page' && (
            <div className="settings-button-row">
              <TactileButton
                type="button"
                size="sm"
                variant="primary"
                onClick={() => goToSection(canAdminister ? 'administration' : 'access')}
              >
                {canAdminister ? 'Open Administration' : 'Sign In to Administration'}
              </TactileButton>
            </div>
          )}
        </section>
      )}

      {!relayConfigLoading && relayMode === 'client' && (
        <section className="settings-section">
          <h2 className="settings-section-heading">Dynatrace Problems</h2>
          <p className="settings-description">
            Problems sync is configured and secured on the Relay server.
          </p>
        </section>
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
      {(presentation === 'modal' || activeSection === 'workstation') && workstationSupported && (
        <WorkstationSettings />
      )}
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
      {presentation === 'page' &&
        activeSection === 'about' &&
        (getRelayRuntime().kind === 'web' ? <WebAboutSettings /> : <AboutSettings />)}
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
