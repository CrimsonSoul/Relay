import { useState } from 'react';
import { NOTIFICATION_SOURCES, type NotificationSource } from '@shared/notifications';
import { Modal } from '../../components/Modal';
import { TactileButton } from '../../components/TactileButton';
import { useSdpAlerts, SdpAlertControls } from '../tickets/SdpAlerts';
import { TicketNotificationRules } from '../tickets/TicketNotifications';
import { openNotificationTarget, useNotifications } from './NotificationProvider';
import '../tickets/tickets.css';
import './notifications.css';

export function NotificationCenter() {
  const notifications = useNotifications();
  const sdp = useSdpAlerts();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(false);
  const [section, setSection] = useState<'Inbox' | 'Preferences'>('Inbox');
  const [source, setSource] = useState<NotificationSource | 'All'>('All');
  if (!notifications) return null;
  const { notices, preferences, savePreferences, storageError, markRead, clear } = notifications;
  const unread = notices.filter((notice) => !notice.read).length;
  const visible = notices.filter((notice) => source === 'All' || notice.source === source);
  const desktop = globalThis.api?.runtime.kind === 'electron';
  const snoozed = preferences.snoozeUntil > Date.now();
  return (
    <>
      <TactileButton
        size="sm"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open || rules}
        title={sdp.attention ? sdp.message : undefined}
        onClick={() => setOpen(true)}
      >
        Notifications{unread > 0 ? ` (${unread} unread)` : ''}
        {sdp.attention && <span className="notification-attention">!</span>}
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
          subtitle="This session · Preferences saved on this device"
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
                {snoozed ? 'Resume alerts' : 'Snooze 1h'}
              </TactileButton>
              <TactileButton variant="primary" onClick={() => setOpen(false)}>
                Done
              </TactileButton>
            </>
          }
        >
          <nav className="ticket-queues" aria-label="Notification sections">
            {(['Inbox', 'Preferences'] as const).map((name) => (
              <button
                key={name}
                aria-current={section === name ? 'page' : undefined}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {snoozed && (
            <p role="status" className="ticket-mode-note">
              Interruptions paused until{' '}
              {new Date(preferences.snoozeUntil).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              . Inbox entries continue.
            </p>
          )}
          {storageError && <p role="alert">{storageError}</p>}
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
                  disabled={!unread}
                  onClick={() => markRead()}
                >
                  Mark all read
                </TactileButton>
                <TactileButton
                  size="sm"
                  variant="ghost"
                  disabled={!visible.length}
                  onClick={() => clear(source === 'All' ? undefined : source)}
                >
                  Clear {source === 'All' ? 'inbox' : source.toLowerCase()}
                </TactileButton>
              </div>
              {!visible.length && (
                <p className="notification-empty">
                  No notifications{source === 'All' ? '' : ` from ${source.toLowerCase()}`} yet.
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
                  <p className="ticket-mode-note">
                    Desktop notifications and sounds are available in Relay desktop.
                  </p>
                )}
              </fieldset>
              <fieldset>
                <legend>Quiet hours</legend>
                <div className="notification-quiet-hours">
                  <label>
                    Quiet hours start
                    <input
                      type="time"
                      value={preferences.quietStart}
                      onChange={(event) =>
                        savePreferences({ ...preferences, quietStart: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Quiet hours end
                    <input
                      type="time"
                      value={preferences.quietEnd}
                      onChange={(event) =>
                        savePreferences({ ...preferences, quietEnd: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="ticket-mode-note">
                  Uses this device’s time zone. Quiet hours silence interruptions; inbox entries
                  continue.
                </p>
              </fieldset>
              {NOTIFICATION_SOURCES.map((name) => (
                <fieldset key={name}>
                  <legend>{name}</legend>
                  <label className="ticket-check">
                    <input
                      type="checkbox"
                      checked={preferences.sources[name].enabled}
                      onChange={(event) =>
                        savePreferences({
                          ...preferences,
                          sources: {
                            ...preferences.sources,
                            [name]: { ...preferences.sources[name], enabled: event.target.checked },
                          },
                        })
                      }
                    />
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
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
