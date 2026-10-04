import { useEffect, useState } from 'react';
import { quietNow } from '@shared/serviceDesk';
import {
  NOTIFICATION_SOURCES,
  type NotificationPreferences,
  type NotificationSource,
} from '@shared/notifications';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { BellIcon } from '../../components/HeaderIcons';
import { useSdpAlerts, SdpAlertControls } from '../tickets/SdpAlerts';
import { TicketNotificationRules } from '../tickets/TicketNotifications';
import { openNotificationTarget, useNotifications } from './NotificationProvider';
import { formatOpsTime } from '../../utils/opsTime';
import '../tickets/tickets.css';
import './notifications.css';

function useInterruptionStatus(preferences?: NotificationPreferences) {
  const [now, setNow] = useState(Date.now);
  const snoozeUntil = preferences?.snoozeUntil ?? 0;
  useEffect(() => {
    const remaining = snoozeUntil - Date.now();
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(60000 - (Date.now() % 60000), remaining > 0 ? remaining : Infinity),
    );
    return () => clearTimeout(timer);
  }, [now, snoozeUntil]);
  const snoozed = snoozeUntil > now;
  const quiet =
    !!preferences?.quietHoursEnabled &&
    quietNow(
      {
        ...preferences,
        snoozeUntil: 0,
        rules: [],
        warningMinutes: 30,
      },
      now,
    );
  let pauseLabel = quiet ? 'Quiet hours' : '';
  if (snoozed) pauseLabel = 'Snoozed';
  return { snoozed, quiet, pauseLabel };
}

