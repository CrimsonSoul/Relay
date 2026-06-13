import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { TactileButton } from './TactileButton';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  getDynatraceStartUrlError,
  type DynatraceDashboardInput,
  type DynatraceDashboardState,
  type DynatraceRuntimeState,
} from '@shared/dynatrace';
import { ACCENT_SCHEMES, getStoredAccent, setAccent, type AccentId } from '../theme/accent';

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
};

type PbConfig = PublicRelayConfig | null;
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
  const [dashboardName, setDashboardName] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<DynatraceValidationError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearingSession, setIsClearingSession] = useState(false);

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
    try {
      const saved = editingDashboardId
        ? await dynatrace.updateDashboard(editingDashboardId, input)
        : await dynatrace.addDashboard(input);
      if (saved) resetForm();
    } catch {
      // The Dynatrace hook owns failure toasts; keep form values for retry.
    } finally {
      setIsSaving(false);
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
    try {
      const removed = await dynatrace.removeDashboard(id);
      if (removed && editingDashboardId === id) resetForm();
    } catch {
      // Best-effort; the hook reports failures.
    }
  };

  const handleClearSession = async () => {
    setIsClearingSession(true);
    try {
      await dynatrace.clearSession();
    } catch {
      // Best-effort; the hook reports failures.
    } finally {
      setIsClearingSession(false);
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

export const SettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onOpenDataManager,
  onReconfigure,
  dynatrace,
}) => {
  const [pbConfig, setPbConfig] = useState<PbConfig>(null);
  const [connectionSecret, setConnectionSecret] = useState<string | null>(null);
  const [pbConfigLoading, setPbConfigLoading] = useState(false);
  const [showConnectionSecret, setShowConnectionSecret] = useState(false);
  const [accent, setAccentState] = useState<AccentId>(() => getStoredAccent());

  const handleAccentSelect = (id: AccentId) => {
    setAccent(id);
    setAccentState(id);
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
    globalThis.api
      ?.getConnectionSecret?.()
      .then((secret) => {
        if (!cancelled) setConnectionSecret(secret);
      })
      .catch(() => {
        if (!cancelled) setConnectionSecret(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" width="420px">
      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-heading">Accent Color</div>
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
        </div>

        <div className="settings-divider" />

        {onOpenDataManager && (
          <>
            <div className="settings-section">
              <div className="settings-section-heading">Data Management</div>
              <TactileButton
                onClick={() => {
                  onClose();
                  onOpenDataManager();
                }}
                variant="primary"
                className="btn-center"
              >
                Open Data Manager...
              </TactileButton>
            </div>

            <div className="settings-divider" />
          </>
        )}

        <div className="settings-section">
          <div className="settings-section-heading">PocketBase</div>
          {pbConfigLoading && <div className="settings-data-path">Loading...</div>}
          {!pbConfigLoading && !pbConfig && (
            <div className="settings-data-path">Not configured</div>
          )}
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
              {displayedConnectionSecret && (
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
              <div className="settings-button-row">
                <TactileButton onClick={handleReconfigure} className="btn-flex-center">
                  Reconfigure...
                </TactileButton>
              </div>
            </>
          )}
        </div>

        {dynatrace && (
          <>
            <div className="settings-divider" />
            <DynatraceSettingsSection dynatrace={dynatrace} />
          </>
        )}
      </div>
    </Modal>
  );
};