export function NotificationCenter() {
  const notifications = useNotifications();
  const sdp = useSdpAlerts();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const [section, setSection] = useState<'Inbox' | 'Preferences'>('Inbox');
  const [source, setSource] = useState<NotificationSource | 'All'>('All');
  const { snoozed, quiet, pauseLabel } = useInterruptionStatus(notifications?.preferences);
  if (!notifications) return null;
  const {
    notices,
    preferences,
    savePreferences,
    storageError,
    markRead,
    clear,
    undoClear,
    clearedCount,
  } = notifications;
  const unread = notices.filter((notice) => !notice.read).length;
  const visible = notices.filter((notice) => source === 'All' || notice.source === source);
  const desktop = globalThis.api?.runtime.kind === 'electron';
  return (
    <>
      <TactileButton
        size="sm"
        variant="ghost"
        className={`notification-trigger header-action${unread > 0 ? ' has-unread' : ''}`}
        icon={<BellIcon />}
        aria-haspopup="dialog"
        aria-expanded={open || rules}
        tooltip={sdp.attention ? `Notifications · ${sdp.message}` : 'Notifications'}
        onClick={() => setOpen(true)}
      >
        {/* Icon-only on screen; the name stays in the accessible label ahead of the count. */}
        <span className="sr-only">Notifications</span>
        {unread > 0 && (
          <span className="count-badge">
            <span className="sr-only">, </span>
            {unread > 99 ? '99+' : unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
        {pauseLabel && <span className="notification-pause"> · {pauseLabel}</span>}
        {sdp.attention && (
          <span className="notification-attention">
            {/* Warning diamond (pip grammar); the Tooltip carries the reason on hover and focus. */}
            <span aria-hidden="true">◆</span>
            <span className="sr-only">, needs attention</span>
          </span>
        )}
      </TactileButton>
      {rules && (
        <TicketNotificationRules
          live={{ preferences: sdp.preferences, savePreferences: sdp.savePreferences }}
          onClose={() => {
            setRules(false);
            setOpen(true);
          }}
        />
      )}
      {open && (
        <Modal
          isOpen
          title="Notifications"
          subtitle="Inbox lasts for this session. Preferences stay on this device."
          dialogClassName="modal-dialog-generic sdp-ticket-dialog notification-dialog"
          onClose={() => setOpen(false)}
          footer={
            <>
              <TactileButton
                variant="ghost"
                onClick={() =>
                  savePreferences({
                    ...preferences,
                    snoozeUntil: snoozed ? 0 : Date.now() + 3600000,
                  })
                }
              >
                {snoozed ? 'Resume Alerts' : 'Snooze 1h'}
              </TactileButton>
              <TactileButton variant="primary" onClick={() => setOpen(false)}>
                Done
              </TactileButton>
            </>
          }
        >
          <nav className="ticket-queues tab-strip" aria-label="Notification sections">
            {(['Inbox', 'Preferences'] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="tab-strip__tab"
                aria-current={section === name ? 'page' : undefined}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {snoozed && (
            <p className="ticket-mode-note">
              <output>
                Interruptions paused until {formatOpsTime(preferences.snoozeUntil)}. Inbox entries
                continue.
              </output>
            </p>
          )}
          {quiet && !snoozed && (
            <p className="ticket-mode-note">
              <output>
                Quiet hours active until {preferences.quietEnd}. Inbox entries continue.
              </output>
            </p>
          )}
          {storageError && (
            <p className="panel-error ink-rail ink-rail--alarm" role="alert">
              {storageError}
            </p>
          )}
          {section === 'Inbox' ? (
            <>
              <nav className="notification-sources" aria-label="Notification sources">
                {(['All', ...NOTIFICATION_SOURCES] as const).map((name) => (
                  <TactileButton
                    key={name}
                    size="sm"
                    variant="ghost"
                    active={source === name}
                    aria-pressed={source === name}
                    onClick={() => setSource(name)}
                  >
                    {name}
                  </TactileButton>
                ))}
              </nav>
              <div className="notification-inbox-actions">
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={!visible.some((notice) => !notice.read)}
                  onClick={() => markRead(undefined, source === 'All' ? undefined : source)}
                >
                  {source === 'All' ? 'Mark All Read' : `Mark ${source} Read`}
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={!visible.length}
                  onClick={() => clear(source === 'All' ? undefined : source, true)}
                >
                  Clear {source === 'All' ? 'Inbox' : source}
                </TactileButton>
              </div>
              {clearedCount > 0 && (
                <div className="notification-undo">
                  <output>
                    Cleared {clearedCount} {clearedCount === 1 ? 'notification' : 'notifications'}.
                  </output>
                  <TactileButton size="sm" variant="ghost" onClick={undoClear}>
                    Undo Clear
                  </TactileButton>
                </div>
              )}
              {!visible.length && (
                <p className="notification-empty">
                  No notifications{source === 'All' ? '' : ` from ${source}`} yet.
                </p>
              )}
              <div className="notification-list">
                {visible.map((notice) => (
                  <button
                    key={notice.id}
                    className={`notification-entry ${notice.read ? '' : 'is-unread'}`}
                    onClick={() => {
                      markRead(notice.id);
                      setOpen(false);
                      if (notice.options?.action) notice.options.action.onClick();
                      else openNotificationTarget(notice.target);
                    }}
                  >
                    <span className="notification-meta">
                      <span>
                        <span
                          className={`notification-severity notification-severity--${notice.type}`}
                        >
                          {
                            {
                              info: 'Information',
                              success: 'Success',
                              warning: 'Warning',
                              error: 'Error',
                            }[notice.type]
                          }
                        </span>
                        {' · '}
                        {notice.source}
                        {!notice.read && ' · Unread'}
                      </span>
                      <time dateTime={new Date(notice.at).toISOString()}>
                        {new Date(notice.at).toLocaleString()}
                      </time>
                    </span>
                    <strong>{notice.title}</strong>
                    <span>{notice.message}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="notification-preferences">
              <fieldset>
                <legend>Delivery</legend>
                {(['toast', 'desktop', 'sound'] as const).map((channel) => (
                  <label className="ticket-check" key={channel}>
                    <input
                      type="checkbox"
                      checked={preferences[channel]}
                      disabled={channel !== 'toast' && !desktop}
                      aria-describedby={
                        channel !== 'toast' && !desktop ? 'notification-desktop-only' : undefined
                      }
                      onChange={(event) =>
                        savePreferences({ ...preferences, [channel]: event.target.checked })
                      }
                    />
                    {
                      {
                        toast: 'In-app banners',
                        desktop: 'Desktop notifications',
                        sound: 'Notification sounds',
                      }[channel]
                    }
                  </label>
                ))}
                {!desktop && (
                  <p className="sr-only" id="notification-desktop-only">
                    Desktop notifications and sounds are available in Relay desktop.
                  </p>
                )}
              </fieldset>
              <fieldset>
                <legend>Quiet hours</legend>
                <label className="ticket-check">
                  <input
                    type="checkbox"
                    checked={preferences.quietHoursEnabled}
                    onChange={(event) =>
                      savePreferences({
                        ...preferences,
                        quietHoursEnabled: event.target.checked,
                        quietStart: preferences.quietStart || '22:00',
                        quietEnd: preferences.quietEnd || '07:00',
                      })
                    }
                  />
                  <span>Enable quiet hours</span>
                </label>
                <div className="notification-quiet-hours">
                  <label>
                    <span>Quiet hours start</span>
                    <input
                      type="time"
                      disabled={!preferences.quietHoursEnabled}
                      value={preferences.quietStart}
                      onChange={(event) =>
                        savePreferences({ ...preferences, quietStart: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Quiet hours end</span>
                    <input
                      type="time"
                      disabled={!preferences.quietHoursEnabled}
                      value={preferences.quietEnd}
                      onChange={(event) =>
                        savePreferences({ ...preferences, quietEnd: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="ticket-mode-note">Uses this device’s time zone.</p>
              </fieldset>
              {NOTIFICATION_SOURCES.map((name) => (
                <details className="notification-source-details" key={name}>
                  <summary>
                    {name}
                    <span>{preferences.sources[name].enabled ? 'Enabled' : 'Off'}</span>
                  </summary>
                  <fieldset>
                    <legend className="sr-only">{name} delivery</legend>
                    <label className="ticket-check">
                      <input
                        type="checkbox"
                        checked={preferences.sources[name].enabled}
                        onChange={(event) =>
                          savePreferences({
                            ...preferences,
                            sources: {
                              ...preferences.sources,
                              [name]: {
                                ...preferences.sources[name],
                                enabled: event.target.checked,
                              },
                            },
                          })
                        }
                      />
                      <span>
                        Enable{' '}
                        {
                          {
                            Tickets: 'ticket',
                            Problems: 'problem',
                            Radar: 'Radar',
                            Status: 'service-status',
                          }[name]
                        }{' '}
                        alerts
                      </span>
                    </label>
                    {name === 'Tickets' ? (
                      <SdpAlertControls
                        state={sdp}
                        onRules={() => {
                          setOpen(false);
                          setRules(true);
                        }}
                      />
                    ) : (
                      <div className="notification-source-options">
                        {(['info', 'warning', 'error', 'sound'] as const).map((level) => (
                          <label className="ticket-check" key={level}>
                            <input
                              type="checkbox"
                              checked={preferences.sources[name][level]}
                              disabled={
                                !preferences.sources[name].enabled ||
                                (level === 'sound' && (!desktop || !preferences.sound))
                              }
                              onChange={(event) =>
                                savePreferences({
                                  ...preferences,
                                  sources: {
                                    ...preferences.sources,
                                    [name]: {
                                      ...preferences.sources[name],
                                      [level]: event.target.checked,
                                    },
                                  },
                                })
                              }
                            />
                            {
                              {
                                info: 'Information',
                                warning: 'Warnings',
                                error: 'Errors',
                                sound: 'Play sound',
                              }[level]
                            }
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                </details>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
